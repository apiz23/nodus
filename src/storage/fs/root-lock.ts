import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { lstat, open, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { StorageError, storageFailure } from '../errors.js';

const queues = new Map<string, Promise<void>>();
export const VAULT_PROCESS_LOCK_FILE = '.nodus-vault-write.lock';

interface ProcessLockOwner {
  version: 1;
  pid: number;
  host: string;
  acquiredAt: string;
  token: string;
}

/** Serialize Nodus mutations to one real vault root, within and across processes. */
export async function withVaultRootLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  queues.set(key, tail);

  await previous;
  try {
    return await withProcessLock(root, operation);
  } finally {
    release();
    if (queues.get(key) === tail) queues.delete(key);
  }
}

async function withProcessLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const path = join(root, VAULT_PROCESS_LOCK_FILE);
  const owner: ProcessLockOwner = {
    version: 1,
    pid: process.pid,
    host: hostname(),
    acquiredAt: new Date().toISOString(),
    token: randomUUID(),
  };
  const ownerBytes = Buffer.from(`${JSON.stringify(owner)}\n`, 'utf8');

  let handle: FileHandle;
  try {
    // Exclusive creation is the cross-process arbitration point on local filesystems.
    handle = await open(path, 'wx+', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') {
      throw new StorageError(
        'CONFLICT',
        `Another Nodus process may be using this vault, or an earlier failure left a lock. No operation started. Do not remove "${VAULT_PROCESS_LOCK_FILE}" based on its age or PID; follow the manual recovery procedure in docs/storage.md#lock-recovery.`,
        { path: VAULT_PROCESS_LOCK_FILE, details: { paths: [VAULT_PROCESS_LOCK_FILE] } },
      );
    }
    throw storageFailure(error, 'Acquire vault process lock', VAULT_PROCESS_LOCK_FILE);
  }

  try {
    await handle.writeFile(ownerBytes);
    await handle.sync();
  } catch (error) {
    let cause = error;
    try {
      await handle.close();
    } catch (closeError) {
      cause = new AggregateError([error, closeError], 'Lock initialization and handle cleanup failed');
    }
    // Incomplete metadata cannot prove ownership. In particular, never unlink
    // a path that may have been replaced while initialization was failing.
    throw new StorageError(
      'STORAGE_FAILURE',
      `Could not initialize "${VAULT_PROCESS_LOCK_FILE}"; no vault operation started. Nodus did not remove the lock path. Follow docs/storage.md#lock-recovery before further writes.`,
      { cause, path: VAULT_PROCESS_LOCK_FILE, details: { paths: [VAULT_PROCESS_LOCK_FILE] } },
    );
  }

  let result: T | undefined;
  let operationError: unknown;
  let succeeded = false;
  try {
    result = await operation();
    succeeded = true;
  } catch (error) {
    operationError = error;
  }

  try {
    await releaseProcessLock(path, handle, ownerBytes);
  } catch (error) {
    const original = operationError instanceof StorageError ? operationError : undefined;
    const paths = [...new Set([
      ...(original?.details?.paths ?? []),
      ...(original?.path === undefined ? [] : [original.path]),
      VAULT_PROCESS_LOCK_FILE,
    ])];
    throw new StorageError(
      original?.code === 'PARTIAL_WRITE' ? 'PARTIAL_WRITE' : 'STORAGE_FAILURE',
      `Could not release "${VAULT_PROCESS_LOCK_FILE}"; the operation ${succeeded ? 'may have completed' : `also failed: ${describe(operationError)}`}. Do not blindly retry. Follow docs/storage.md#lock-recovery and inspect the affected data.`,
      {
        cause: succeeded ? error : new AggregateError([operationError, error], 'Vault operation and lock release failed'),
        path: VAULT_PROCESS_LOCK_FILE,
        details: {
          ...original?.details,
          paths,
          issues: [...(original?.details?.issues ?? []), `Lock release failed: ${describe(error)}`],
        },
      },
    );
  }

  if (!succeeded) throw operationError;
  return result as T;
}

async function releaseProcessLock(path: string, handle: FileHandle, ownerBytes: Buffer): Promise<void> {
  let failure: unknown;
  let failed = false;
  try {
    // Read through the still-open owner handle, not through a possibly replaced
    // path. Keep it open until unlink so the original inode cannot be recycled.
    const contents = Buffer.alloc(ownerBytes.length);
    const { bytesRead } = await handle.read(contents, 0, contents.length, 0);
    const held = await handle.stat({ bigint: true });
    const named = await lstat(path, { bigint: true });
    if (
      !named.isFile() || named.dev !== held.dev || named.ino !== held.ino ||
      held.size !== BigInt(ownerBytes.length) || bytesRead !== ownerBytes.length ||
      !contents.equals(ownerBytes)
    ) {
      throw new StorageError('CONFLICT', `Ownership of "${VAULT_PROCESS_LOCK_FILE}" changed during the operation`, {
        path: VAULT_PROCESS_LOCK_FILE,
        details: { paths: [VAULT_PROCESS_LOCK_FILE] },
      });
    }
    // No portable compare-and-unlink exists. Cooperating Nodus processes never
    // replace a lock; manual recovery must quiesce every writer first.
    await unlink(path);
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    if (failed) throw new AggregateError([failure, error], 'Lock release and handle cleanup failed');
    throw error;
  }
  if (failed) throw failure;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
