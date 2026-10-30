import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiNote } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-10-25T12:00:00Z';
const LATER = '2026-10-26T12:00:00Z';
const NOTE_ID = '11111111-1111-4111-8111-111111111111';

async function startApi(vaultPath: string): Promise<{ server: Server; base: string }> {
  const middleware = createLocalApiMiddleware({ vaultPath, now: () => LATER });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('not found'); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('No test port');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function json<T>(base: string, path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as T };
}

async function withApi(fn: (base: string, vault: FileSystemVault) => Promise<void>): Promise<void> {
  await withTempDir(async (dir) => {
    const vault = await FileSystemVault.open(dir);
    const started = await startApi(dir);
    try { await fn(started.base, vault); }
    finally {
      started.server.closeAllConnections();
      await new Promise<void>((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
    }
  });
}

describe('tag API', () => {
  it('creates notes with optional normalized tags and rejects duplicate initial tags', async () => {
    await withApi(async (base) => {
      const created = await json<{ note: UiNote }>(base, '/api/notes', 'POST', { title: 'Tagged note', tags: [' Café ', '日本語'] });
      expect(created.status).toBe(201);
      expect(created.body.note.tags).toEqual(['Café', '日本語']);
      const duplicate = await json<{ error: { code: string } }>(base, '/api/notes', 'POST', { title: 'Duplicate tags', tags: ['Nodus', ' nodus '] });
      expect(duplicate.status).toBe(400);
      expect(duplicate.body.error.code).toBe('INVALID_TAG');
    });
  });

  it('adds, removes, and replaces tags conditionally without replacing the note', async () => {
    await withApi(async (base, vault) => {
      await vault.createNote({
        id: NOTE_ID, title: 'Tagged target', path: 'notes/tagged-target.md', body: '# Markdown remains\n',
        createdAt: NOW, updatedAt: NOW, tags: ['Existing'], aliases: ['Alternate'],
        extraFrontmatter: { custom: { keep: true }, nodus_data: { format: 'nodus-note-properties', version: 1, databases: {} } },
      });
      const first = await vault.readNoteWithHash(NOTE_ID);
      const added = await json<{ note: UiNote }>(base, `/api/notes/${NOTE_ID}/tags`, 'PUT', {
        baseHash: first.hash, operation: { type: 'add', tag: ' New ' },
      });
      expect(added.status).toBe(200);
      expect(added.body.note.tags).toEqual(['Existing', 'New']);
      expect(added.body.note.contentHash).not.toBe(first.hash);
      const afterAdd = await vault.readNoteWithHash(NOTE_ID);
      const removed = await json<{ note: UiNote }>(base, `/api/notes/${NOTE_ID}/tags`, 'PUT', {
        baseHash: afterAdd.hash, operation: { type: 'remove', tag: 'existing' },
      });
      expect(removed.body.note.tags).toEqual(['New']);
      const afterRemove = await vault.readNoteWithHash(NOTE_ID);
      const replaced = await json<{ note: UiNote }>(base, `/api/notes/${NOTE_ID}/tags`, 'PUT', {
        baseHash: afterRemove.hash, operation: { type: 'replace', tags: ['Final', 'new'] },
      });
      expect(replaced.body.note.tags).toEqual(['Final', 'New']);
      const stored = await vault.readNoteWithHash(NOTE_ID);
      expect(stored.note).toMatchObject({ body: '# Markdown remains\n', aliases: ['Alternate'], tags: ['Final', 'New'], updatedAt: LATER });
      expect(stored.note.extraFrontmatter).toEqual({ custom: { keep: true }, nodus_data: { format: 'nodus-note-properties', version: 1, databases: {} } });
    });
  });

  it('returns useful validation, missing-note, and stale-revision errors without accepting frontmatter replacement', async () => {
    await withApi(async (base, vault) => {
      const created = await json<{ note: UiNote }>(base, '/api/notes', 'POST', { title: 'Tag revision' });
      const id = created.body.note.id;
      const invalid = await json<{ error: { code: string } }>(base, `/api/notes/${id}/tags`, 'PUT', {
        baseHash: created.body.note.contentHash, operation: { type: 'replace', tags: ['x', 'X'] },
      });
      expect(invalid.status).toBe(422);
      expect(invalid.body.error.code).toBe('INVALID_TAG');
      const arbitrary = await json<{ error: { code: string } }>(base, `/api/notes/${id}/tags`, 'PUT', {
        baseHash: created.body.note.contentHash, operation: { type: 'add', tag: 'x' }, frontmatter: { title: 'replacement' },
      });
      expect(arbitrary.status).toBe(400);
      const missing = await json<{ error: { code: string } }>(base, `/api/notes/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/tags`, 'PUT', {
        baseHash: created.body.note.contentHash, operation: { type: 'add', tag: 'x' },
      });
      expect(missing.status).toBe(404);
      await vault.updateNoteTags(id, { type: 'add', tag: 'External' }, { expectedHash: created.body.note.contentHash, now: LATER });
      const stale = await json<{ error: { code: string; currentHash?: string } }>(base, `/api/notes/${id}/tags`, 'PUT', {
        baseHash: created.body.note.contentHash, operation: { type: 'add', tag: 'stale' },
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toMatchObject({ code: 'STALE_WRITE', currentHash: (await vault.readNoteWithHash(id)).hash });
    });
  });

  it('invalidates derived snapshots after a tag write', async () => {
    await withApi(async (base, vault) => {
      const initial = createNote({ id: NOTE_ID, title: 'Snapshot target', path: 'notes/snapshot-target.md', body: '', now: NOW });
      await vault.createNote(initial);
      const note = (await vault.readNoteWithHash(NOTE_ID)).note;
      const before = await json<{ results: Array<{ id: string; updatedAt: string }> }>(base, '/api/search?q=Snapshot');
      expect(before.body.results[0]?.updatedAt).toBe(NOW);
      const opened = await vault.readNoteWithHash(note.id);
      await json(base, `/api/notes/${note.id}/tags`, 'PUT', { baseHash: opened.hash, operation: { type: 'add', tag: 'current' } });
      const after = await json<{ results: Array<{ id: string; updatedAt: string }> }>(base, '/api/search?q=Snapshot');
      expect(after.body.results[0]?.updatedAt).toBe(LATER);
    });
  });
});
