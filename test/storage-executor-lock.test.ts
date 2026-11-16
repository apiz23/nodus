import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireExecutorOwnership,
  runWithExecutorOwnership,
  inspectExecutorOwnership,
  VAULT_EXECUTOR_LOCK_FILE,
  type ExecutorLockBackend,
} from '../src/storage/fs/executor-lock.js';
import { walkVault } from '../src/storage/fs/scan.js';

const lockPath = (root: string) => join(root, VAULT_EXECUTOR_LOCK_FILE);
const addonPath = resolve('native/executor-lock/build/Release/executor_lock.node');
const temporaryRoots: string[] = [];
const children: ChildProcess[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.nodus-executor-lock-test-'));
  temporaryRoots.push(root);
  return await realpath(root);
}

async function spawnOwner(root: string): Promise<ChildProcess> {
  const childProgram = [
    "const native = require(process.argv[1]);",
    "const lock = native.tryAcquire(process.argv[2]);",
    "if (!lock) { console.error('CONTENDED'); process.exit(3); }",
    "console.log('READY');",
    'setInterval(() => {}, 1000);',
  ].join('\n');
  const child = spawn(process.execPath, ['-e', childProgram, addonPath, lockPath(root)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  children.push(child);
  await new Promise<void>((resolveReady, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Child did not acquire executor lock. stderr=${stderr}`)), 8000);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes('READY')) { clearTimeout(timer); resolveReady(); }
    });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      if (!stdout.includes('READY')) { clearTimeout(timer); reject(new Error(`Child exited before acquiring lock (code=${code}); ${stderr}`)); }
    });
  });
  return child;
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill(process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL');
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>((done) => child.once('exit', () => done()));
  }
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('vault executor ownership lock', () => {
  it('acquires exclusive ownership, releases the handle, and keeps the lock file persistent', async () => {
    const root = await makeRoot();
    const acquired = await acquireExecutorOwnership(root);
    expect(acquired).toMatchObject({ classification: 'active/owned', ownership: 'current-process' });
    if (acquired.classification !== 'active/owned' || acquired.ownership !== 'current-process') throw new Error('Expected current process to own lock');

    expect(acquired.lease.state).toBe('active');
    expect(acquired.lease).not.toHaveProperty('classification');
    await acquired.lease.validateIdentity();
    expect(await inspectExecutorOwnership(root)).toMatchObject({ classification: 'active/owned', ownership: 'another-process' });
    await acquired.lease.release();
    await acquired.lease.release();
    expect(acquired.lease.state).toBe('released');
    await expect(acquired.lease.validateIdentity()).rejects.toThrow('released');

    expect(await inspectExecutorOwnership(root)).toEqual({ classification: 'inactive' });
    expect((await stat(lockPath(root))).isFile()).toBe(true);
    expect(await walkVault(root)).toMatchObject({ entries: [], issues: [] });
  });

  it('uses the kernel lock rather than stale heartbeat, PID, or host metadata', async () => {
    const root = await makeRoot();
    const staleMetadata = JSON.stringify({ pid: -1, host: 'another-host', heartbeat: 'expired' });
    await writeFile(lockPath(root), staleMetadata, { mode: 0o600 });
    const acquired = await acquireExecutorOwnership(root);
    if (acquired.classification !== 'active/owned' || acquired.ownership !== 'current-process') throw new Error('Expected current process to own lock');

    expect(await inspectExecutorOwnership(root)).toMatchObject({ classification: 'active/owned', ownership: 'another-process' });
    await acquired.lease.release();
    expect(await readFile(lockPath(root), 'utf8')).toBe(staleMetadata);
  });

  it('serializes ownership across independent processes and permits acquisition after termination', async () => {
    const root = await makeRoot();
    const child = await spawnOwner(root);
    expect(await inspectExecutorOwnership(root)).toMatchObject({ classification: 'active/owned', ownership: 'another-process' });

    child.kill(process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL');
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Owner process did not terminate')), 8000);
      child.once('exit', () => { clearTimeout(timer); done(); });
    });

    expect(await inspectExecutorOwnership(root)).toEqual({ classification: 'inactive' });
    const reacquired = await acquireExecutorOwnership(root);
    expect(reacquired).toMatchObject({ classification: 'active/owned', ownership: 'current-process' });
    if (reacquired.classification === 'active/owned' && reacquired.ownership === 'current-process') await reacquired.lease.release();
  });

  it('fails closed for unsupported filesystems and uncertain backend errors', async () => {
    const root = await makeRoot();
    const unsupported: ExecutorLockBackend = {
      tryAcquire: () => { throw Object.assign(new Error('Unsupported filesystem'), { code: 'ERR_UNSUPPORTED_FILESYSTEM' }); },
      release: () => undefined,
    };
    expect(await inspectExecutorOwnership(root, unsupported)).toMatchObject({ classification: 'uncertain', reason: expect.stringContaining('ERR_UNSUPPORTED_FILESYSTEM') });
    expect(await acquireExecutorOwnership(root, {
      tryAcquire: () => { throw Object.assign(new Error('Lock syscall failed'), { code: 'EIO' }); },
      release: () => undefined,
    })).toMatchObject({ classification: 'uncertain', reason: expect.stringContaining('EIO') });
    await expect(stat(lockPath(root))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects symlink lock paths without changing the symlink target', async () => {
    const root = await makeRoot();
    const target = join(root, 'user-data.txt');
    await writeFile(target, 'preserve me');
    await symlink(target, lockPath(root));

    expect(await inspectExecutorOwnership(root)).toMatchObject({ classification: 'uncertain' });
    expect(await readFile(target, 'utf8')).toBe('preserve me');
  });

  it('rejects permissive files and hard links without retaining ownership', async () => {
    const root = await makeRoot();
    await writeFile(lockPath(root), 'diagnostic', { mode: 0o600 });
    await chmod(lockPath(root), 0o666);
    expect(await acquireExecutorOwnership(root)).toMatchObject({ classification: 'uncertain' });
    await chmod(lockPath(root), 0o600);
    await link(lockPath(root), join(root, 'alias'));
    expect(await acquireExecutorOwnership(root)).toMatchObject({ classification: 'uncertain' });
    await rm(join(root, 'alias'));
    expect(await inspectExecutorOwnership(root)).toEqual({ classification: 'inactive' });
  });

  it('rejects FIFO and directory substitutions promptly', async () => {
    const root = await makeRoot();
    await mkdir(lockPath(root));
    expect(await acquireExecutorOwnership(root)).toMatchObject({ classification: 'uncertain' });
    await rm(lockPath(root), { recursive: true });
    if (process.platform !== 'win32') {
      await new Promise<void>((done, reject) => {
        const child = spawn('mkfifo', [lockPath(root)]);
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? done() : reject(new Error('mkfifo failed')));
      });
      expect(await acquireExecutorOwnership(root)).toMatchObject({ classification: 'uncertain' });
    }
  });

  it('detects replacement during a lease and safely releases the original object', async () => {
    const root = await makeRoot();
    const result = await acquireExecutorOwnership(root);
    if (result.classification !== 'active/owned' || result.ownership !== 'current-process') throw new Error('Expected owner');
    await result.lease.validateIdentity();
    if (process.platform === 'win32') {
      await expect(rename(lockPath(root), join(root, 'old-lock'))).rejects.toBeDefined();
    } else {
      await rename(lockPath(root), join(root, 'old-lock'));
      await writeFile(lockPath(root), '', { mode: 0o600 });
      await expect(result.lease.validateIdentity()).rejects.toThrow();
    }
    await result.lease.release();
    await expect(result.lease.validateIdentity()).rejects.toThrow();
    expect(await inspectExecutorOwnership(root)).toEqual({ classification: 'inactive' });
  });

  it('detects parent-directory replacement during a lease', async () => {
    if (process.platform === 'win32') return;
    const container = await makeRoot();
    const root = join(container, 'vault');
    await mkdir(root);
    const result = await acquireExecutorOwnership(root);
    if (result.classification !== 'active/owned' || result.ownership !== 'current-process') throw new Error('Expected owner');
    await rename(root, join(container, 'old-vault'));
    await mkdir(root);
    await expect(result.lease.validateIdentity()).rejects.toThrow();
    await result.lease.release();
  });

  it('permanently invalidates after real identity failure even when permissions are restored', async () => {
    if (process.platform === 'win32') return; // POSIX permission experiment.
    const root = await makeRoot();
    const result = await acquireExecutorOwnership(root);
    if (result.classification !== 'active/owned' || result.ownership !== 'current-process') throw new Error('Expected owner');
    await chmod(lockPath(root), 0o666);
    await expect(result.lease.validateIdentity()).rejects.toThrow();
    expect(result.lease.state).toBe('invalidated');
    expect(result.lease).not.toHaveProperty('classification');
    await chmod(lockPath(root), 0o600);
    let mutated = false;
    const protectedWork = async () => { await result.lease.validateIdentity(); mutated = true; };
    await expect(protectedWork()).rejects.toThrow('invalidated');
    await expect(result.lease.validateIdentity()).rejects.toThrow('invalidated');
    expect(mutated).toBe(false);
    await result.lease.release();
    await result.lease.release();
    expect(result.lease.state).toBe('released');
    expect(await inspectExecutorOwnership(root)).toEqual({ classification: 'inactive' });
  });

  it('does not reactivate after restoring the original pathname', async () => {
    if (process.platform === 'win32') return; // Windows denies this replacement.
    const root = await makeRoot();
    const result = await acquireExecutorOwnership(root);
    if (result.classification !== 'active/owned' || result.ownership !== 'current-process') throw new Error('Expected owner');
    const saved = join(root, 'saved-lock');
    await rename(lockPath(root), saved);
    await expect(result.lease.validateIdentity()).rejects.toThrow();
    await rename(saved, lockPath(root));
    await expect(result.lease.validateIdentity()).rejects.toThrow('invalidated');
    expect(result.lease.state).toBe('invalidated');
    await result.lease.release();
  });

  it('invalidates when the backend cannot validate and releases only once', async () => {
    const root = await makeRoot();
    let releases = 0;
    const result = await acquireExecutorOwnership(root, {
      tryAcquire: () => ({}),
      release: () => { releases += 1; },
    });
    if (result.classification !== 'active/owned' || result.ownership !== 'current-process') throw new Error('Expected owner');
    await expect(result.lease.validateIdentity()).rejects.toThrow();
    expect(result.lease.state).toBe('invalidated');
    const first = result.lease.release();
    expect(result.lease.release()).toBe(first);
    await first;
    expect(releases).toBe(1);
    expect(result.lease.state).toBe('released');
  });

  it.skipIf(process.platform === 'win32')('direct native invalidation survives pathname restoration and release', async () => {
    const native = createRequire(import.meta.url)(addonPath) as Required<ExecutorLockBackend>;
    const root = await makeRoot();
    const handle = native.tryAcquire(lockPath(root));
    expect(handle).not.toBeNull();
    try {
      expect(native.validate(handle!)).toBe(true);
      await rename(lockPath(root), join(root, 'original'));
      expect(() => native.validate(handle!)).toThrow();
      await rename(join(root, 'original'), lockPath(root));
      expect(() => native.validate(handle!)).toThrow();
      expect(() => native.validate(handle!)).toThrow();
    } finally { native.release(handle!); }
    expect(() => native.validate(handle!)).toThrow();
    native.release(handle!);
    expect(await inspectExecutorOwnership(root)).toEqual({ classification: 'inactive' });
  });

  it('retains ownership until running work finishes and rejects new work during release', async () => {
    const root = await makeRoot();
    const result = await acquireExecutorOwnership(root);
    if (result.classification !== 'active/owned' || result.ownership !== 'current-process') throw new Error('Expected owner');
    let finish!: () => void;
    const gate = new Promise<void>((done) => { finish = done; });
    const operation = result.lease.withOwnership(async () => { await gate; return 42; });
    await expect(result.lease.withOwnership(() => 0)).rejects.toThrow('running');
    await expect(result.lease.validateIdentity()).rejects.toThrow('running');
    const release = result.lease.release();
    expect(result.lease.state).toBe('releasing');
    expect(result.lease.release()).toBe(release);
    expect(await inspectExecutorOwnership(root)).toMatchObject({ ownership: 'another-process' });
    finish();
    expect(await operation).toBe(42);
    await release;
    expect(result.lease.state).toBe('released');
    await expect(result.lease.withOwnership(() => 0)).rejects.toThrow('released');
    expect(await inspectExecutorOwnership(root)).toEqual({ classification: 'inactive' });
  });

  it('preserves callback exceptions and drains before cleanup', async () => {
    const root = await makeRoot();
    const failure = new Error('callback failed');
    const result = await acquireExecutorOwnership(root);
    if (result.classification !== 'active/owned' || result.ownership !== 'current-process') throw new Error('Expected owner');
    await expect(result.lease.withOwnership(() => { throw failure; })).rejects.toBe(failure);
    expect(result.lease.state).toBe('active');
    expect(await result.lease.withOwnership(() => 7)).toBe(7);
    await result.lease.release();
  });

  it.each(['false', 'throw'])('blocks callbacks on validation %s and preserves cleanup failure', async (mode) => {
    const root = await makeRoot();
    const validationError = new Error('validation failed');
    const cleanupError = new Error('cleanup failed');
    let cleanupCalls = 0;
    let callbackCalls = 0;
    let observedState: string | undefined;
    const result = await acquireExecutorOwnership(root, {
      tryAcquire: () => ({}),
      validate: () => { if (mode === 'throw') throw validationError; return false; },
      release: () => { cleanupCalls++; observedState = lease.state; throw cleanupError; },
    });
    if (result.classification !== 'active/owned' || result.ownership !== 'current-process') throw new Error('Expected owner');
    const lease = result.lease;
    const operation = lease.withOwnership(() => { callbackCalls++; });
    if (mode === 'throw') await expect(operation).rejects.toBe(validationError);
    else await expect(operation).rejects.toThrow('cannot be verified');
    expect(lease.state).toBe('invalidated');
    expect(callbackCalls).toBe(0);
    const release = lease.release();
    await expect(release).rejects.toBe(cleanupError);
    expect(lease.release()).toBe(release);
    await expect(lease.release()).rejects.toBe(cleanupError);
    expect(cleanupCalls).toBe(1);
    expect(observedState).toBe('released');
  });

  it.each([[false, false], [true, false], [false, true], [true, true]])(
    'composes callback failure=%s and cleanup failure=%s', async (callbackFails, cleanupFails) => {
      const root = await makeRoot();
      const callbackError = new Error('callback');
      const cleanupError = new Error('cleanup');
      let cleanups = 0;
      const acquired = await acquireExecutorOwnership(root, {
        tryAcquire: () => ({}), validate: () => true,
        release: () => { cleanups++; if (cleanupFails) throw cleanupError; },
      });
      if (acquired.classification !== 'active/owned' || acquired.ownership !== 'current-process') throw new Error('Expected owner');
      const outcome = runWithExecutorOwnership(acquired.lease, async () => {
        if (callbackFails) throw callbackError;
        return 42;
      });
      if (callbackFails && cleanupFails) {
        await expect(outcome).rejects.toBeInstanceOf(AggregateError);
        await expect(outcome).rejects.toMatchObject({ errors: [callbackError, cleanupError] });
      } else if (callbackFails || cleanupFails) {
        await expect(outcome).rejects.toBe(callbackFails ? callbackError : cleanupError);
      } else expect(await outcome).toBe(42);
      expect(cleanups).toBe(1);
      expect(acquired.lease.state).toBe('released');
    });

  it('rejects nested operations deterministically', async () => {
    const root = await makeRoot();
    const acquired = await acquireExecutorOwnership(root);
    if (acquired.classification !== 'active/owned' || acquired.ownership !== 'current-process') throw new Error('Expected owner');
    await runWithExecutorOwnership(acquired.lease, async () => {
      await expect(acquired.lease.withOwnership(() => { throw new Error('must not enter'); })).rejects.toThrow('running');
    });
  });

  it('drains an asynchronously rejecting callback before cleanup and rejects new admission', async () => {
    const root = await makeRoot();
    const events: string[] = [];
    const failure = new Error('async callback');
    let rejectGate!: (error: Error) => void;
    const gate = new Promise<void>((_, reject) => { rejectGate = reject; });
    const acquired = await acquireExecutorOwnership(root, {
      tryAcquire: () => ({}), validate: () => true,
      release: () => { events.push('cleanup'); },
    });
    if (acquired.classification !== 'active/owned' || acquired.ownership !== 'current-process') throw new Error('Expected owner');
    const operation = acquired.lease.withOwnership(async () => {
      try { await gate; } finally { events.push('settled'); }
    });
    const rejected = expect(operation).rejects.toBe(failure);
    const release = acquired.lease.release();
    expect(acquired.lease.release()).toBe(release);
    await expect(acquired.lease.withOwnership(() => events.push('unexpected'))).rejects.toThrow();
    expect(events).toEqual([]);
    rejectGate(failure);
    await rejected;
    await release;
    expect(events).toEqual(['settled', 'cleanup']);
  });

  it.each(['nested', 'release'])('safely handles validation backend reentrancy: %s', async (mode) => {
    const root = await makeRoot();
    let lease!: import('../src/storage/fs/executor-lock.js').ExecutorOwnershipLease;
    let reentrant: Promise<unknown> | undefined;
    let entered = false;
    let cleanup = 0;
    const acquired = await acquireExecutorOwnership(root, {
      tryAcquire: () => ({}),
      validate: () => {
        reentrant = mode === 'release' ? lease.release() : lease.withOwnership(() => { entered = true; });
        return true;
      },
      release: () => { cleanup++; },
    });
    if (acquired.classification !== 'active/owned' || acquired.ownership !== 'current-process') throw new Error('Expected owner');
    lease = acquired.lease;
    const operation = lease.withOwnership(() => { entered = true; });
    if (mode === 'release') {
      await expect(operation).rejects.toThrow('releasing');
      await reentrant;
      expect(entered).toBe(false);
    } else {
      await expect(reentrant).rejects.toThrow('running');
      await operation;
      expect(entered).toBe(true);
    }
    await lease.release();
    expect(cleanup).toBe(1);
  });

  it('production addon excludes cleanup fault controls', () => {
    const native = createRequire(import.meta.url)(addonPath);
    expect(native.setCleanupFaults).toBeUndefined();
  });

  it.each([1, 2, 4, 7])('reports every native cleanup failure and never repeats cleanup (mask %s)', async (mask) => {
    const native = createRequire(import.meta.url)(resolve('native/executor-lock/build/Release/executor_lock_test.node'));
    const root = await makeRoot();
    const handle = native.tryAcquire(lockPath(root));
    expect(handle).not.toBeNull();
    native.setCleanupFaults(mask);
    let failure: any;
    try { native.release(handle); } catch (error) { failure = error; }
    expect(failure?.code).toBe('ERR_LOCK_RELEASE');
    const expected = ['unlock', 'close-file', 'close-directory'].filter((_, index) => mask & (1 << index));
    expect(failure.cleanup.failures.map((item: any) => item.operation)).toEqual(expected);
    expect(failure.cleanup.failures.every((item: any) => item.code === 99999)).toBe(true);
    const before = native.readCleanupDiagnostics();
    native.release(handle);
    expect(native.readCleanupDiagnostics()).toEqual(before);
    expect(() => native.validate(handle)).toThrow();
    // Fault reporting is injected AFTER real cleanup, so this proves diagnostics
    // and propagation, not kernel behavior for an actual failed close syscall.
    expect(await inspectExecutorOwnership(root)).toEqual({ classification: 'inactive' });
  });

  it('retains bounded acquisition-cleanup diagnostics without masking the acquisition error', async () => {
    const native = createRequire(import.meta.url)(resolve('native/executor-lock/build/Release/executor_lock_test.node'));
    const root = await makeRoot();
    await writeFile(lockPath(root), '', { mode: 0o600 });
    await link(lockPath(root), join(root, 'alias'));
    const droppedBefore = native.readCleanupDiagnostics().dropped;
    for (let index = 0; index < 35; index++) {
      native.setCleanupFaults(4);
      expect(() => native.tryAcquire(lockPath(root))).toThrow();
    }
    const diagnostics = native.readCleanupDiagnostics();
    expect(diagnostics.records).toHaveLength(32);
    expect(diagnostics.dropped).toBeGreaterThan(droppedBefore);
    expect(diagnostics.records.at(-1)).toMatchObject({ path: lockPath(root), context: 'acquisition-or-finalizer', failures: [{ operation: 'close-directory', code: 99999 }] });
    await rm(join(root, 'alias'));
    const handle = native.tryAcquire(lockPath(root));
    native.release(handle);
  });

  it('reports a failed release rather than treating it as inactive', async () => {
    const root = await makeRoot();
    const backend: ExecutorLockBackend = {
      tryAcquire: () => ({}),
      release: () => { throw new Error('release failed'); },
    };
    const acquired = await acquireExecutorOwnership(root, backend);
    if (acquired.classification !== 'active/owned' || acquired.ownership !== 'current-process') throw new Error('Expected simulated owner');

    const release = acquired.lease.release();
    await expect(release).rejects.toThrow('release failed');
    expect(acquired.lease.release()).toBe(release);
    await expect(acquired.lease.release()).rejects.toThrow('release failed');
    expect(acquired.lease.state).toBe('released');
    await expect(acquired.lease.validateIdentity()).rejects.toThrow('released');
    expect(await inspectExecutorOwnership(root, {
      tryAcquire: () => { throw new Error('ownership cannot be established'); },
      release: () => undefined,
    })).toMatchObject({ classification: 'uncertain' });
  });
});
