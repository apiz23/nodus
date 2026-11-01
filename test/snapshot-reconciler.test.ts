import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { SnapshotReconciler, type SnapshotTimers } from '../src/storage/fs/snapshot-reconciler.js';

class FakeTimers implements SnapshotTimers {
  private id = 0;
  timeouts = new Map<number, { callback: () => void; delay: number }>();
  intervals = new Map<number, () => void>();
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> { const id = ++this.id; this.timeouts.set(id, { callback, delay }); return id as unknown as ReturnType<typeof setTimeout>; }
  clearTimeout(handle: ReturnType<typeof setTimeout>): void { this.timeouts.delete(handle as unknown as number); }
  setInterval(callback: () => void): ReturnType<typeof setInterval> { const id = ++this.id; this.intervals.set(id, callback); return id as unknown as ReturnType<typeof setInterval>; }
  clearInterval(handle: ReturnType<typeof setInterval>): void { this.intervals.delete(handle as unknown as number); }
  fireTimeouts(): void { const callbacks = [...this.timeouts.values()].map(({ callback }) => callback); this.timeouts.clear(); callbacks.forEach((callback) => callback()); }
  fireDelay(delay: number): void { const entries = [...this.timeouts].filter(([, item]) => item.delay === delay); for (const [id, item] of entries) this.timeouts.delete(id); entries.forEach(([, item]) => item.callback()); }
  fireIntervals(): void { [...this.intervals.values()].forEach((callback) => callback()); }
}

function fixture(reconcile: () => Promise<string>, onInvalidate = vi.fn()) {
  const timers = new FakeTimers();
  const emitter = new EventEmitter();
  const close = vi.fn();
  let onChange: ((event: string, filename: string | null) => void) | undefined;
  const watcher = { on: (...args: Parameters<EventEmitter['on']>) => { emitter.on(...args); return watcher; }, close };
  const watch = vi.fn((_root: string, listener: (event: string, filename: string | null) => void) => { onChange = listener; return watcher; });
  const service = new SnapshotReconciler('/vault', reconcile, { timers, watch: watch as never, onInvalidate, now: vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(3).mockReturnValue(4) });
  return { service, timers, emitter, close, watch, onInvalidate, event: (kind = 'change', filename: string | null = 'note.md') => onChange?.(kind, filename) };
}

describe('database snapshot reconciler lifecycle', () => {
  it('builds once, serves warm hits, invalidates on watcher events, and disposes resources', async () => {
    const build = vi.fn().mockResolvedValue('snapshot');
    const { service, timers, close, event, watch, onInvalidate } = fixture(build);
    service.start();
    service.start();
    expect(watch).toHaveBeenCalledTimes(1);
    expect(await service.get()).toBe('snapshot');
    expect(await service.get()).toBe('snapshot');
    expect(build).toHaveBeenCalledTimes(1);
    expect(service.state).toBe('valid');
    event();
    expect(service.state).toBe('dirty');
    expect(onInvalidate).toHaveBeenCalled();
    timers.fireDelay(40);
    await Promise.resolve(); await Promise.resolve();
    expect(build).toHaveBeenCalledTimes(2);
    event('rename', 'renamed-folder');
    expect(service.state).toBe('dirty');
    timers.fireDelay(40);
    await Promise.resolve(); await Promise.resolve();
    expect(build).toHaveBeenCalledTimes(3);
    expect(service.latest).toBe('snapshot');
    event('rename', '.nodus-lock');
    expect(service.state).toBe('valid');
    service.dispose(); service.dispose();
    expect(close).toHaveBeenCalledTimes(1);
    expect(timers.intervals.size).toBe(0);
    expect(service.state).toBe('disposed');
  });

  it('periodically reconciles without a request and does not publish failures', async () => {
    const build = vi.fn().mockResolvedValueOnce('first').mockRejectedValueOnce(new Error('scan failed')).mockResolvedValue('recovered');
    const { service, timers } = fixture(build);
    service.start();
    expect(await service.get()).toBe('first');
    timers.fireDelay(5_000);
    await Promise.resolve(); await Promise.resolve();
    expect(service.state).toBe('unavailable');
    expect(service.latest).toBeUndefined();
    await expect(service.get()).resolves.toBe('recovered');
    expect(build).toHaveBeenCalledTimes(3);
    service.dispose();
  });

  it('coalesces concurrent requests and retries if invalidated during reconciliation', async () => {
    let resolve!: (value: string) => void;
    const build = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const { service } = fixture(build);
    const first = service.get();
    const second = service.get();
    expect(build).toHaveBeenCalledTimes(1);
    service.invalidate();
    resolve('stale');
    await Promise.resolve(); await Promise.resolve();
    expect(build).toHaveBeenCalledTimes(2);
    resolve('fresh');
    await expect(first).resolves.toBe('fresh');
    await expect(second).resolves.toBe('fresh');
    expect(service.latest).toBe('fresh');
    service.dispose();
  });

  it('marks watcher loss untrusted, restarts it, and disposes without publishing late work', async () => {
    let resolve!: (value: string) => void;
    const build = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const { service, timers, emitter, close, watch } = fixture(build);
    service.start();
    const pending = service.get();
    emitter.emit('close');
    expect(service.latest).toBeUndefined();
    service.dispose();
    expect(close).toHaveBeenCalledTimes(1);
    resolve('late snapshot');
    await expect(pending).rejects.toThrow('disposed');
    expect(service.latest).toBeUndefined();
    expect(watch).toHaveBeenCalledTimes(1);
    expect(timers.intervals.size).toBe(0);
    expect(timers.timeouts.size).toBe(0);
  });

  it('recreates a failed watcher and reconciles after recovery', async () => {
    const build = vi.fn().mockResolvedValueOnce('before failure').mockResolvedValue('after recovery');
    const { service, timers, emitter, close, watch } = fixture(build);
    service.start();
    expect(await service.get()).toBe('before failure');

    emitter.emit('error', new Error('watch lost'));
    expect(service.latest).toBeUndefined();
    expect(service.state).toBe('dirty');
    timers.fireDelay(1_000);
    await Promise.resolve(); await Promise.resolve();

    expect(watch).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(2);
    expect(service.latest).toBe('after recovery');
    expect(service.state).toBe('valid');
    service.dispose();
  });

  it('coalesces an interval during a long initial scan into one follow-up scan', async () => {
    let resolve!: (value: string) => void;
    const build = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; }))
      .mockResolvedValueOnce('after interval');
    const { service, timers } = fixture(build);
    service.start();
    const initial = service.get();
    timers.fireDelay(5_000);
    expect(build).toHaveBeenCalledTimes(1);
    resolve('initial');
    await expect(initial).resolves.toBe('initial');
    await Promise.resolve(); await Promise.resolve();
    expect(build).toHaveBeenCalledTimes(2);
    expect(service.latest).toBe('after interval');
    service.dispose();
  });
});
