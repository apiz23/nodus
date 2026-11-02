import { createServer } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiNote, UiNoteGraph } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const now = '2026-10-29T00:00:00Z';

describe('local graph API', () => {
  it('serves the shared link-index projection and refreshes after note mutations', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      const source = createNote({ id: A, title: 'Source', path: 'source.md', body: `[[Target]] [[${B}|pinned]]`, now });
      const target = createNote({ id: B, title: 'Target', path: 'target.md', body: '', now });
      await vault.createNote(source); await vault.createNote(target);
      const middleware = createLocalApiMiddleware({ vaultPath: root, now: () => now });
      const server = createServer((req, res) => middleware(req, res, () => res.end()));
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No server');
      const request = async <T>(path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
        expect(response.status).toBeLessThan(300);
        return await response.json() as T;
      };
      try {
        const initial = await request<UiNoteGraph>('/graph');
        expect(initial.edges).toMatchObject([{ sourceId: A, targetId: B, linkCount: 2 }]);
        expect(initial.unresolvedLinks).toEqual([]);
        expect(initial.isolatedNodeIds).toEqual([]);
        const fetchedTarget = await request<{ note: UiNote }>(`/notes/${B}`);
        const moved = await request<{ note: UiNote }>(`/notes/${B}/move`, 'POST', { path: 'folder/moved.md', baseHash: fetchedTarget.note.contentHash });
        expect((await request<UiNoteGraph>('/graph')).nodes.find((node) => node.id === B)).toMatchObject({ title: 'Target', path: moved.note.path });
        await request(`/notes/${B}`, 'DELETE', { baseHash: moved.note.contentHash });
        const afterDelete = await request<UiNoteGraph>('/graph');
        expect(afterDelete.edges).toEqual([]);
        expect(afterDelete.unresolvedCount).toBe(2);
        expect(afterDelete.unresolvedLinks?.map((link) => link.target).sort()).toEqual(['22222222-2222-4222-8222-222222222222', 'Target']);
        expect(afterDelete.isolatedNodeIds).toEqual([A]);
        const renamed = await request<{ note: UiNote }>('/notes', 'POST', { title: 'Target' });
        const afterCreate = await request<UiNoteGraph>('/graph');
        expect(afterCreate.edges).toMatchObject([{ sourceId: A, targetId: renamed.note.id, linkCount: 1 }]);
        expect(afterCreate.nodes.some((node) => node.id === renamed.note.id)).toBe(true);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    });
  });

  it('keeps graph snapshots isolated between vaults with identical titles', async () => {
    await withTempDir(async (root) => {
      const firstRoot = join(root, 'first');
      const secondRoot = join(root, 'second');
      const firstVault = await FileSystemVault.open(firstRoot);
      const secondVault = await FileSystemVault.open(secondRoot);
      const source = createNote({ id: A, title: 'Same source', path: 'source.md', body: '[[Same target]]', now });
      const target = createNote({ id: B, title: 'Same target', path: 'target.md', body: '', now });
      await firstVault.createNote(source);
      await firstVault.createNote(target);
      await secondVault.createNote(createNote({ id: A, title: 'Same source', path: 'source.md', body: '', now }));
      await secondVault.createNote(createNote({ id: B, title: 'Same target', path: 'target.md', body: '', now }));

      const start = async (vaultPath: string) => {
        const middleware = createLocalApiMiddleware({ vaultPath, now: () => now });
        const server = createServer((req, res) => middleware(req, res, () => res.end()));
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('No server');
        return { server, base: `http://127.0.0.1:${address.port}` };
      };
      const first = await start(firstRoot);
      const second = await start(secondRoot);
      try {
        const firstGraph = await (await fetch(`${first.base}/api/graph`)).json() as UiNoteGraph;
        const secondGraph = await (await fetch(`${second.base}/api/graph`)).json() as UiNoteGraph;
        expect(firstGraph.edges).toHaveLength(1);
        expect(secondGraph.edges).toEqual([]);
        expect(secondGraph.isolatedNodeIds?.sort()).toEqual([A, B].sort());
      } finally {
        first.server.closeAllConnections(); second.server.closeAllConnections();
        await Promise.all([first, second].map(({ server }) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
      }
    });
  });
});
