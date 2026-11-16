import { createRequire } from 'node:module';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VAULT_EXECUTOR_LOCK_FILE = '.nodus-automation-executor.lock';

export type ExecutorOwnershipClassification = 'active/owned' | 'inactive' | 'uncertain';

export interface ExecutorOwnershipObservation {
  classification: ExecutorOwnershipClassification;
  /** For active/owned observations, distinguishes this caller's lease from contention. */
  ownership?: 'current-process' | 'another-process';
  reason?: string;
}

export interface ExecutorOwnershipLease {
  readonly state: 'active' | 'invalidated' | 'releasing' | 'released';
  readonly lockPath: string;
  validateIdentity(): Promise<void>;
  withOwnership<T>(operation: () => T | Promise<T>): Promise<T>;
  release(): Promise<void>;
}

/** Historical acquisition result; use lease.state and validation for later work. */
export type ExecutorOwnershipAcquisition =
  | { classification: 'active/owned'; ownership: 'current-process'; lease: ExecutorOwnershipLease }
  | { classification: 'active/owned'; ownership: 'another-process' }
  | { classification: 'uncertain'; reason: string };

export interface ExecutorCleanupDiagnostics {
  records: Array<{ path: string; context: string; failures: Array<{ operation: string; code: number }> }>;
  dropped: number;
}

/** Read-only bounded native diagnostics; never evidence of executor liveness. */
export function readExecutorCleanupDiagnostics(): ExecutorCleanupDiagnostics {
  const backend = loadNativeBackend();
  if (!backend.readCleanupDiagnostics) throw new Error('Native cleanup diagnostics unavailable');
  return backend.readCleanupDiagnostics();
}

interface NativeExecutorLock {
  tryAcquire(path: string): object | null;
  validate?(handle: object): boolean;
  release(handle: object): void;
  readCleanupDiagnostics?(): ExecutorCleanupDiagnostics;
}

/** Narrow seam used to test unsupported and failed native backends. */
export interface ExecutorLockBackend extends NativeExecutorLock {}

const require = createRequire(import.meta.url);

function loadNativeBackend(): ExecutorLockBackend {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../native/executor-lock/build/Release/executor_lock.node'),
    resolve(here, '../../../../native/executor-lock/build/Release/executor_lock.node'),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try { return require(candidate) as ExecutorLockBackend; }
    catch (error) { lastError = error; }
  }
  throw lastError;
}

/**
 * Acquire the persistent per-vault executor lock. Kernel lock state is the
 * sole ownership evidence; lock-file contents are never read as liveness data.
 */
export async function acquireExecutorOwnership(
  vaultRoot: string,
  backend?: ExecutorLockBackend,
): Promise<ExecutorOwnershipAcquisition> {
  let root: string;
  try {
    root = await realpath(resolve(vaultRoot));
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      return { classification: 'uncertain', reason: 'Vault root is not a regular directory.' };
    }
  } catch (error) {
    return { classification: 'uncertain', reason: `Could not verify vault root: ${describe(error)}` };
  }

  let native: ExecutorLockBackend;
  try { native = backend ?? loadNativeBackend(); }
  catch (error) { return { classification: 'uncertain', reason: `Native executor lock backend is unavailable: ${describe(error)}` }; }

  const lockPath = join(root, VAULT_EXECUTOR_LOCK_FILE);
  let handle: object | null;
  try { handle = native.tryAcquire(lockPath); }
  catch (error) { return { classification: 'uncertain', reason: describe(error) }; }
  if (handle === null) return { classification: 'active/owned', ownership: 'another-process' };

  let state: ExecutorOwnershipLease['state'] = 'active';
  let releaseResult: Promise<void> | undefined;
  let busy = false;
  let finishOperation: (() => void) | undefined;
  const validate = () => {
    if (state !== 'active') throw new Error(`Executor ownership lease is ${state}`);
    try {
      if (!native.validate || native.validate(handle!) !== true) throw new Error('Executor lock identity cannot be verified');
    } catch (error) {
      if (state === 'active') state = 'invalidated';
      throw error;
    }
  };
  const finish = () => {
    busy = false;
    finishOperation?.();
    finishOperation = undefined;
  };
  const lease: ExecutorOwnershipLease = {
    get state() { return state; },
    lockPath,
    async validateIdentity() {
      if (busy) throw new Error('Executor ownership operation is running');
      busy = true;
      try { validate(); } finally { finish(); }
    },
    async withOwnership<T>(operation: () => T | Promise<T>): Promise<T> {
      if (busy) throw new Error('Executor ownership operation is running');
      // Reserve admission before calling an injected backend, which may reenter.
      busy = true;
      try {
        validate();
        if (state !== 'active') throw new Error(`Executor ownership lease is ${state}`);
        return await operation();
      } finally { finish(); }
    },
    release() {
      if (releaseResult) return releaseResult;
      const drained = busy ? new Promise<void>((resolveDrain) => { finishOperation = resolveDrain; }) : Promise.resolve();
      state = 'releasing';
      // Cache before invoking native cleanup, including for reentrant backends.
      releaseResult = drained.then(() => {
        state = 'released';
        native.release(handle!);
      });
      return releaseResult;
    },
  };
  return { classification: 'active/owned', ownership: 'current-process', lease };
}

/** Single-use owner boundary: always release and preserve operation + cleanup errors. */
export async function runWithExecutorOwnership<T>(
  lease: ExecutorOwnershipLease,
  operation: () => T | Promise<T>,
): Promise<T> {
  let result!: T;
  let failed = false;
  let operationError: unknown;
  try { result = await lease.withOwnership(operation); }
  catch (error) { failed = true; operationError = error; }
  try { await lease.release(); }
  catch (cleanupError) {
    if (failed) throw new AggregateError([operationError, cleanupError], 'Executor operation and cleanup failed');
    throw cleanupError;
  }
  if (failed) throw operationError;
  return result;
}

/**
 * Observe whether another executor currently holds the kernel lock. A free
 * lock is acquired and immediately released; the result describes that instant
 * only and is not a lease or a guarantee about later ownership.
 */
export async function inspectExecutorOwnership(
  vaultRoot: string,
  backend?: ExecutorLockBackend,
): Promise<ExecutorOwnershipObservation> {
  const result = await acquireExecutorOwnership(vaultRoot, backend);
  if (result.classification === 'uncertain') return result;
  if (result.ownership === 'another-process') return { classification: 'active/owned', ownership: 'another-process' };
  try {
    await result.lease.release();
    return { classification: 'inactive' };
  } catch (error) {
    return { classification: 'uncertain', reason: `Could not release ownership probe: ${describe(error)}` };
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? `${error.code}: ` : '';
    return `${code}${error.message}`;
  }
  return String(error);
}
