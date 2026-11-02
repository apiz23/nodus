export {
  StorageError,
  isStorageError,
  type StorageErrorCode,
  type StorageErrorDetails,
  type StorageErrorOptions,
} from './errors.js';

export type {
  BackupManifest,
  BackupManifestApp,
  BackupManifestCounts,
  BackupManifestFile,
  BackupManifestFormats,
  BackupManifestPropertyCatalog,
  BackupOptions,
  BackupReport,
  BackupValidation,
  DatabaseStore,
  DatabaseSummary,
  DatabaseViewStore,
  DatabaseViewSummary,
  DatabaseViewOrder,
  DatabaseViewOrderFileSnapshot,
  DatabaseViewOrderStore,
  DatabaseViewWriteOptions,
  ExportReport,
  ImportOptions,
  ImportPlan,
  ImportReport,
  NoteStore,
  NoteSummary,
  PropertyCatalogFile,
  RestorePreview,
  StorageHealth,
  StorageIssue,
  StorageIssueCode,
  TemplateStore,
  VaultEntry,
  VaultStorage,
} from './contracts.js';

export { TEMPLATE_FORMAT, TEMPLATE_VERSION, parseTemplate, parseTemplates, resolveNoteTemplate, serializeTemplates, type DatabaseTemplate, type NoteTemplate, type NodusTemplate, type TemplateVariable } from '../database/templates.js';

export { FileSystemVault } from './fs/vault.js';
export { DATABASE_VIEW_FORMAT, DATABASE_VIEW_VERSION, parseDatabaseView, serializeDatabaseView, diagnoseDatabaseView, validateViewReferences, type DatabaseView, type ViewFilter, type ViewFilterOperator, type ViewSort, type DatabaseViewDiagnostic } from '../database/database-view.js';
export { exportVault } from './portable/export.js';
export { applyImport, planImport } from './portable/import.js';
export { createBackup, previewRestore, restoreBackup, validateBackup } from './backup/backup.js';
