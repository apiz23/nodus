export type RelayErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_PAIRING_CODE'
  | 'PAIRING_CODE_EXPIRED'
  | 'DEVICE_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'RATE_LIMITED'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'VAULT_MISMATCH'
  | 'BOOTSTRAP_REQUIRED'
  | 'DOCUMENT_RETIRED'
  | 'STALE_SNAPSHOT'
  | 'CONFLICT';

export interface RelayErrorDetails {
  field?: string;
  [key: string]: unknown;
}

export class RelayError extends Error {
  readonly code: RelayErrorCode;
  readonly statusCode: number;
  readonly requestId: string;
  readonly details?: RelayErrorDetails;

  constructor(
    code: RelayErrorCode,
    message: string,
    options: { statusCode?: number; requestId: string; details?: RelayErrorDetails; cause?: unknown } = {
      requestId: 'unknown',
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RelayError';
    this.code = code;
    this.statusCode = options.statusCode ?? statusFor(code);
    this.requestId = options.requestId;
    this.details = options.details;
  }

  toResponse() {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId: this.requestId,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

function statusFor(code: RelayErrorCode): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401;
    case 'INVALID_PAIRING_CODE':
    case 'PAIRING_CODE_EXPIRED':
      return 403;
    case 'DEVICE_NOT_FOUND':
    case 'NOT_FOUND':
      return 404;
    case 'INVALID_INPUT':
      return 400;
    case 'RATE_LIMITED':
      return 429;
    case 'METHOD_NOT_ALLOWED':
      return 405;
    case 'VAULT_MISMATCH':
    case 'BOOTSTRAP_REQUIRED':
    case 'DOCUMENT_RETIRED':
      return 410;
    case 'STALE_SNAPSHOT':
    case 'CONFLICT':
      return 409;
    default:
      return 500;
  }
}

export function isRelayError(value: unknown): value is RelayError {
  return value instanceof RelayError;
}
