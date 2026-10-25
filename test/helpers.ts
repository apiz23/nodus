import { NodusError } from '../src/domain/errors.js';
import { StorageError } from '../src/storage/errors.js';

export function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof NodusError ? error.code : `non-Nodus error: ${String(error)}`;
  }
}

export async function storageErrorCode(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return error instanceof StorageError ? error.code : `non-Storage error: ${String(error)}`;
  }
}
