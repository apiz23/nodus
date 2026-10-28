import type { DatabaseDefinition } from '../database/schema.js';
import type { DatabaseView } from '../database/database-view.js';
import type { Note } from '../domain/note.js';

export interface NoteSummary {
  id: string;
  path: string;
  title: string;
  updatedAt: string;
}

export interface DatabaseSummary {
  id: string;
  name: string;
  path: string;
  propertyCount: number;
}

export type StorageIssueCode =
  | 'INVALID_CONTENT'
  | 'UNSUPPORTED_VERSION'
  | 'DUPLICATE_ID'
  | 'UNSAFE_PATH'
  | 'INCOMPLETE_WRITE';

export interface StorageIssue {
  code: StorageIssueCode;
  /** Workspace-relative path using `/` separators. */
  path: string;
  message: string;
}

export interface StorageHealth {
  notes: NoteSummary[];
  databases: DatabaseSummary[];
  databaseViews: DatabaseViewSummary[];
  issues: StorageIssue[];
}

/** One serialized document, as stored or about to be stored. */
export interface VaultEntry {
  kind: 'note' | 'database' | 'database-view';
  id: string;
  path: string;
  text: string;
  /** Original file bytes when snapshot comes from filesystem storage. */
  rawBytes?: Buffer;
}

/** Optional conditional write parameters. */
export interface ConditionalWriteOptions {
  /** SHA-256 of raw file bytes. Throws `STALE_WRITE` with current hash if mismatch. */
  expectedHash?: string;
}

export interface NoteStore {
  listNotes(): Promise<NoteSummary[]>;
  readNote(id: string): Promise<Note>;
  readNoteAtPath(path: string): Promise<Note>;
  /** Fails with `CONFLICT` if the path exists or `DUPLICATE_ID` if the ID exists. */
  createNote(note: Note): Promise<void>;
  /** Replaces an existing note; the path may not change. Fails with `NOT_FOUND`, `CONFLICT`, or `STALE_WRITE`. */
  replaceNote(note: Note, options?: ConditionalWriteOptions): Promise<void>;
  /** Moves a note to a new relative path, keeping its ID and bytes. Fails with `STALE_WRITE` on source. */
  moveNote(id: string, toPath: string, options?: ConditionalWriteOptions): Promise<Note>;
  deleteNote(id: string, options?: ConditionalWriteOptions): Promise<void>;
}

export interface DatabaseStore {
  listDatabases(): Promise<DatabaseSummary[]>;
  readDatabase(id: string): Promise<DatabaseDefinition>;
  createDatabase(database: DatabaseDefinition): Promise<void>;
  replaceDatabase(database: DatabaseDefinition, options?: ConditionalWriteOptions): Promise<void>;
  deleteDatabase(id: string): Promise<void>;
}

export interface DatabaseViewSummary {
  view: DatabaseView;
  path: string;
  /** SHA-256 of raw view JSON bytes for conditional replacement/deletion. */
  hash: string;
}

export interface DatabaseViewStore {
  listDatabaseViews(databaseId?: string): Promise<DatabaseViewSummary[]>;
  readDatabaseView(databaseId: string, viewId: string): Promise<DatabaseViewSummary>;
  duplicateDatabaseView(databaseId: string, viewId: string, newId: string, name: string, options: Required<ConditionalWriteOptions>): Promise<void>;
  createDatabaseView(view: DatabaseView, options?: DatabaseViewWriteOptions): Promise<void>;
  replaceDatabaseView(view: DatabaseView, options?: DatabaseViewWriteOptions): Promise<void>;
  deleteDatabaseView(databaseId: string, viewId: string, options?: ConditionalWriteOptions): Promise<void>;
}

export interface DatabaseViewWriteOptions extends ConditionalWriteOptions {
  /** Raw schema hash used while validating property/option references. */
  expectedDatabaseHash?: string;
}

export interface ImportOptions {
  /** Required to replace existing notes or databases. Defaults to false. */
  overwrite?: boolean;
}

export interface ImportReport {
  notes: number;
  databases: number;
  databaseViews: number;
}

export interface ImportPlan {
  entries: VaultEntry[];
  notes: Note[];
  databases: DatabaseDefinition[];
  databaseViews?: DatabaseView[];
}

export interface ExportReport {
  targetDir: string;
  notes: number;
  databases: number;
  databaseViews: number;
}

export interface BackupManifestFile {
  kind: 'note' | 'database' | 'database-view';
  id: string;
  path: string;
  sha256: string;
  /** UTF-8 byte length of the file content. Absent on legacy v1 manifests. */
  bytes?: number;
}

/** Application that wrote the backup; optional on legacy v1 manifests. */
export interface BackupManifestApp {
  name: string;
  version: string;
}

/** Document format versions the writing build understood; optional on legacy v1 manifests. */
export interface BackupManifestFormats {
  note: number;
  database: number;
  backup: number;
  databaseView?: number;
}

/** File counts by kind; optional on legacy v1 manifests, cross-checked when present. */
export interface BackupManifestCounts {
  notes: number;
  databases: number;
  databaseViews?: number;
}

export interface BackupManifest {
  format: 'nodus-backup';
  version: 1 | 2;
  createdAt: string;
  app?: BackupManifestApp;
  formats?: BackupManifestFormats;
  counts?: BackupManifestCounts;
  files: BackupManifestFile[];
  /**
   * SHA-256 of the canonical serialization of this manifest with `digest`
   * itself excluded. Optional on legacy v1 manifests; when present it must
   * match or validation fails with `CORRUPT_BACKUP`.
   */
  digest?: string;
}

/** Read-only result of comparing a validated backup against a live vault. */
export interface RestorePreview {
  manifest: BackupManifest;
  counts: { notes: number; databases: number; databaseViews: number };
  /** ID and path conflicts a restore would hit without `overwrite: true`. */
  conflicts: { ids: string[]; paths: string[] };
}

export interface BackupReport {
  targetDir: string;
  notes: number;
  databases: number;
  databaseViews: number;
}

export interface BackupValidation {
  manifest: BackupManifest;
  entries: VaultEntry[];
  notes: Note[];
  databases: DatabaseDefinition[];
  databaseViews: DatabaseView[];
}

export interface BackupOptions {
  /** Injectable clock for deterministic manifests and tests. */
  now?: string;
}

/**
 * The complete local vault contract.
 *
 * Implementations must not change the Phase 1 note or database formats.
 */
export interface VaultStorage extends NoteStore, DatabaseStore, DatabaseViewStore {
  readonly root: string;
  /** All valid documents as raw text, notes first, each group sorted by path. */
  snapshot(): Promise<VaultEntry[]>;
  /** Non-throwing diagnostic scan. I/O errors are still thrown. */
  checkHealth(): Promise<StorageHealth>;
  /** Applies a plan produced by `planImport`, validating every conflict first. */
  applyImport(plan: ImportPlan, options?: ImportOptions): Promise<ImportReport>;
}
