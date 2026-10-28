import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../ui/src/api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('structured database API client', () => {
  it('uses the saved-view CRUD and duplicate contracts with revision tokens and escaped IDs', async () => {
    const view = { id: 'view/id', databaseId: 'db/id', name: 'Table', type: 'table' as const, settings: {}, sort: { propertyId: 'title', direction: 'asc' as const }, filters: [], visiblePropertyIds: [] };
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ view }));
    vi.stubGlobal('fetch', fetchMock);
    await api.databaseViews(view.databaseId);
    await api.databaseView(view.databaseId, view.id);
    await api.createDatabaseView(view);
    await api.replaceDatabaseView(view, 'revision');
    await api.duplicateDatabaseView(view.databaseId, view.id, 'new-id', 'Copy', 'revision');
    await api.deleteDatabaseView(view.databaseId, view.id, 'revision');
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/databases/db%2Fid/views', '/api/databases/db%2Fid/views/view%2Fid',
      '/api/databases/db%2Fid/views', '/api/databases/db%2Fid/views/view%2Fid',
      '/api/databases/db%2Fid/views/view%2Fid/duplicate', '/api/databases/db%2Fid/views/view%2Fid',
    ]);
    expect(fetchMock.mock.calls[3]?.[1]?.body).toBe(JSON.stringify({ view, baseHash: 'revision' }));
    expect(fetchMock.mock.calls[4]?.[1]?.body).toBe(JSON.stringify({ id: 'new-id', name: 'Copy', baseHash: 'revision' }));
  });
  it('loads row projections through the batch database route', async () => {
    const body = { databaseId: 'db', schemaHash: 'a'.repeat(64), rows: [], diagnostics: [] };
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse(body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.databaseRows('db/id')).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/databases/db%2Fid/rows');

    await api.databaseRows('db/id', 'b'.repeat(64));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/databases/db%2Fid/rows?schemaHash=${'b'.repeat(64)}`);
  });

  it('creates and conditionally replaces database schemas through their dedicated API routes', async () => {
    const database = { id: 'database-id', name: 'Reading', properties: [] };
    const responseBody = { database: { ...database, path: 'databases/database-id.json', contentHash: 'a'.repeat(64) } };
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse(responseBody));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.createDatabase(database)).resolves.toEqual(responseBody);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/databases');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ database }));

    await expect(api.replaceDatabase('database/id', database, 'b'.repeat(64))).resolves.toEqual(responseBody);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/databases/database%2Fid');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT');
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ database, baseHash: 'b'.repeat(64) }));
  });

  it('posts a targeted property and its optimistic concurrency token', async () => {
    const body = { noteId: 'note-id', path: 'notes/a.md', contentHash: 'new-hash', rows: [], issues: [] };
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse(body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.setNoteProperty('note/id', {
      databaseId: 'database-id',
      propertyId: 'property-id',
      value: 'Ready',
      baseHash: 'a'.repeat(64),
      confirmCreate: true,
    })).resolves.toEqual(body);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/notes/note%2Fid/properties');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({
      databaseId: 'database-id',
      propertyId: 'property-id',
      value: 'Ready',
      baseHash: 'a'.repeat(64),
      confirmCreate: true,
    }));
  });

  it('keeps structured validation diagnostics on API errors', async () => {
    const structuredDataIssues = [{
      noteId: 'note-id',
      path: 'notes/a.md',
      databaseId: 'database-id',
      propertyId: 'property-id',
      code: 'UNSUPPORTED_NAMESPACE_VERSION',
      message: 'Upgrade Nodus.',
    }];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: {
        code: 'STRUCTURED_DATA_INVALID',
        message: 'Data was not changed.',
        structuredDataIssues,
      },
    }, 422)));

    const error = await api.setNoteProperty('note-id', {
      databaseId: 'database-id',
      propertyId: 'property-id',
      value: 'x',
      baseHash: 'a'.repeat(64),
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'STRUCTURED_DATA_INVALID',
      structuredDataIssues,
    });
  });
});
