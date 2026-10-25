export type NodusErrorCode =
  | 'INVALID_FRONTMATTER'
  | 'INVALID_FIELD'
  | 'UNSUPPORTED_VERSION'
  | 'UNSAFE_PATH'
  | 'INVALID_DATABASE'
  | 'MIGRATION_FAILED';

export class NodusError extends Error {
  readonly code: NodusErrorCode;

  constructor(code: NodusErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NodusError';
    this.code = code;
  }
}
