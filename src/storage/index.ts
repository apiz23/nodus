export {
  StorageError,
  isStorageError,
  type StorageErrorCode,
  type StorageErrorDetails,
  type StorageErrorOptions,
} from './errors.js';

export {
  assessCopyPublicationEvidence,
  assessCopyPublicationTemporalPlausibility,
  copyPublicationReceiptDigest,
  createCopyPublicationIdentity,
  deriveCopyPublicationPreparedEventDigest,
  matchesPreparedCopyIdentity,
  validateCopyPublicationIdentity,
  PUBLICATION_MAX_CLOCK_SKEW_MS,
  PUBLICATION_MAX_OBSERVATION_AGE_MS,
  type CopyDestinationNoteId,
  type CopyJournalOperationId,
  type CopyPublicationAttemptId,
  type CopyPublicationCollisionKey,
  type CopyPublicationEvidenceDocument,
  type CopyPublicationIdentity,
  type CopyPublicationIdentityConstruction,
  type CopyPublicationNotePath,
  type CopyPublicationReceiptEvidence,
  type CopyPublicationReceiptDigestInput,
  type CopyPublicationSha256,
  type CopyPublicationVaultId,
  type CopySourceNoteId,
  type IdentityValidation,
  type PreparedCopyIdentityBinding,
  type PublicationDestinationObservation,
  type PublicationEvidenceClassification,
  type PublicationFilesystemObjectIdentity,
  type PublicationSourceObservation,
  type PublicationTemporalAssessment,
  type PublicationTemporalStatus,
} from './copy-publication.js';

export {
  FILESYSTEM_PUBLICATION_ALLOWLIST,
  assessFilesystemPublicationCapability,
  requireFilesystemPublicationCapability,
  type FilesystemPublicationCapabilityProbe,
  type FilesystemPublicationCapabilityTarget,
  type PublicationCapabilityAssessment,
  type PublicationPlatform,
  type PublicationPrimitiveSupport,
} from './fs/publication-capability.js';

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
  PortableExportSnapshot,
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
export { PORTABLE_EXPORT_FORMAT, PORTABLE_EXPORT_VERSION, PORTABLE_EXPORT_MANIFEST, PORTABLE_RESOURCE_KINDS, createPortableManifest, portableManifestDigest, serializePortableManifest, validatePortableExport, validatePortableManifest, validatePortablePath, sha256 as portableSha256, type PortableExportManifest, type PortableExportResource, type PortableResourceKind } from './portable/manifest.js';
export { applyImport, planImport, previewImport } from './portable/import.js';
export { createBackup, previewRestore, restoreBackup, validateBackup } from './backup/backup.js';
