/**
 * DTOs for the local UI API.
 *
 * These types are shared by the Node middleware and the browser client. They
 * deliberately contain no filesystem, Node, or relay types.
 */

import type { BackupManifest, FolderImpact, VaultAttachment } from '../storage/contracts.js';
import type { DatabaseView, DatabaseViewDiagnostic } from '../database/database-view.js';
import type {
  NoteDatabaseRow,
  NotePropertyValue,
  StructuredDataIssue,
} from '../database/note-properties.js';

export type {
  BackupManifest,
  BackupReport,
  ImportReport,
  RestorePreview,
} from '../storage/contracts.js';

export type UiPropertyType =
  | 'text'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'select'
  | 'multi-select' | 'relation' | 'rollup';

export interface UiSelectOption {
  id: string;
  name: string;
}

export interface UiProperty {
  id: string;
  name: string;
  type: UiPropertyType;
  options?: UiSelectOption[];
  relation?: import('../database/schema.js').Property['relation'];
  rollup?: import('../database/schema.js').Property['rollup'];
}

export interface UiNoteSummary {
  id: string;
  title: string;
  path: string;
  updatedAt: string;
  aliases: string[];
  icon: string | null;
}

export interface UiNote extends UiNoteSummary {
  body: string;
  createdAt: string;
  tags: string[];
  aliases: string[];
  metadataKeys: string[];
  /** SHA-256 of the raw Markdown file. Used to detect external edits. */
  contentHash: string;
}

export interface UiDatabase {
  id: string;
  name: string;
  path: string;
  /** SHA-256 of raw schema bytes; required to prevent stale schema replacement. */
  contentHash: string;
  properties: UiProperty[];
}

export type UiDatabaseDefinition = Pick<UiDatabase, 'id' | 'name' | 'properties'>;

export interface UiDatabaseRow extends NoteDatabaseRow {
  relations?: Record<string, import('../database/relations.js').RelationReference[]>;
  title: string;
  updatedAt: string;
  /** Raw note hash used as the conditional property-update revision. */
  contentHash: string;
  /** Any issue blocks edits because the structured setter preserves source data by refusing normalization. */
  issues: StructuredDataIssue[];
}

export interface UiDatabaseRowsResponse {
  relationCandidates?: Record<string, import('../database/relations.js').RelationReference[]>;
  databaseId: string;
  /** Raw schema hash from the same root-locked snapshot as the projected rows. */
  schemaHash: string;
  rows: UiDatabaseRow[];
  /** Includes opaque/future namespaces that cannot safely be assigned to this database. */
  diagnostics: StructuredDataIssue[];
}

export interface UiDatabaseView {
  view: DatabaseView;
  path: string;
  contentHash: string;
  diagnostics: DatabaseViewDiagnostic[];
}

export interface UiDatabaseViewsResponse {
  databaseId: string;
  schemaHash?: string;
  views: UiDatabaseView[];
}

export interface UiSearchResult extends UiNoteSummary {
  snippet: string;
  /** Structured context and offsets for accessible, text-only match highlighting. */
  match?: import('../search/search-index.js').SearchMatch;
}

export interface UiHealthIssue {
  code: string;
  path: string;
  message: string;
}

export type UiVaultPickResult =
  | { canceled: true }
  | { canceled: false; status: UiVaultStatus };

export interface UiOpenVaultInput {
  path: string;
}

export interface UiVaultStatus {
  vault: {
    name: string;
    path: string;
  };
  counts: {
    notes: number;
    databases: number;
    issues: number;
  };
  health: {
    issues: UiHealthIssue[];
  };
  sync: {
    status: 'not-connected';
    label: string;
    detail: string;
  };
}

export interface UiApiErrorBody {
  error: {
    code: string;
    message: string;
    currentHash?: string;
    /** Workspace-relative paths already written when an operation stopped early (`PARTIAL_WRITE`). */
    paths?: string[];
    /** Per-file diagnostics from backup validation and content checks (`CORRUPT_BACKUP`, `INVALID_CONTENT`). */
    issues?: string[];
    /** Structured-property validation diagnostics; source values remain in Markdown. */
    structuredDataIssues?: StructuredDataIssue[];
  };
}

export interface UiNotePropertiesResponse {
  noteId: string;
  path: string;
  /** SHA-256 of raw Markdown bytes; required by the explicit update operation. */
  contentHash: string;
  rows: NoteDatabaseRow[];
  issues: StructuredDataIssue[];
}

/** Explicitly updates one schema-validated property in Markdown frontmatter. */
export interface UiSetNotePropertyInput {
  databaseId: string;
  propertyId: string;
  value?: NotePropertyValue;
  /** Clear one value while retaining database membership. Cannot accompany value. */
  remove?: true;
  baseHash: string;
  /** Must be true to create nodus_data or add database membership to this note. */
  confirmCreate?: boolean;
}

export interface UiCreateBackupInput {
  targetDir: string;
}

export interface UiValidateBackupInput {
  dir: string;
}

export interface UiRestoreInput {
  dir: string;
  /** Merge only when `true`; the server defaults to `false` (never overwrite). */
  overwrite?: boolean;
}

export interface UiBackupValidationResult {
  manifest: BackupManifest;
  counts: {
    notes: number;
    databases: number;
    databaseViews: number;
    attachments?: number;
  };
}

export interface UiCreateNoteInput {
  title?: string;
  /** Existing vault-relative folder; omitted uses the default notes directory. */
  folder?: string;
  /** Optional initial Markdown content, used when creating a conflict copy. */
  body?: string;
  /** Optional page icon to preserve when creating a copy. */
  icon?: string | null;
}

export type UiFolderImpact = FolderImpact;
export type UiAttachment = VaultAttachment;

export interface UiSaveNoteInput {
  title: string;
  body: string;
  baseHash: string;
  /** Omitted preserves the existing icon; `null` removes it; a string sets it. */
  icon?: string | null;
}

export interface UiMoveNoteInput {
  path: string;
  baseHash: string;
}

export interface UiDeleteNoteInput {
  baseHash: string;
}

export interface UiBacklink {
  /** Stable UUID of the referencing note. */
  sourceId: string;
  /** Current title of the referencing note. */
  sourceTitle: string;
  /** Whitespace-compacted context around the first link occurrence. */
  snippet: string;
  /** Number of links to the target within the source body. */
  count: number;
  /**
   * True when the source's link is ambiguous across candidate notes that
   * include this target. Ambiguous mentions are never confirmed backlinks.
   */
  ambiguous: boolean;
}

export interface UiBacklinksResponse {
  backlinks: UiBacklink[];
}

/** Discovery results share the core index's stable source IDs and body locations. */
export interface UiDiscoveryResponse {
  unresolved: import('../links/link-index.js').IndexedLink[];
  ambiguous: import('../links/link-index.js').IndexedLink[];
  orphans: import('../links/link-index.js').IndexedNote[];
}

export type UiNoteGraph = import('../links/graph.js').NoteGraph;
