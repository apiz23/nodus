import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiKnowledgeInsights, UiRelatedNotesResponse } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-11-03T00:00:00Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

async function start(root: string) {
  const middleware = createLocalApiMiddleware({ vaultPath: root, now: () => NOW });
  const server = createServer((req, res) => middleware(req, res, () => res.end()));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function close(server: ReturnType<typeof createServer>) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe('knowledge insights API', () => {
  it('serves analytics, clusters, recent notes, and related notes', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(createNote({ id: A, title: 'Graph alpha', path: 'notes/a.md', body: '[[Graph beta]] [[Graph gamma]]', now: NOW }));
      await vault.createNote(createNote({ id: B, title: 'Graph beta', path: 'notes/b.md', body: '[[Graph gamma]]', now: NOW }));
      await vault.createNote(createNote({ id: C, title: 'Graph gamma', path: 'notes/c.md', body: '', now: NOW }));
      const started = await start(root);
      try {
        const insights = await (await fetch(`${started.base}/api/insights`)).json() as UiKnowledgeInsights;
        expect(insights.metrics).toMatchObject({ totalNotes: 3, linkedNotes: 3, isolatedNotes: 0, componentCount: 1, largestComponentSize: 3 });
        expect(insights.clusters).toHaveLength(1);
        expect(insights.clusters[0]).toMatchObject({ size: 3, id: A, representative: { id: C } });
        expect(insights.mostConnected[0]?.id).toBe(C);
        expect(insights.recentNotes).toHaveLength(3);
        const related = await (await fetch(`${started.base}/api/notes/${B}/related?limit=2`)).json() as UiRelatedNotesResponse;
        expect(related.noteId).toBe(B);
        expect(related.related.length).toBeLessThanOrEqual(2);
        expect(related.related.map((item) => item.note.id)).not.toContain(B);
      } finally { await close(started.server); }
    });
  });

  it('returns 404 for related notes of an unknown note', async () => {
    await withTempDir(async (root) => {
      await FileSystemVault.open(root);
      const started = await start(root);
      try {
        const response = await fetch(`${started.base}/api/notes/${A}/related`);
        expect(response.status).toBe(404);
      } finally { await close(started.server); }
    });
  });

  it('keeps insights isolated between vaults', async () => {
    await withTempDir(async (root) => {
      const first = await FileSystemVault.open(`${root}/one`);
      const second = await FileSystemVault.open(`${root}/two`);
      await first.createNote(createNote({ id: A, title: 'Shared', path: 'a.md', body: '[[Target]]', now: NOW }));
      await first.createNote(createNote({ id: B, title: 'Target', path: 'b.md', body: '', now: NOW }));
      await second.createNote(createNote({ id: A, title: 'Shared', path: 'a.md', body: '', now: NOW }));
      const one = await start(`${root}/one`);
      const two = await start(`${root}/two`);
      try {
        const oneInsights = await (await fetch(`${one.base}/api/insights`)).json() as UiKnowledgeInsights;
        const twoInsights = await (await fetch(`${two.base}/api/insights`)).json() as UiKnowledgeInsights;
        expect(oneInsights.metrics.linkedNotes).toBe(2);
        expect(twoInsights.metrics.linkedNotes).toBe(0);
      } finally { await close(one.server); await close(two.server); }
    });
  });
});
