import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiGraphCluster, UiGraphPathResult } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-11-03T00:00:00Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

async function start(root: string) {
  const middleware = createLocalApiMiddleware({ vaultPath: root, now: () => NOW });
  const server = createServer((req, res) => middleware(req, res, () => res.end()));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

describe('advanced graph API', () => {
  it('serves clusters and bounded path results', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(createNote({ id: A, title: 'Alpha', path: 'notes/a.md', body: '[[Bravo]]', now: NOW }));
      await vault.createNote(createNote({ id: B, title: 'Bravo', path: 'notes/b.md', body: '[[Charlie]]', now: NOW }));
      await vault.createNote(createNote({ id: C, title: 'Charlie', path: 'notes/c.md', body: '', now: NOW }));
      await vault.createNote(createNote({ id: D, title: 'Delta', path: 'notes/d.md', body: '', now: NOW }));
      const started = await start(root);
      try {
        const clusterResponse = await fetch(`${started.base}/api/graph/clusters`);
        expect(clusterResponse.status).toBe(200);
        const { clusters } = await clusterResponse.json() as { clusters: UiGraphCluster[] };
        expect(clusters[0]).toMatchObject({ id: A, size: 3, representative: { id: B } });
        expect(clusters[1]).toMatchObject({ size: 1, representative: { id: D } });

        const path = await (await fetch(`${started.base}/api/graph/path?from=${A}&to=${C}`)).json() as UiGraphPathResult;
        expect(path).toMatchObject({ status: 'found', mode: 'directed' });
        expect(path.nodes.map((node) => node.id)).toEqual([A, B, C]);
        const reverse = await (await fetch(`${started.base}/api/graph/path?from=${C}&to=${A}`)).json() as UiGraphPathResult;
        expect(reverse.status).toBe('disconnected');
        const undirected = await (await fetch(`${started.base}/api/graph/path?from=${C}&to=${A}&mode=undirected`)).json() as UiGraphPathResult;
        expect(undirected.status).toBe('found');
        expect((await fetch(`${started.base}/api/graph/path?from=${A}&to=${C}&maxDepth=1`)).status).toBe(200);
        expect((await fetch(`${started.base}/api/graph/path?from=${A}&to=${C}&mode=sideways`)).status).toBe(400);
      } finally {
        started.server.closeAllConnections();
        await new Promise<void>((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
      }
    });
  });
});
