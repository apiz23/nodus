export {
  StorageError,
  isStorageError,
  type StorageErrorCode,
  type StorageErrorDetails,
  type StorageErrorOptions,
} from './errors.js';

export type {
  BackupManifest,
  BackupManifestFile,
  BackupOptions,
  BackupReport,
  BackupValidation,
  DatabaseStore,
  DatabaseSummary,
  ExportReport,
  ImportOptions,
  ImportPlan,
  ImportReport,
  NoteStore,
  NoteSummary,
  StorageHealth,
  StorageIssue,
  StorageIssueCode,
  VaultEntry,
  VaultStorage,
} from './contracts.js';

export { FileSystemVault } from './fs/vault.js';
export { exportVault } from './portable/export.js';
export { applyImport, planImport } from './portable/import.js';
export { createBackup, restoreBackup, validateBackup } from './backup/backup.js';
