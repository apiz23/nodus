import type {
  BackupReport,
  ImportReport,
  RestorePreview,
  UiBacklinksResponse,
  UiDiscoveryResponse,
  UiNoteGraph,
  UiBackupValidationResult,
  UiCreateBackupInput,
  UiCreateNoteInput,
  UiDatabase,
  UiDatabaseDefinition,
  UiDatabaseRowsResponse,
  UiDatabaseView,
  UiDatabaseViewsResponse,
  UiPropertyCatalogResponse,
  UiGeneralNotePropertiesResponse,
  UiPropertyCatalogMutationInput,
  UiSetGeneralNotePropertyInput,
  UiSetGeneralNotePropertyResponse,
  UiUpdateNoteTagsInput,
  UiUpdateNoteTagsResponse,
  UiDeleteNoteInput,
  UiMoveNoteInput,
  UiNote,
  UiNotePropertiesResponse,
  UiNoteSummary,
  UiRestoreInput,
  UiSaveNoteInput,
  UiSetNotePropertyInput,
  UiOpenVaultInput,
  UiSearchResult,
  UiSearchResponse,
  UiSearchMetadataResponse,
  UiValidateBackupInput,
  UiVaultPickResult,
  UiVaultStatus,
  UiApiErrorBody,
  UiFolderImpact,
  UiAttachment,
} from '../../src/ui-server/dto.js';
import type { DatabaseView } from '../../src/database/database-view.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly currentHash?: string;
  readonly issues?: string[];
  readonly paths?: string[];
  readonly structuredDataIssues?: UiApiErrorBody['error']['structuredDataIssues'];

  constructor(
    status: number,
    code: string,
    message: string,
    currentHash?: string,
    issues?: string[],
    paths?: string[],
    structuredDataIssues?: UiApiErrorBody['error']['structuredDataIssues'],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.currentHash = currentHash;
    this.issues = issues;
    this.paths = paths;
    this.structuredDataIssues = structuredDataIssues;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the local Nodus API.');
  }

  const text = await response.text();
  let body: unknown = undefined;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }

  if (!response.ok) {
    const errorBody = body as
      | {
          error?: {
            code?: string;
            message?: string;
            currentHash?: string;
            paths?: string[];
            issues?: string[];
            structuredDataIssues?: UiApiErrorBody['error']['structuredDataIssues'];
          };
        }
      | undefined;
    throw new ApiError(
      response.status,
      errorBody?.error?.code ?? 'REQUEST_FAILED',
      errorBody?.error?.message ?? `Request failed with status ${response.status}.`,
      errorBody?.error?.currentHash,
      errorBody?.error?.issues,
      errorBody?.error?.paths,
      errorBody?.error?.structuredDataIssues,
    );
  }

  return body as T;
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export const api = {
  status(): Promise<UiVaultStatus> {
    return request<UiVaultStatus>('/api/status');
  },

  pickVault(): Promise<UiVaultPickResult> {
    return request<UiVaultPickResult>('/api/vault/pick', { method: 'POST' });
  },

  openVault(input: UiOpenVaultInput): Promise<UiVaultStatus> {
    return request<UiVaultStatus>('/api/vault/open', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  notes(): Promise<{ notes: UiNoteSummary[] }> {
    return request<{ notes: UiNoteSummary[] }>('/api/notes');
  },

  folders(): Promise<{ folders: string[] }> {
    return request<{ folders: string[] }>('/api/folders');
  },

  attachments(): Promise<{ attachments: UiAttachment[] }> {
    return request('/api/attachments');
  },

  async uploadAttachment(file: File): Promise<{ attachment: UiAttachment }> {
    return request(`/api/attachments?name=${encodeURIComponent(file.name)}`, {
      method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' },
    });
  },

  deleteAttachment(path: string, confirmReferenced = false): Promise<{ deleted: true }> {
    return request('/api/attachments', { method: 'DELETE', body: jsonBody({ path, confirmReferenced }) });
  },

  attachmentUrl(path: string): string {
    return `/api/attachments/open?path=${encodeURIComponent(path)}`;
  },

  createFolder(path: string): Promise<{ path: string }> {
    return request('/api/folders', { method: 'POST', body: jsonBody({ path }) });
  },

  moveFolder(fromPath: string, toPath: string): Promise<{ path: string }> {
    return request('/api/folders/move', { method: 'POST', body: jsonBody({ fromPath, toPath }) });
  },

  inspectFolder(path: string): Promise<{ impact: UiFolderImpact }> {
    return request(`/api/folders/impact?path=${encodeURIComponent(path)}`);
  },

  deleteFolder(path: string, token: string): Promise<{ deleted: true; noteIds: string[] }> {
    return request('/api/folders', { method: 'DELETE', body: jsonBody({ path, token }) });
  },

  note(id: string): Promise<{ note: UiNote }> {
    return request<{ note: UiNote }>(`/api/notes/${encodeURIComponent(id)}`);
  },

  noteProperties(id: string): Promise<UiNotePropertiesResponse> {
    return request<UiNotePropertiesResponse>(`/api/notes/${encodeURIComponent(id)}/properties`);
  },

  propertyCatalog(): Promise<UiPropertyCatalogResponse> {
    return request<UiPropertyCatalogResponse>('/api/properties');
  },

  generalNoteProperties(id: string): Promise<UiGeneralNotePropertiesResponse> {
    return request<UiGeneralNotePropertiesResponse>(`/api/notes/${encodeURIComponent(id)}/general-properties`);
  },

  mutatePropertyCatalog(input: UiPropertyCatalogMutationInput): Promise<UiPropertyCatalogResponse> {
    return request<UiPropertyCatalogResponse>('/api/properties', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  setGeneralNoteProperty(id: string, propertyId: string, input: UiSetGeneralNotePropertyInput): Promise<UiSetGeneralNotePropertyResponse> {
    return request<UiSetGeneralNotePropertyResponse>(`/api/notes/${encodeURIComponent(id)}/properties/${encodeURIComponent(propertyId)}`, {
      method: 'PUT',
      body: jsonBody(input),
    });
  },

  updateNoteTags(id: string, input: UiUpdateNoteTagsInput): Promise<UiUpdateNoteTagsResponse> {
    return request<UiUpdateNoteTagsResponse>(`/api/notes/${encodeURIComponent(id)}/tags`, {
      method: 'PUT',
      body: jsonBody(input),
    });
  },

  setNoteProperty(id: string, input: UiSetNotePropertyInput): Promise<UiNotePropertiesResponse> {
    return request<UiNotePropertiesResponse>(`/api/notes/${encodeURIComponent(id)}/properties`, {
      method: 'PUT',
      body: jsonBody(input),
    });
  },
  addDatabaseNote(databaseId: string, noteId: string, baseHash: string): Promise<UiNotePropertiesResponse> {
    return request(`/api/databases/${databaseId}/rows`, { method: 'POST', body: JSON.stringify({ noteId, baseHash, confirmCreate: true }) });
  },

  discovery(refresh = false): Promise<UiDiscoveryResponse> {
    return request(`/api/discovery${refresh ? '?refresh=true' : ''}`);
  },
  graph(refresh = false): Promise<UiNoteGraph> {
    return request(`/api/graph${refresh ? '?refresh=true' : ''}`);
  },
  createLinkTarget(target: string): Promise<{ note: UiNote }> {
    return request('/api/discovery/create', { method: 'POST', body: jsonBody({ target }) });
  },
  backlinks(id: string, refresh = false): Promise<UiBacklinksResponse> {
    return request<UiBacklinksResponse>(`/api/notes/${encodeURIComponent(id)}/backlinks${refresh ? '?refresh=true' : ''}`);
  },

  createNote(input: UiCreateNoteInput): Promise<{ note: UiNote }> {
    return request<{ note: UiNote }>('/api/notes', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  saveNote(id: string, input: UiSaveNoteInput): Promise<{ note: UiNote }> {
    return request<{ note: UiNote }>(`/api/notes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: jsonBody(input),
    });
  },

  moveNote(id: string, input: UiMoveNoteInput): Promise<{ note: UiNote }> {
    return request<{ note: UiNote }>(`/api/notes/${encodeURIComponent(id)}/move`, {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  deleteNote(id: string, input: UiDeleteNoteInput): Promise<{ deleted: true }> {
    return request<{ deleted: true }>(`/api/notes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: jsonBody(input),
    });
  },

  search(query: string, signal?: AbortSignal, refresh = false, filters: readonly import('../../src/search/note-filters.js').NoteFilter[] = [], logic: import('../../src/search/note-filters.js').NoteFilterLogic = 'and'): Promise<UiSearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (refresh) params.set('refresh', 'true');
    if (filters.length) { params.set('filters', JSON.stringify(filters)); params.set('logic', logic); }
    return request<UiSearchResponse>(`/api/search?${params}`, { signal });
  },

  searchMetadata(refresh = false): Promise<UiSearchMetadataResponse> {
    return request<UiSearchMetadataResponse>(`/api/search/metadata${refresh ? '?refresh=true' : ''}`);
  },

  databases(): Promise<{ databases: UiDatabase[] }> {
    return request<{ databases: UiDatabase[] }>('/api/databases');
  },

  createDatabase(database: UiDatabaseDefinition): Promise<{ database: UiDatabase }> {
    return request<{ database: UiDatabase }>('/api/databases', {
      method: 'POST',
      body: jsonBody({ database }),
    });
  },

  replaceDatabase(
    id: string,
    database: UiDatabaseDefinition,
    baseHash: string,
  ): Promise<{ database: UiDatabase }> {
    return request<{ database: UiDatabase }>(`/api/databases/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: jsonBody({ database, baseHash }),
    });
  },

  databaseRows(id: string, expectedSchemaHash?: string): Promise<UiDatabaseRowsResponse> {
    const params = new URLSearchParams();
    if (expectedSchemaHash !== undefined) params.set('schemaHash', expectedSchemaHash);
    const query = params.size > 0 ? `?${params.toString()}` : '';
    return request<UiDatabaseRowsResponse>(`/api/databases/${encodeURIComponent(id)}/rows${query}`);
  },

  databaseViews(databaseId: string): Promise<UiDatabaseViewsResponse> {
    return request(`/api/databases/${encodeURIComponent(databaseId)}/views`);
  },

  databaseView(databaseId: string, viewId: string): Promise<{ view: UiDatabaseView }> {
    return request(`/api/databases/${encodeURIComponent(databaseId)}/views/${encodeURIComponent(viewId)}`);
  },

  createDatabaseView(view: DatabaseView): Promise<{ view: UiDatabaseView }> {
    return request(`/api/databases/${encodeURIComponent(view.databaseId)}/views`, { method: 'POST', body: jsonBody({ view }) });
  },

  replaceDatabaseView(view: DatabaseView, baseHash: string): Promise<{ view: UiDatabaseView }> {
    return request(`/api/databases/${encodeURIComponent(view.databaseId)}/views/${encodeURIComponent(view.id)}`, { method: 'PUT', body: jsonBody({ view, baseHash }) });
  },

  duplicateDatabaseView(databaseId: string, viewId: string, id: string, name: string, baseHash: string): Promise<{ view: UiDatabaseView }> {
    return request(`/api/databases/${encodeURIComponent(databaseId)}/views/${encodeURIComponent(viewId)}/duplicate`, { method: 'POST', body: jsonBody({ id, name, baseHash }) });
  },

  deleteDatabaseView(databaseId: string, viewId: string, baseHash: string): Promise<{ deleted: true }> {
    return request(`/api/databases/${encodeURIComponent(databaseId)}/views/${encodeURIComponent(viewId)}`, { method: 'DELETE', body: jsonBody({ baseHash }) });
  },

  createBackup(input: UiCreateBackupInput): Promise<BackupReport> {
    return request<BackupReport>('/api/backup', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  validateBackup(input: UiValidateBackupInput): Promise<UiBackupValidationResult> {
    return request<UiBackupValidationResult>('/api/backup/validate', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  previewRestore(input: UiValidateBackupInput): Promise<RestorePreview> {
    return request<RestorePreview>('/api/restore/preview', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  restoreBackup(input: UiRestoreInput): Promise<ImportReport> {
    return request<ImportReport>('/api/restore', {
      method: 'POST',
      body: jsonBody(input),
    });
  },
};
