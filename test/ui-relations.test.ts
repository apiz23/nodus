import { createServer } from 'node:http';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createNote } from '../src/domain/note.js';
import type { UiDatabaseRowsResponse } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DB = id(1), REL = id(2), COUNT = id(3), SOURCE = id(4), TARGET = id(5), OTHER = id(6);
const NOW = '2026-10-29T00:00:00Z';

it('serves derived rows and validates relation writes, read-only fields, stale revisions, and target deletion through HTTP', async () => {
  await withTempDir(async (root) => {
    const vault = await FileSystemVault.open(join(root, 'vault'));
    await vault.createDatabase({ id: DB, name: 'Relations', properties: [
      { id: REL, name: 'Related', type: 'relation', relation: { databaseId: DB, cardinality: 'many' } },
      { id: COUNT, name: 'Count', type: 'rollup', rollup: { relationPropertyId: REL, operation: 'count' } },
    ] });
    for (const noteId of [SOURCE, TARGET, OTHER]) {
      const note = createNote({ id: noteId, title: `Record ${noteId}`, path: `${noteId}.md`, body: '[[Portable]] body', now: NOW });
      if (noteId !== OTHER) note.extraFrontmatter.nodus_data = { format: 'nodus-note-properties', version: 1, databases: { [DB]: noteId === SOURCE ? { [REL]: [TARGET] } : {} } };
      await vault.createNote(note);
    }
    const api = createLocalApiMiddleware({ vaultPath: vault.root, now: () => NOW });
    const server = createServer((req, res) => api(req, res, () => res.writeHead(404).end()));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
    const base = `http://127.0.0.1:${address.port}`;
    const request = async (value: unknown) => fetch(`${base}/api/notes/${SOURCE}/properties`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const rows = async () => (await (await fetch(`${base}/api/databases/${DB}/rows`)).json()) as UiDatabaseRowsResponse;
    try {
      const current = await vault.readNoteWithHash(SOURCE);
      const input = { databaseId: DB, propertyId: REL, value: [], baseHash: current.hash };
      expect((await rows()).rows.find((row) => row.noteId === SOURCE)?.values[COUNT]).toBe(1);
      expect((await rows()).relationCandidates?.[DB]?.map((note) => note.id)).toEqual([SOURCE, TARGET]);
      for (const value of [[OTHER], [id(999)], [TARGET, TARGET], TARGET]) {
        const rejected = await request({ ...input, value });
        expect(rejected.status).toBe(422);
        expect(await readFile(join(vault.root, current.note.path), 'utf8')).toBe(current.text);
      }
      expect((await request({ ...input, propertyId: COUNT, value: 99 })).status).toBe(422);
      const other = await vault.readNoteWithHash(OTHER);
      const membership = (confirmCreate: boolean) => fetch(`${base}/api/databases/${DB}/rows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId: OTHER, baseHash: other.hash, confirmCreate }) });
      expect((await membership(false)).status).toBe(409);
      expect((await membership(true)).status).toBe(200);
      expect((await rows()).rows.find((row) => row.noteId === OTHER)?.values[COUNT]).toBe(0);
      const saved = await request(input); expect(saved.status).toBe(200);
      expect((await saved.json() as { rows: { values: Record<string, unknown> }[] }).rows[0]?.values[COUNT]).toBe(0);
      expect((await request({ ...input, value: [TARGET] })).status).toBe(409);
      const fresh = await vault.readNoteWithHash(SOURCE);
      expect((await request({ ...input, value: [TARGET], baseHash: fresh.hash })).status).toBe(200);
      await vault.moveNote(TARGET, 'renamed/target.md');
      const moved = (await rows()).rows.find((row) => row.noteId === SOURCE)!;
      expect(moved.relations?.[REL]?.[0]?.path).toBe('renamed/target.md');
      await vault.deleteNote(TARGET);
      const deleted = (await rows()).rows.find((row) => row.noteId === SOURCE)!;
      expect(deleted.values).toMatchObject({ [REL]: [TARGET], [COUNT]: 0 });
      expect(deleted.relations?.[REL]?.[0]?.status).toBe('missing');
      expect((await request({ ...input, remove: true, value: undefined, baseHash: deleted.contentHash })).status).toBe(200);
    } finally {
      server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
