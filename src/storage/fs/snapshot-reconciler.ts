import { watch as watchFileSystem, type FSWatcher } from 'node:fs';
import { extname } from 'node:path';

export type SnapshotState = 'uninitialized' | 'valid' | 'dirty' | 'reconciling' | 'unavailable' | 'disposed';
export interface SnapshotTimers {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  setInterval(callback: () => void, delay: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}
export type SnapshotWatchFactory = (root: string, listener: (event: string, filename: string | null) => void) => Pick<FSWatcher, 'on' | 'close'>;
export interface SnapshotReconcilerOptions {
  intervalMs?: number;
  debounceMs?: number;
  restartMs?: number;
  now?: () => number;
  timers?: SnapshotTimers;
  watch?: SnapshotWatchFactory;
  onInvalidate?: () => void;
}
const timers: SnapshotTimers = globalThis;

/** Owns trust, watcher, reconciliation scheduling, and the published snapshot. */
export class SnapshotReconciler<T> {
  private stateValue: SnapshotState = 'uninitialized';
  private generation = 0;
  private value?: T;
  private running?: Promise<T>;
  private rerunRequested = false;
  private watcher?: Pick<FSWatcher, 'on' | 'close'>;
  private periodic?: ReturnType<typeof setTimeout>;
  private debounce?: ReturnType<typeof setTimeout>;
  private restart?: ReturnType<typeof setTimeout>;
  private disposed = false;
  lastStartedAt?: number;
  lastCompletedAt?: number;
  lastDurationMs?: number;

  constructor(
    private readonly root: string,
    private readonly reconcileSnapshot: () => Promise<T>,
    private readonly options: SnapshotReconcilerOptions = {},
  ) {}

  get state(): SnapshotState { return this.stateValue; }
  get latest(): T | undefined { return this.stateValue === 'valid' ? this.value : undefined; }

  start(): void {
    if (this.disposed || this.periodic) return;
    this.startWatcher();
    this.schedulePeriodic();
    this.invalidate();
  }

  invalidate(): void {
    if (this.disposed) return;
    this.generation += 1;
    this.stateValue = 'dirty';
    try { this.options.onInvalidate?.(); } catch { /* cache listeners cannot break watcher delivery */ }
    if (this.debounce !== undefined) this.clock().clearTimeout(this.debounce);
    this.debounce = this.clock().setTimeout(() => {
      this.debounce = undefined;
      void this.reconcile().catch(() => undefined);
    }, this.options.debounceMs ?? 40);
  }

  async get(): Promise<T> {
    if (this.disposed) throw new Error('Vault snapshot service has been disposed.');
    if (this.latest !== undefined) return this.latest;
    return this.reconcile();
  }

  async reconcile(preserveTrustedSnapshot = false): Promise<T> {
    if (this.disposed) throw new Error('Vault snapshot service has been disposed.');
    if (this.running) return this.running;
    const task = (async () => {
      do {
        const generation = this.generation;
        if (!preserveTrustedSnapshot || this.latest === undefined) this.stateValue = 'reconciling';
        const now = this.options.now ?? Date.now;
        this.lastStartedAt = now();
        try {
          const next = await this.reconcileSnapshot();
          this.lastCompletedAt = now();
          this.lastDurationMs = Math.max(0, this.lastCompletedAt - this.lastStartedAt);
          if (this.disposed) throw new Error('Vault snapshot service has been disposed.');
          if (generation !== this.generation) continue;
          this.value = next;
          this.stateValue = 'valid';
          return next;
        } catch (error) {
          if (!this.disposed) this.stateValue = 'unavailable';
          throw error;
        }
      } while (!this.disposed);
      throw new Error('Vault snapshot service has been disposed.');
    })();
    this.running = task;
    try { return await task; }
    finally {
      if (this.running === task) this.running = undefined;
      if (this.disposed) this.stateValue = 'disposed';
      else {
        const rerun = this.rerunRequested;
        this.rerunRequested = false;
        this.schedulePeriodic();
        if (rerun) void this.reconcile(true).catch(() => undefined);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stateValue = 'disposed';
    this.value = undefined;
    const clock = this.clock();
    if (this.periodic !== undefined) clock.clearTimeout(this.periodic);
    if (this.debounce !== undefined) clock.clearTimeout(this.debounce);
    if (this.restart !== undefined) clock.clearTimeout(this.restart);
    this.periodic = this.debounce = this.restart = undefined;
    try { this.watcher?.close(); } catch { /* best-effort native watcher cleanup */ }
    this.watcher = undefined;
  }

  private startWatcher(): void {
    if (this.disposed || this.watcher) return;
    let watcher: Pick<FSWatcher, 'on' | 'close'> | undefined;
    try {
      const create = this.options.watch ?? ((root, listener) => watchFileSystem(root, { recursive: true }, listener));
      watcher = create(this.root, (event, filename) => {
        // Rename events include file replacement and directory changes, including
        // extensionless folders that may contain Markdown files. Treat them as
        // relevant unless the path is explicitly hidden/internal.
        if (filename === null || (!isHiddenOrInternalPath(filename) && (event === 'rename' || isRelevantPath(filename)))) this.invalidate();
      });
      this.watcher = watcher;
      watcher.on('error', () => this.watcherFailed(watcher));
      watcher.on('close', () => this.watcherFailed(watcher));
    } catch {
      this.watcherFailed(watcher);
    }
  }

  private watcherFailed(watcher?: Pick<FSWatcher, 'on' | 'close'>): void {
    if (this.disposed || (watcher && this.watcher !== watcher)) return;
    this.watcher = undefined;
    try { watcher?.close(); } catch { /* best-effort close */ }
    this.stateValue = 'dirty';
    this.invalidate();
    if (this.restart === undefined) {
      this.restart = this.clock().setTimeout(() => {
        this.restart = undefined;
        this.startWatcher();
        void this.reconcile().catch(() => undefined);
      }, this.options.restartMs ?? 1_000);
    }
  }

  private clock(): SnapshotTimers { return this.options.timers ?? timers; }

  private schedulePeriodic(): void {
    if (this.disposed || this.periodic !== undefined) return;
    this.periodic = this.clock().setTimeout(() => {
      this.periodic = undefined;
      if (this.running) { this.rerunRequested = true; return; }
      void this.reconcile(true).catch(() => undefined);
    }, this.options.intervalMs ?? 5_000);
  }
}

function isRelevantPath(filename: string): boolean {
  const parts = filename.replaceAll('\\', '/').split('/');
  if (isHiddenOrInternalParts(parts)) return false;
  const path = parts.join('/');
  return extname(path).toLowerCase() === '.md' ||
    (parts[0]?.toLowerCase() === 'databases' && parts.length === 2 && extname(path).toLowerCase() === '.json');
}

function isHiddenOrInternalPath(filename: string): boolean {
  return isHiddenOrInternalParts(filename.replaceAll('\\', '/').split('/'));
}

function isHiddenOrInternalParts(parts: string[]): boolean {
  return parts.some((part) => part.startsWith('.') || part === 'node_modules');
}
