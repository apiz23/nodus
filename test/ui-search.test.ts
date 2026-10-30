import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiSearchResult } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-10-25T12:00:00Z';
const EXACT = 'aaaaaaaa-1111-4111-8111-111111111111';
const PREFIX = 'bbbbbbbb-2222-4222-8222-222222222222';
const CONTAINS = 'cccccccc-3333-4333-8333-333333333333';
const BODY = 'dddddddd-4444-4444-8444-444444444444';

interface StartedApi {
  server: Server;
  base: string;
}

async function startApi(vaultPath: string): Promise<StartedApi> {
  const middleware = createLocalApiMiddleware({ vaultPath, now: () => NOW });
  const server = createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end('not found');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('No test port');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function stopApi(started: StartedApi): Promise<void> {
  started.server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    started.server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function search(base: string, q: string): Promise<{ status: number; results: UiSearchResult[] }> {
  const response = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}`);
  const body = (await response.json()) as { results: UiSearchResult[] };
  return { status: response.status, results: body.results };
}

async function seedRankedVault(vaultPath: string): Promise<void> {
  const vault = await FileSystemVault.open(vaultPath);
  const titles: Array<[string, string, string]> = [
    [EXACT, 'Planning', 'Unrelated body.'],
    [PREFIX, 'Planning board', 'Unrelated body.'],
    [CONTAINS, 'Board planning notes', 'Unrelated body.'],
    [BODY, 'Something else', 'A body that mentions planning in passing.'],
  ];
  for (const [id, title, body] of titles) {
    await vault.createNote(createNote({ id, title, path: `notes/${id.slice(0, 8)}.md`, body, now: NOW }));
  }
}

describe('search ranking', () => {
  it('ranks exact title, then prefix, then contains, then body-only', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const started = await startApi(vaultPath);
      try {
        const { status, results } = await search(started.base, 'planning');
        expect(status).toBe(200);
        expect(results.map((result) => result.id)).toEqual([EXACT, PREFIX, CONTAINS, BODY]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('ranks case-insensitively and ignores surrounding whitespace', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const started = await startApi(vaultPath);
      try {
        const { results } = await search(started.base, '  PLANNING  ');
        expect(results[0]?.id).toBe(EXACT);
        expect(results.map((result) => result.id)).toEqual([EXACT, PREFIX, CONTAINS, BODY]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('returns an empty list for an empty query and for no matches', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const started = await startApi(vaultPath);
      try {
        const empty = await search(started.base, '   ');
        expect(empty.status).toBe(200);
        expect(empty.results).toEqual([]);

        const none = await search(started.base, 'definitely-absent-term');
        expect(none.status).toBe(200);
        expect(none.results).toEqual([]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('includes a body snippet on body-only matches and the title on every result', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const started = await startApi(vaultPath);
      try {
        const { results } = await search(started.base, 'planning');
        for (const result of results) {
          expect(result.title.length).toBeGreaterThan(0);
          expect(result.snippet.length).toBeGreaterThan(0);
        }
        const bodyOnly = results.find((result) => result.id === BODY);
        expect(bodyOnly?.snippet).toContain('planning');
      } finally {
        await stopApi(started);
      }
    });
  });

  it('searches paths and shows a snippet from the field that matched', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const started = await startApi(vaultPath);
      try {
        const titleMatch = await search(started.base, 'planning');
        expect(titleMatch.results[0]?.snippet).toBe('Title: Planning');

        const pathMatch = await search(started.base, 'aaaaaaaa');
        expect(pathMatch.results.map((result) => result.id)).toEqual([EXACT]);
        expect(pathMatch.results[0]?.snippet).toBe('Path: notes/aaaaaaaa.md');
      } finally {
        await stopApi(started);
      }
    });
  });

  it('returns stable IDs independent of the note path', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const vault = await FileSystemVault.open(vaultPath);
      await vault.moveNote(EXACT, 'notes/renamed/location.md');

      const started = await startApi(vaultPath);
      try {
        const { results } = await search(started.base, 'planning');
        const exact = results.find((result) => result.id === EXACT);
        expect(exact).toBeDefined();
        expect(exact?.path).toBe('notes/renamed/location.md');
      } finally {
        await stopApi(started);
      }
    });
  });
});


describe('global search snapshot lifecycle', () => {
  it('indexes tags and registered properties, filters results, and invalidates on catalog changes', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      const id = 'eeeeeeee-5555-4555-8555-555555555555';
      const propertyId = 'ffffffff-6666-4666-8666-666666666666';
      await vault.createNote(createNote({ id, title: 'Research log', path: 'notes/research.md', body: 'Body', tags: ['Field work'], now: NOW }));
      const started = await startApi(vaultPath);
      try {
        const mutation = async (path: string, body: unknown) => fetch(`${started.base}/api${path}`, {
          method: path === '/properties' ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const createdResponse = await mutation('/properties', {
          baseHash: null,
          mutation: { type: 'create-property', property: { id: propertyId, key: 'purpose', name: 'Research purpose', type: 'text' } },
        });
        expect(createdResponse.ok).toBe(true);
        const created = await createdResponse.json() as { contentHash: string };
        const note = await (await fetch(`${started.base}/api/notes/${id}`)).json() as { note: { contentHash: string } };
        const valueResponse = await mutation(`/notes/${id}/properties/${propertyId}`, { baseHash: note.note.contentHash, value: 'Local history' });
        expect(valueResponse.ok).toBe(true);
        expect((await search(started.base, 'field work')).results[0]?.match?.field).toBe('tag');
        expect((await search(started.base, 'research purpose')).results[0]?.match?.field).toBe('property');
        expect((await search(started.base, 'local history')).results[0]?.snippet).toContain('Research purpose: Local history');
        const filter = encodeURIComponent(JSON.stringify([{ type: 'property', propertyId, operator: 'contains', value: 'history' }]));
        const filtered = await fetch(`${started.base}/api/search?filters=${filter}`);
        expect((await filtered.json() as { results: UiSearchResult[] }).results.map((result) => result.id)).toEqual([id]);
        const renamed = await mutation('/properties', { baseHash: created.contentHash, mutation: { type: 'rename-property', propertyId, name: 'Project intent' } });
        expect(renamed.ok).toBe(true);
        expect((await search(started.base, 'project intent')).results[0]?.id).toBe(id);
      } finally { await stopApi(started); }
    });
  });

  it('searches aliases and shares one derived snapshot across queries and discovery, invalidating on API writes', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const vault = await FileSystemVault.open(vaultPath);
      const aliasId = 'eeeeeeee-5555-4555-8555-555555555555';
      await vault.createNote(createNote({ id: aliasId, title: 'Alias destination', path: 'alias.md', body: '', aliases: ['Planning'], now: NOW }));
      const snapshot = vi.spyOn(FileSystemVault.prototype, 'snapshotNotes');
      const started = await startApi(vaultPath);
      const mutate = async (path: string, method: string, body: unknown) => {
        const response = await fetch(`${started.base}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        expect(response.ok).toBe(true);
        return response.json() as Promise<{ note: { id: string; title: string; body: string; contentHash: string } }>;
      };
      try {
        await search(started.base, '');
        expect(snapshot).not.toHaveBeenCalled();
        const results = (await search(started.base, 'planning')).results;
        expect(results.slice(0, 2).map((note) => note.id)).toEqual([EXACT, aliasId]);
        expect(results[1]).toMatchObject({ snippet: 'Alias: Planning', match: { field: 'alias', text: 'Planning', start: 0, end: 8 } });
        await search(started.base, 'body');
        await fetch(`${started.base}/api/discovery`);
        expect(snapshot).toHaveBeenCalledTimes(1);
        const original = await (await fetch(`${started.base}/api/notes/${aliasId}`)).json() as { note: { contentHash: string } };
        const edited = await mutate(`/notes/${aliasId}`, 'PUT', { title: 'New alias destination', body: 'Fresh content', baseHash: original.note.contentHash });
        expect((await search(started.base, 'Fresh')).results[0]?.id).toBe(aliasId);
        expect(snapshot).toHaveBeenCalledTimes(2);
        const moved = await mutate(`/notes/${aliasId}/move`, 'POST', { path: 'notes/moved-alias.md', baseHash: edited.note.contentHash });
        expect((await search(started.base, 'planning')).results.find((note) => note.id === aliasId)?.path).toBe('notes/moved-alias.md');
        await mutate(`/notes/${aliasId}`, 'DELETE', { baseHash: moved.note.contentHash });
        expect((await search(started.base, 'planning')).results.some((note) => note.id === aliasId)).toBe(false);
        const created = await mutate('/notes', 'POST', { title: 'Created destination' });
        expect((await search(started.base, 'Created destination')).results[0]?.id).toBe(created.note.id);
      } finally { snapshot.mockRestore(); await stopApi(started); }
    });
  });

  it('refreshes external changes, reports disk errors without poisoning recovery, and isolates switched vaults', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const started = await startApi(vaultPath);
      try {
        await search(started.base, 'planning');
        const file = join(vaultPath, 'notes/aaaaaaaa.md');
        const original = await readFile(file, 'utf8');
        await writeFile(file, original.replace('title: Planning', 'title: Externally renamed'));
        const refreshed = await fetch(`${started.base}/api/search?q=Externally&refresh=true`);
        expect((await refreshed.json() as { results: UiSearchResult[] }).results[0]?.id).toBe(EXACT);
        await writeFile(file, new Uint8Array([0xff]));
        const failed = await fetch(`${started.base}/api/search?q=Externally&refresh=true`);
        expect(failed.status).toBeGreaterThanOrEqual(400);
        expect((await failed.json() as { error: { message: string } }).error.message).toContain('UTF-8');
        await writeFile(file, original);
        expect((await search(started.base, 'planning')).results[0]?.id).toBe(EXACT);
        const nextPath = join(dir, 'other');
        const nextVault = await FileSystemVault.open(nextPath);
        await nextVault.createNote(createNote({ id: EXACT, title: 'Other vault', path: 'other.md', body: 'Separated content', now: NOW }));
        const switched = await fetch(`${started.base}/api/vault/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: nextPath }) });
        expect(switched.ok).toBe(true);
        expect((await search(started.base, 'planning')).results).toEqual([]);
        expect((await search(started.base, 'Separated')).results[0]).toMatchObject({ id: EXACT, title: 'Other vault' });
      } finally { await stopApi(started); }
    });
  });
});
