import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { open, readFile, unlink } from 'node:fs/promises';
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

  let handle: FileHandle;
  try {
    // Exclusive creation is the cross-process arbitration point on local filesystems.
    handle = await open(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') {
      throw new StorageError(
        'CONFLICT',
        `Another Nodus process may be using this vault, or a previous process left a stale lock. Stop all Nodus servers using the vault; if none are running, remove "${VAULT_PROCESS_LOCK_FILE}" and retry.`,
        { path: VAULT_PROCESS_LOCK_FILE, details: { paths: [VAULT_PROCESS_LOCK_FILE] } },
      );
    }
    throw storageFailure(error, 'Acquire vault process lock', VAULT_PROCESS_LOCK_FILE);
  }

  try {
    await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    let cleanupFailed = false;
    await handle.close().catch(() => { cleanupFailed = true; });
    await unlink(path).catch(() => { cleanupFailed = true; });
    if (cleanupFailed) {
      throw new StorageError(
        'STORAGE_FAILURE',
        `Could not initialize or clean up "${VAULT_PROCESS_LOCK_FILE}". Stop all Nodus servers using the vault, inspect the lock file, and remove it before retrying.`,
        { cause: error, path: VAULT_PROCESS_LOCK_FILE, details: { paths: [VAULT_PROCESS_LOCK_FILE] } },
      );
    }
    throw storageFailure(error, 'Write vault process lock', VAULT_PROCESS_LOCK_FILE);
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
    await releaseProcessLock(path, handle, owner.token);
  } catch (error) {
    throw new StorageError(
      'STORAGE_FAILURE',
      `Could not release "${VAULT_PROCESS_LOCK_FILE}"; the operation ${succeeded ? 'may have completed' : 'also failed'}. Stop all Nodus servers using the vault, inspect the affected data, then remove the lock file before retrying.`,
      { cause: error, path: VAULT_PROCESS_LOCK_FILE, details: { paths: [VAULT_PROCESS_LOCK_FILE] } },
    );
  }

  if (!succeeded) throw operationError;
  return result as T;
}

async function releaseProcessLock(path: string, handle: FileHandle, token: string): Promise<void> {
  await handle.close();
  let owner: unknown;
  try {
    owner = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw storageFailure(error, 'Verify vault process lock', VAULT_PROCESS_LOCK_FILE);
  }
  if (
    typeof owner !== 'object' || owner === null ||
    !('token' in owner) || owner.token !== token
  ) {
    throw new StorageError('CONFLICT', `Ownership of "${VAULT_PROCESS_LOCK_FILE}" changed during the operation`, {
      path: VAULT_PROCESS_LOCK_FILE,
      details: { paths: [VAULT_PROCESS_LOCK_FILE] },
    });
  }
  try {
    await unlink(path);
  } catch (error) {
    throw storageFailure(error, 'Remove vault process lock', VAULT_PROCESS_LOCK_FILE);
  }
}
