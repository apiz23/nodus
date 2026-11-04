import type {
  BackupReport,
  ExportReport,
  ImportReport,
  ImportPreview,
  RestorePreview,
  UiBacklinksResponse,
  UiRelationBacklinksResponse,
  UiDiscoveryResponse,
  UiNoteGraph,
  UiKnowledgeInsights,
  UiOrganizationAnalysis,
  UiOrganizationMovePreview,
  UiRelatedNotesResponse,
  UiGraphCluster,
  UiGraphPathResult,
  UiGraphClusterInsights,
  UiBackupValidationResult,
  UiCreateBackupInput,
  UiCreateNoteInput,
  UiDatabase,
  UiDatabaseAutomationsResponse,
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
  UiVaultBootstrap,
  UiApiErrorBody,
  UiFolderImpact,
  UiAttachment,
  UiTasksResponse,
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
  tasks(): Promise<UiTasksResponse> { return request<UiTasksResponse>('/api/tasks'); },
  scheduleTask(noteId: string, input: { taskId: string; scheduledDate: string; baseHash: string }): Promise<{ task: import('../../src/tasks/extract.js').ExtractedTask; projection: UiTasksResponse }> {
    return request(`/api/notes/${encodeURIComponent(noteId)}/tasks/schedule`, { method: 'PUT', body: jsonBody(input) });
  },
  updateCalendarRange(noteId: string, input: { databaseId: string; viewId: string; startDatePropertyId: string; startDate: string; endDatePropertyId?: string; endDate?: string | null; baseHash: string }): Promise<UiNotePropertiesResponse> {
    return request(`/api/notes/${encodeURIComponent(noteId)}/calendar-range`, { method: 'PUT', body: jsonBody(input) });
  },
  status(): Promise<UiVaultBootstrap> {
    return request<UiVaultBootstrap>('/api/status');
  },

  gettingStartedCompleted(): Promise<{ completed: boolean }> {
    return request<{ completed: boolean }>('/api/preferences/getting-started');
  },

  setGettingStartedCompleted(completed: boolean): Promise<{ completed: boolean }> {
    return request<{ completed: boolean }>('/api/preferences/getting-started', { method: 'PUT', body: jsonBody({ completed }) });
  },

  createDefaultVault(): Promise<UiVaultStatus> {
    return request<UiVaultStatus>('/api/vault/default', { method: 'POST' });
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
  insights(refresh = false): Promise<UiKnowledgeInsights> {
    return request(`/api/insights${refresh ? '?refresh=true' : ''}`);
  },
  organization(refresh = false): Promise<UiOrganizationAnalysis> {
    return request(`/api/organization${refresh ? '?refresh=true' : ''}`);
  },
  applyOrganizationSuggestion(suggestionId: string): Promise<{ note: UiNote }> {
    return request(`/api/organization/${encodeURIComponent(suggestionId)}/apply`, { method: 'POST', body: '{}' });
  },
  organizationMovePreview(suggestionId: string): Promise<{ preview: UiOrganizationMovePreview }> {
    return request(`/api/organization/${encodeURIComponent(suggestionId)}/move-preview`);
  },
  graphClusters(refresh = false): Promise<{ clusters: UiGraphCluster[] }> {
    return request(`/api/graph/clusters${refresh ? '?refresh=true' : ''}`);
  },
  graphClusterInsights(id: string): Promise<UiGraphClusterInsights> {
    return request(`/api/graph/clusters/${encodeURIComponent(id)}`);
  },
  graphPath(input: { from: string; to: string; mode?: 'directed' | 'undirected'; maxDepth?: number; maxVisited?: number }): Promise<UiGraphPathResult> {
    const params = new URLSearchParams({ from: input.from, to: input.to });
    if (input.mode !== undefined) params.set('mode', input.mode);
    if (input.maxDepth !== undefined) params.set('maxDepth', String(input.maxDepth));
    if (input.maxVisited !== undefined) params.set('maxVisited', String(input.maxVisited));
    return request(`/api/graph/path?${params.toString()}`);
  },
  relatedNotes(id: string, limit = 6, refresh = false, signal?: AbortSignal): Promise<UiRelatedNotesResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (refresh) params.set('refresh', 'true');
    return request(`/api/notes/${encodeURIComponent(id)}/related?${params.toString()}`, { ...(signal ? { signal } : {}) });
  },
  createLinkTarget(target: string): Promise<{ note: UiNote }> {
    return request('/api/discovery/create', { method: 'POST', body: jsonBody({ target }) });
  },
  backlinks(id: string, refresh = false): Promise<UiBacklinksResponse> {
    return request<UiBacklinksResponse>(`/api/notes/${encodeURIComponent(id)}/backlinks${refresh ? '?refresh=true' : ''}`);
  },
  relationBacklinks(id: string, refresh = false): Promise<UiRelationBacklinksResponse> {
    return request<UiRelationBacklinksResponse>(`/api/notes/${encodeURIComponent(id)}/relation-backlinks${refresh ? '?refresh=true' : ''}`);
  },

  createNote(input: UiCreateNoteInput): Promise<{ note: UiNote }> {
    return request<{ note: UiNote }>('/api/notes', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  saveNote(id: string, input: UiSaveNoteInput): Promise<import('../../src/ui-server/dto.js').UiSaveNoteResponse> {
    return request<import('../../src/ui-server/dto.js').UiSaveNoteResponse>(`/api/notes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: jsonBody(input),
    });
  },

  repairWikiLink(id: string, input: import('../../src/ui-server/dto.js').UiRepairWikiLinkInput): Promise<import('../../src/ui-server/dto.js').UiRepairWikiLinkResponse> {
    return request<import('../../src/ui-server/dto.js').UiRepairWikiLinkResponse>(`/api/notes/${encodeURIComponent(id)}/links/repair`, {
      method: 'POST',
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

  templates(): Promise<{ templates: import('../../src/database/templates.js').NodusTemplate[]; hash: string | null }> {
    return request('/api/templates');
  },

  saveTemplates(templates: import('../../src/database/templates.js').NodusTemplate[], baseHash: string | null): Promise<{ templates: import('../../src/database/templates.js').NodusTemplate[]; hash: string }> {
    return request('/api/templates', { method: 'PUT', body: jsonBody({ templates, baseHash }) });
  },

  templateAction(id: string, action: 'preview' | 'apply', variables: Record<string, unknown> = {}): Promise<unknown> {
    return request(`/api/templates/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: jsonBody({ variables }) });
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

  databaseAutomations(databaseId: string): Promise<UiDatabaseAutomationsResponse> {
    return request(`/api/databases/${encodeURIComponent(databaseId)}/automations`);
  },

  saveDatabaseAutomations(databaseId: string, automations: import('../../src/database/automations.js').DatabaseAutomation[], baseHash: string | null): Promise<UiDatabaseAutomationsResponse> {
    return request(`/api/databases/${encodeURIComponent(databaseId)}/automations`, { method: 'PUT', body: jsonBody({ automations, baseHash }) });
  },

  automationHistory(databaseId: string): Promise<import('../../src/ui-server/dto.js').UiAutomationHistoryResponse> {
    return request(`/api/automations/history?databaseId=${encodeURIComponent(databaseId)}`);
  },

  databaseViews(databaseId: string): Promise<UiDatabaseViewsResponse> {
    return request(`/api/databases/${encodeURIComponent(databaseId)}/views`);
  },

  databaseView(databaseId: string, viewId: string): Promise<{ view: UiDatabaseView }> {
    return request(`/api/databases/${encodeURIComponent(databaseId)}/views/${encodeURIComponent(viewId)}`);
  },

  reorderDatabaseViews(databaseId: string, viewIds: string[], baseHash: string | null): Promise<{ order: import('../../src/ui-server/dto.js').UiDatabaseViewOrder }> {
    return request(`/api/databases/${encodeURIComponent(databaseId)}/views/order`, { method: 'PUT', body: jsonBody({ viewIds, baseHash }) });
  },

  relationCandidates(databaseId: string, propertyId: string, query: string, limit = 20): Promise<import('../../src/ui-server/dto.js').UiRelationCandidatesResponse> {
    const params = new URLSearchParams({ propertyId, query, limit: String(limit) });
    return request(`/api/databases/${encodeURIComponent(databaseId)}/relation-candidates?${params.toString()}`);
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

  createPortableExport(input: UiCreateBackupInput): Promise<ExportReport> {
    return request<ExportReport>('/api/export', {
      method: 'POST',
      body: jsonBody(input),
    });
  },

  previewImport(input: UiValidateBackupInput): Promise<ImportPreview> {
    return request<ImportPreview>('/api/import/preview', { method: 'POST', body: jsonBody(input) });
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
