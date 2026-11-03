import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiOrganizationAnalysis } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-11-03T09:00:00Z';
const IDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'];
const CONTENT = 'Canopy water cycles sustain forest soil, plant diversity, and ecosystem resilience through seasonal rainfall.';

describe('organization API', () => {
  it('builds suggestions from the cached Markdown knowledge snapshot and applies an approved tag safely', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(createNote({ id: IDS[0]!, title: 'Forest overview', path: 'notes/a.md', body: CONTENT, now: NOW }));
      await vault.createNote(createNote({ id: IDS[1]!, title: 'Canopy study one', path: 'notes/research/b.md', body: CONTENT, now: NOW, tags: ['ecology'] }));
      await vault.createNote(createNote({ id: IDS[2]!, title: 'Canopy study two', path: 'notes/research/c.md', body: CONTENT, now: NOW, tags: ['ecology'] }));
      const middleware = createLocalApiMiddleware({ vaultPath: root, now: () => NOW });
      const server = createServer((req, res) => middleware(req, res, () => res.end()));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No address');
      const base = `http://127.0.0.1:${address.port}`;
      try {
        const first = await fetch(`${base}/api/organization`);
        expect(first.status).toBe(200);
        const initial = await first.json() as UiOrganizationAnalysis;
        const suggestion = initial.suggestions.find((item) => item.action.type === 'add-tag' && item.action.noteId === IDS[0]);
        expect(suggestion).toBeDefined();
        const applied = await fetch(`${base}/api/organization/${suggestion!.id}/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        expect(applied.status).toBe(200);
        const updated = await vault.readNoteWithHash(IDS[0]!);
        expect(updated.note.tags).toEqual(['ecology']);
        expect(updated.note.body).toBe(CONTENT);
        expect(await fetch(`${base}/api/organization?refresh=true`).then((response) => response.status)).toBe(200);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await middleware.dispose();
        vault.dispose();
      }
    });
  });

  it('rejects a stale suggestion after external content changes remove its supporting evidence', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(createNote({ id: IDS[3]!, title: 'Target', path: 'target.md', body: CONTENT, now: NOW }));
      await vault.createNote(createNote({ id: IDS[4]!, title: 'Peer one', path: 'peer-one.md', body: CONTENT, now: NOW, tags: ['ecology'] }));
      await vault.createNote(createNote({ id: IDS[5]!, title: 'Peer two', path: 'peer-two.md', body: CONTENT, now: NOW, tags: ['ecology'] }));
      const middleware = createLocalApiMiddleware({ vaultPath: root, now: () => NOW });
      const server = createServer((req, res) => middleware(req, res, () => res.end()));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No address');
      const base = `http://127.0.0.1:${address.port}`;
      try {
        const initial = await fetch(`${base}/api/organization`).then((response) => response.json()) as UiOrganizationAnalysis;
        const suggestion = initial.suggestions.find((item) => item.action.type === 'add-tag' && item.action.noteId === IDS[3]);
        expect(suggestion).toBeDefined();
        const current = await vault.readNoteWithHash(IDS[3]!);
        await vault.replaceNote({ ...current.note, body: 'A separate note about trains, rail routes, and travel planning.' }, { expectedHash: current.hash });
        const response = await fetch(`${base}/api/organization/${suggestion!.id}/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        expect(response.status).toBe(409);
        expect((await response.json() as { error: { code: string } }).error.code).toBe('STALE_SUGGESTION');
        expect((await vault.readNoteWithHash(IDS[3]!)).note.tags).toEqual([]);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await middleware.dispose();
        vault.dispose();
      }
    });
  });
});
