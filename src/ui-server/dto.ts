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
}

export interface UiMoveNoteInput {
  path: string;
  baseHash: string;
}

export interface UiDeleteNoteInput {
  baseHash: string;
}
