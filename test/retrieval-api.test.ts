import { createServer } from 'node:http';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiRelatedNotesResponse } from '../src/ui-server/dto.js';
import * as retrieval from '../src/search/retrieval.js';
import { buildSearchIndex, searchIndex } from '../src/search/search-index.js';
import { withTempDir } from './tmp.js';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const makeNote = (id: string, path: string, title: string, body: string) => createNote({ id, path, title, body, now: '2026-11-03T00:00:00Z' });

describe('retrieval snapshot integration', () => {
  it('refreshes external edits, renames and deletions and recovers after an interrupted snapshot', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(makeNote(A, 'a.md', 'Garden log', 'compost soil ecology'));
      await vault.createNote(makeNote(B, 'b.md', 'Field study', 'compost soil ecology'));
      const middleware = createLocalApiMiddleware({ vaultPath: root });
      const server = createServer((req, res) => middleware(req, res, () => res.end()));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No address');
      const base = `http://127.0.0.1:${address.port}`;
      const related = async () => fetch(`${base}/api/notes/${A}/related?refresh=true`);
      try {
        expect(((await (await related()).json()) as UiRelatedNotesResponse).related[0]?.note.id).toBe(B);
        const bytes = await readFile(join(root, 'b.md'), 'utf8');
        await writeFile(join(root, 'b.md'), bytes.replace('compost soil ecology', 'train tickets itinerary'));
        expect(((await (await related()).json()) as UiRelatedNotesResponse).related).toEqual([]);
        await writeFile(join(root, 'b.md'), bytes.replace('Field study', 'Renamed study'));
        await rename(join(root, 'b.md'), join(root, 'renamed.md'));
        expect(((await (await related()).json()) as UiRelatedNotesResponse).related[0]?.note).toMatchObject({ id: B, title: 'Renamed study', path: 'renamed.md' });
        const load = vi.spyOn(FileSystemVault.prototype, 'snapshotNotes').mockRejectedValueOnce(new Error('Interrupted read'));
        expect((await related()).status).toBe(500);
        load.mockRestore();
        expect(((await (await related()).json()) as UiRelatedNotesResponse).related[0]?.note.id).toBe(B);
        await unlink(join(root, 'renamed.md'));
        expect(((await (await related()).json()) as UiRelatedNotesResponse).related).toEqual([]);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await middleware.dispose();
        vault.dispose();
      }
    });
  });
  it('keeps ordinary lexical search usable when the optional term projection fails, then retries on rebuild', () => {
    const notes = [makeNote(A, 'a.md', 'Garden', 'compost soil ecology')];
    const projection = vi.spyOn(retrieval, 'buildRetrievalIndex').mockImplementationOnce(() => { throw new Error('Injected failure'); });
    try {
      const fallback = buildSearchIndex(notes);
      expect(fallback.retrieval).toBeUndefined();
      expect(fallback.retrievalIssue).toContain('ordinary search remain available');
      expect(searchIndex(fallback, 'compost')[0]?.id).toBe(A);
      expect(buildSearchIndex(notes, undefined, undefined, fallback).retrieval).toBeDefined();
    } finally { projection.mockRestore(); }
  });
});
