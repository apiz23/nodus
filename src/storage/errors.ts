import { NodusError, type NodusErrorCode } from '../domain/errors.js';

export type StorageErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_ID'
  | 'UNSAFE_PATH'
  | 'INVALID_INPUT'
  | 'INVALID_CONTENT'
  | 'UNSUPPORTED_VERSION'
  | 'CORRUPT_BACKUP'
  | 'PARTIAL_WRITE'
  | 'STORAGE_FAILURE';

export interface StorageErrorDetails {
  /** Paths involved in the failure, workspace-relative where possible. */
  paths?: string[];
  /** IDs involved in the failure. */
  ids?: string[];
  /** Human-readable diagnostics, used by import and backup validation. */
  issues?: string[];
}

export interface StorageErrorOptions {
  cause?: unknown;
  path?: string;
  details?: StorageErrorDetails;
}

/**
 * Structured failure for the storage layer.
 *
 * Kept separate from `NodusError` so domain error codes stay stable. A domain
 * error that reaches storage is preserved as `cause`.
 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly path?: string;
  readonly details?: StorageErrorDetails;

  constructor(code: StorageErrorCode, message: string, options: StorageErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'StorageError';
    this.code = code;
    this.path = options.path;
    this.details = options.details;
  }
}

export function isStorageError(value: unknown): value is StorageError {
  return value instanceof StorageError;
}

/** Maps a Phase 1 validation error from on-disk content. */
export function wrapContentError(error: unknown, path: string): StorageError {
  if (error instanceof StorageError) return error;

  if (error instanceof NodusError) {
    return new StorageError(mapDomainCode(error.code), `${path}: ${error.message}`, {
      cause: error,
      path,
    });
  }

  return new StorageError('INVALID_CONTENT', `${path}: ${describe(error)}`, { cause: error, path });
}

/** Maps a Phase 1 validation error from caller-supplied data. */
export function wrapInputError(error: unknown, context: string): StorageError {
  if (error instanceof StorageError) return error;

  if (error instanceof NodusError) {
    const code: StorageErrorCode = error.code === 'UNSAFE_PATH' ? 'UNSAFE_PATH' : 'INVALID_INPUT';
    return new StorageError(code, `${context}: ${error.message}`, { cause: error });
  }

  return new StorageError('INVALID_INPUT', `${context}: ${describe(error)}`, { cause: error });
}

export function storageFailure(error: unknown, action: string, path?: string): StorageError {
  if (error instanceof StorageError) return error;
  const where = path === undefined ? '' : ` "${path}"`;
  return new StorageError('STORAGE_FAILURE', `${action}${where} failed: ${describe(error)}`, {
    cause: error,
    ...(path === undefined ? {} : { path }),
  });
}

function mapDomainCode(code: NodusErrorCode): StorageErrorCode {
  switch (code) {
    case 'UNSUPPORTED_VERSION':
      return 'UNSUPPORTED_VERSION';
    case 'UNSAFE_PATH':
      return 'UNSAFE_PATH';
    default:
      return 'INVALID_CONTENT';
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
