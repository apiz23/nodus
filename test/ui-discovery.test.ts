import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { serializeNote } from '../src/format/note-format.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiBacklinksResponse, UiDiscoveryResponse, UiNote } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const now = '2026-10-28T00:00:00Z';

describe('knowledge discovery API', () => {
  it('creates intended title and ID targets unchanged, refreshes external edits, and invalidates on edit/move/delete', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const source = createNote({ id: A, title: 'Source', path: 'source.md', body: `See [[Future|idea]] and [[${B}|lost]].\n\`[[Literal]]\``, now });
      await vault.createNote(source);
      const middleware = createLocalApiMiddleware({ vaultPath: dir, now: () => now });
      const server = createServer((req, res) => middleware(req, res, () => res.end()));
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No server');
      const request = async <T>(path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
        expect(response.status).toBeLessThan(300);
        return await response.json() as T;
      };
      const discovery = (refresh = false) => request<UiDiscoveryResponse>(`/discovery${refresh ? '?refresh=true' : ''}`);
      try {
        expect((await discovery()).unresolved.map((link) => link.target)).toEqual(['Future', B]);
        const before = await readFile(join(dir, source.path), 'utf8');
        const { note: target } = await request<{ note: UiNote }>('/discovery/create', 'POST', { target: 'Future' });
        expect(target.title).toBe('Future');
        expect((await discovery()).unresolved.map((link) => link.target)).toEqual([B]);
        expect((await request<{ note: UiNote }>('/discovery/create', 'POST', { target: 'FUTURE' })).note.id).toBe(target.id);
        const { note: recovered } = await request<{ note: UiNote }>('/discovery/create', 'POST', { target: B });
        expect(recovered).toMatchObject({ id: B, title: 'Recovered note' });
        expect(await readFile(join(dir, source.path), 'utf8')).toBe(before);
        expect((await discovery()).orphans.map((note) => note.id)).toEqual([A]);
        expect((await request<UiBacklinksResponse>(`/notes/${B}/backlinks`)).backlinks[0]).toMatchObject({ sourceId: A, ambiguous: false });

        // External edits are deliberately bounded by the cache; explicit refresh bypasses it.
        await writeFile(join(dir, source.path), serializeNote({ ...source, body: `[[${B}|still pinned]] [[External]]` }));
        expect((await discovery()).unresolved).toEqual([]);
        expect((await discovery(true)).unresolved.map((link) => link.target)).toEqual(['External']);
        const moved = (await request<{ note: UiNote }>(`/notes/${B}/move`, 'POST', { path: 'moved.md', baseHash: recovered.contentHash })).note;
        expect((await request<UiBacklinksResponse>(`/notes/${B}/backlinks`)).backlinks).toHaveLength(1);
        const renamed = (await request<{ note: UiNote }>(`/notes/${B}`, 'PUT', { title: 'Renamed', body: '', baseHash: moved.contentHash })).note;
        expect((await discovery()).orphans.map((note) => note.id)).not.toContain(B);
        await request(`/notes/${B}`, 'DELETE', { baseHash: renamed.contentHash });
        expect((await discovery()).unresolved.map((link) => link.target)).toEqual([B, 'External']);
        expect(await vault.listNotes()).toHaveLength(2);
        // An externally added note can open before the shared snapshot expires.
        const externalId = '33333333-3333-4333-8333-333333333333';
        await vault.createNote(createNote({ id: externalId, title: 'External arrival', path: 'external.md', body: '', now }));
        expect((await request<UiBacklinksResponse>(`/notes/${externalId}/backlinks`)).backlinks).toEqual([]);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    });
  });
});
