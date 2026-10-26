/**
 * DTOs for the local UI API.
 *
 * These types are shared by the Node middleware and the browser client. They
 * deliberately contain no filesystem, Node, or relay types.
 */

export type UiPropertyType =
  | 'text'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'select'
  | 'multi-select';

export interface UiSelectOption {
  id: string;
  name: string;
}

export interface UiProperty {
  id: string;
  name: string;
  type: UiPropertyType;
  options?: UiSelectOption[];
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
  properties: UiProperty[];
}

export interface UiSearchResult extends UiNoteSummary {
  snippet: string;
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
  };
}

export interface UiCreateNoteInput {
  title?: string;
}

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
