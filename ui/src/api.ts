import type {
  UiBacklinksResponse,
  UiCreateNoteInput,
  UiDatabase,
  UiDeleteNoteInput,
  UiMoveNoteInput,
  UiNote,
  UiNoteSummary,
  UiSaveNoteInput,
  UiOpenVaultInput,
  UiSearchResult,
  UiVaultPickResult,
  UiVaultStatus,
} from '../../src/ui-server/dto';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly currentHash?: string;

  constructor(status: number, code: string, message: string, currentHash?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.currentHash = currentHash;
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
      | { error?: { code?: string; message?: string; currentHash?: string } }
      | undefined;
    throw new ApiError(
      response.status,
      errorBody?.error?.code ?? 'REQUEST_FAILED',
      errorBody?.error?.message ?? `Request failed with status ${response.status}.`,
      errorBody?.error?.currentHash,
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

  note(id: string): Promise<{ note: UiNote }> {
    return request<{ note: UiNote }>(`/api/notes/${encodeURIComponent(id)}`);
  },

  backlinks(id: string): Promise<UiBacklinksResponse> {
    return request<UiBacklinksResponse>(`/api/notes/${encodeURIComponent(id)}/backlinks`);
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

  search(query: string): Promise<{ results: UiSearchResult[] }> {
    const params = new URLSearchParams({ q: query });
    return request<{ results: UiSearchResult[] }>(`/api/search?${params.toString()}`);
  },

  databases(): Promise<{ databases: UiDatabase[] }> {
    return request<{ databases: UiDatabase[] }>('/api/databases');
  },
};
