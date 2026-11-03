/**
 * DTOs for the local UI API.
 *
 * These types are shared by the Node middleware and the browser client. They
 * deliberately contain no filesystem, Node, or relay types.
 */

import type { BackupManifest, FolderImpact, VaultAttachment } from '../storage/contracts.js';
import type { DatabaseView, DatabaseViewDiagnostic } from '../database/database-view.js';
import type { AutomationExecution, DatabaseAutomation } from '../database/automations.js';
import type {
  NoteDatabaseRow,
  NotePropertyValue as DatabaseNotePropertyValue,
  StructuredDataIssue,
} from '../database/note-properties.js';
import type {
  NotePropertyDefinition,
  NotePropertyValue,
  PropertyCatalog,
  PropertyCatalogMutation,
} from '../properties/catalog.js';
import type { TagOperation } from '../domain/tags.js';

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
  | 'multi-select' | 'relation' | 'rollup' | 'formula';

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
  formula?: import('../database/schema.js').Property['formula'];
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

/** Target records available to the relation picker. Search metadata is limited to note aliases and tags. */
export interface UiRelationCandidate {
  id: string;
  title: string;
  path: string;
  status: 'resolved';
  aliases: string[];
  tags: string[];
}

/** Bounded server-side search results for a relation picker. */
export interface UiRelationCandidatesResponse {
  candidates: UiRelationCandidate[];
  /** True when more compatible records match than the requested limit. */
  truncated: boolean;
}

export interface UiDatabaseRowsResponse {
  relationCandidates?: Record<string, UiRelationCandidate[]>;
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
  /** Existing views in persistent display order. */
  views: UiDatabaseView[];
  order: UiDatabaseViewOrder;
}

export interface UiDatabaseAutomationsResponse { databaseId: string; contentHash: string | null; automations: DatabaseAutomation[] }
export interface UiAutomationHistoryResponse { executions: AutomationExecution[] }

/** Persistent saved-view ordering; `contentHash` is null for legacy databases. */
export interface UiDatabaseViewOrder {
  databaseId: string;
  viewIds: string[];
  revision: number;
  contentHash: string | null;
}

export interface UiSearchResult extends UiNoteSummary {
  snippet: string;
  /** Structured context and offsets for accessible, text-only match highlighting. */
  match?: import('../search/search-index.js').SearchMatch;
}

export interface UiSearchResponse {
  results: UiSearchResult[];
  metadataIssueCount: number;
  catalogIssue?: string;
}

export interface UiSearchMetadataResponse {
  tags: string[];
  properties: NotePropertyDefinition[];
  metadataIssueCount: number;
  catalogIssue?: string;
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

export type UiVaultSetupReason = 'first-run' | 'saved-vault-unavailable' | 'preferences-invalid' | 'environment-vault-unavailable';

export interface UiVaultSetupState {
  setupRequired: true;
  reason: UiVaultSetupReason;
  /** Present only when a previously selected location needs recovery. */
  savedVaultPath?: string;
  message: string;
}

export type UiVaultBootstrap =
  | (UiVaultStatus & { setupRequired?: false })
  | UiVaultSetupState;

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
  value?: DatabaseNotePropertyValue;
  /** Clear one value while retaining database membership. Cannot accompany value. */
  remove?: true;
  baseHash: string;
  /** Must be true to create nodus_data or add database membership to this note. */
  confirmCreate?: boolean;
}

export interface UiPropertyCatalogResponse {
  catalog: PropertyCatalog;
  /** SHA-256 of raw catalog bytes; null means no catalog file exists yet. */
  contentHash: string | null;
}

export interface UiPropertyCatalogMutationInput {
  mutation: PropertyCatalogMutation;
  /** Expected catalog hash, or null if the catalog has not yet been created. */
  baseHash: string | null;
}

/** Registered general-property values only; unregistered YAML remains in the Markdown source. */
export interface UiGeneralNotePropertiesResponse {
  noteId: string;
  path: string;
  contentHash: string;
  values: Record<string, NotePropertyValue>;
  issues: import('../properties/catalog.js').PropertyValueIssue[];
}

export type UiCreateNoteProperty = NotePropertyDefinition;

export type UiSetGeneralNotePropertyInput =
  | { baseHash: string; value: NotePropertyValue }
  | { baseHash: string; unset: true };

export interface UiSetGeneralNotePropertyResponse {
  note: UiNote;
  propertyId: string;
  key: string;
  /** Omitted after explicit unset. */
  value?: NotePropertyValue;
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
    databaseViewOrders?: number;
    attachments?: number;
    propertyCatalog?: number;
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
  /** Optional initial tags; normalized and duplicate-checked on creation. */
  tags?: string[];
}

export interface UiUpdateNoteTagsInput {
  baseHash: string;
  operation: TagOperation;
}

export interface UiUpdateNoteTagsResponse {
  note: UiNote;
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
  outgoing: UiOutgoingLink[];
}

/** Outgoing wiki-link occurrence with current target metadata where resolved. */
export type UiOutgoingLink = import('../links/backlinks.js').OutgoingLink;

/** Incoming database relations are derived from forward note metadata. */
export interface UiRelationBacklink {
  sourceId: string;
  sourceTitle: string;
  sourcePath: string;
  sourceDatabaseId: string;
  sourceDatabaseName: string;
  propertyId: string;
  propertyName: string;
  reciprocalPropertyId?: string;
  reciprocalPropertyName?: string;
  status: 'resolved' | 'incompatible';
}

export interface UiRelationBacklinksResponse {
  backlinks: UiRelationBacklink[];
}

/** Discovery results share the core index's stable source IDs and body locations. */
export type UiLinkSuggestion = import('../links/link-repair.js').LinkSuggestion;

export type UiUnresolvedLink = import('../links/link-index.js').IndexedLink & {
  /** Deterministic, bounded repair candidates computed from the same snapshot. */
  suggestions: UiLinkSuggestion[];
};

export type UiAmbiguousLink = import('../links/link-index.js').IndexedLink & {
  /** Current candidates for the target; the source note is excluded. */
  suggestions: UiLinkSuggestion[];
};

export interface UiDiscoveryResponse {
  unresolved: UiUnresolvedLink[];
  ambiguous: UiAmbiguousLink[];
  orphans: import('../links/link-index.js').IndexedNote[];
  /** Notes with no confirmed incoming or outgoing internal links (self-links excluded). */
  isolated: import('../links/link-index.js').IndexedNote[];
}

/** Rewrites one wiki-link occurrence to a chosen note; the target is verified against `baseHash`. */
export interface UiRepairWikiLinkInput {
  baseHash: string;
  start: number;
  end: number;
  target: string;
  replacementNoteId: string;
  /** Preserve the original display text when omitted. */
  display?: string;
  /** Defaults to true; a title target is used only when it resolves uniquely. */
  pin?: boolean;
}

export interface UiRepairWikiLinkResponse {
  note: UiNote;
  changed: boolean;
  /** True when the rewritten link uses the replacement note's stable UUID. */
  pinned: boolean;
}

export interface UiSaveNoteResponse {
  note: UiNote;
  /**
   * Present when a title change retained the previous title as an alias so
   * confirmed incoming title links keep resolving. Path links are unchanged.
   */
  preservedLinks?: { alias: string; linkCount: number };
}

export type UiNoteGraph = import('../links/graph.js').NoteGraph;
export type UiGraphNoteMetric = import('../links/graph-analytics.js').GraphNoteMetric;
export type UiRelatedNote = import('../links/related-notes.js').RelatedNote;
export type UiGraphCluster = import('../links/graph-analytics.js').GraphComponentSummary;
export type UiGraphPathResult = import('../links/graph-paths.js').GraphPathResult;
export type UiGraphClusterInsights = import('../links/graph-cluster-insights.js').GraphClusterInsights;

export interface UiKnowledgeInsights {
  metrics: {
    totalNotes: number;
    linkedNotes: number;
    isolatedNotes: number;
    unresolvedLinks: number;
    ambiguousLinks: number;
    selfLinkEdges: number;
    selfLinkOccurrences: number;
    componentCount: number;
    largestComponentSize: number;
  };
  mostConnected: UiGraphNoteMetric[];
  clusters: Array<{
    id: string;
    size: number;
    totalDegree: number;
    representative: UiGraphNoteMetric;
    members: UiGraphNoteMetric[];
    truncated: boolean;
  }>;
  recentNotes: UiNoteSummary[];
}

export interface UiRelatedNotesResponse {
  noteId: string;
  related: UiRelatedNote[];
}
