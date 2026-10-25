export { NodusError, type NodusErrorCode } from './domain/errors.js';
export { isUuidV4, isUuidShaped } from './domain/ids.js';
export { validateNotePath } from './domain/paths.js';
export { NOTE_FORMAT_VERSION, createNote, isTimestamp, validateNote, type CreateNoteInput, type Note } from './domain/note.js';
export { parseNote, serializeNote } from './format/note-format.js';
export { applyMigration, type Migration } from './format/migration.js';
export { parseWikiLinks, resolveLink, type LinkableNote, type LinkResolution, type WikiLink } from './links/wikilink.js';
export {
  DATABASE_FORMAT,
  DATABASE_FORMAT_VERSION,
  PROPERTY_TYPES,
  parseDatabase,
  serializeDatabase,
  type DatabaseDefinition,
  type Property,
  type PropertyType,
  type SelectOption,
} from './database/schema.js';
export {
  FileSystemVault,
  StorageError,
  applyImport,
  createBackup,
  exportVault,
  isStorageError,
  planImport,
  restoreBackup,
  validateBackup,
  type BackupManifest,
  type BackupManifestFile,
  type BackupOptions,
  type BackupReport,
  type BackupValidation,
  type DatabaseStore,
  type DatabaseSummary,
  type ExportReport,
  type ImportOptions,
  type ImportPlan,
  type ImportReport,
  type NoteStore,
  type NoteSummary,
  type StorageErrorCode,
  type StorageErrorDetails,
  type StorageErrorOptions,
  type StorageHealth,
  type StorageIssue,
  type StorageIssueCode,
  type VaultEntry,
  type VaultStorage,
} from './storage/index.js';
export {
  SyncClient,
  SyncHttpError,
  type PairResult,
  type SyncClientOptions,
} from './sync/client.js';
export {
  SyncStateStore,
  type ApplyLedgerEntry,
  type DocumentState,
  type OutboxOperation,
} from './sync/state.js';
export type {
  ChangeInput,
  ChangeRecord,
  DocumentContent,
  DocumentKind,
  DocumentRef,
  MutationResult,
  PullResponse,
  SnapshotPage,
  SyncIdentity,
  VaultIdentity,
} from './sync/contracts.js';
