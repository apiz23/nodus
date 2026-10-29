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
export { DATABASE_VIEW_FORMAT, DATABASE_VIEW_VERSION, parseDatabaseView, serializeDatabaseView, diagnoseDatabaseView, validateViewReferences, type DatabaseView, type DatabaseViewType, type DatabaseViewSettings, type ViewFilter, type ViewFilterOperator, type ViewSort, type DatabaseViewDiagnostic } from './database/database-view.js';
export {
  NOTE_PROPERTIES_FORMAT,
  NOTE_PROPERTIES_VERSION,
  projectNoteProperties,
  setNotePropertyValue,
  type NoteDatabaseRow,
  type NotePropertyProjection,
  type NotePropertyValue,
  type SetNotePropertyInput,
  type SetNotePropertyResult,
  type StructuredDataIssue,
  type StructuredDataIssueCode,
} from './database/note-properties.js';
export {
  FileSystemVault,
  StorageError,
  applyImport,
  createBackup,
  exportVault,
  isStorageError,
  planImport,
  previewRestore,
  restoreBackup,
  validateBackup,
  type BackupManifest,
  type BackupManifestApp,
  type BackupManifestCounts,
  type BackupManifestFile,
  type BackupManifestFormats,
  type BackupOptions,
  type BackupReport,
  type BackupValidation,
  type DatabaseStore,
  type DatabaseSummary,
  type DatabaseViewStore,
  type DatabaseViewSummary,
  type DatabaseViewWriteOptions,
  type ExportReport,
  type ImportOptions,
  type ImportPlan,
  type ImportReport,
  type NoteStore,
  type NoteSummary,
  type RestorePreview,
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

export { buildLinkIndex, createLinkIndexCache, type LinkIndex, type IndexedLink, type IndexedNote } from './links/link-index.js';

export { buildSearchIndex, searchIndex, type SearchIndex, type SearchResult, type SearchMatch, type SearchField } from './search/search-index.js';

export { projectRelations, configurationIssues, type RelationReference, type RelatedRow } from './database/relations.js';
export { ROLLUP_OPERATIONS, databaseVersion, isDerivedProperty, type RollupOperation } from './database/schema.js';
