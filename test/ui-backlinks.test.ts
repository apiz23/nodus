import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote, type Note } from '../src/domain/note.js';
import { serializeNote } from '../src/format/note-format.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiBacklinksResponse, UiNote, UiVaultStatus } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-10-25T12:00:00Z';
const TARGET = 'aaaaaaaa-1111-4111-8111-111111111111';
const SOURCE = 'bbbbbbbb-2222-4222-8222-222222222222';
const OTHER = 'cccccccc-3333-4333-8333-333333333333';
const DUP1 = 'dddddddd-4444-4444-8444-444444444444';
const DUP2 = 'eeeeeeee-5555-4555-8555-555555555555';

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

async function json<T>(
  base: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return { status: response.status, body: (await response.json()) as T };
}

function note(id: string, title: string, body: string): Note {
  return createNote({ id, title, path: `notes/${id.slice(0, 8)}.md`, body, now: NOW });
}

async function seedVault(vaultPath: string, notes: Note[]): Promise<void> {
  const vault = await FileSystemVault.open(vaultPath);
  for (const entry of notes) await vault.createNote(entry);
}

describe('backlinks API', () => {
  it('returns confirmed backlinks with stable source IDs and titles', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedVault(vaultPath, [
        note(TARGET, 'Target', 'Target body'),
        note(SOURCE, 'Source', 'See [[Target]] and again [[Target]].'),
      ]);
      const started = await startApi(vaultPath);
      try {
        const result = await json<UiBacklinksResponse>(started.base, `/api/notes/${TARGET}/backlinks`);
        expect(result.status).toBe(200);
        expect(result.body.backlinks).toEqual([
          { sourceId: SOURCE, sourceTitle: 'Source', snippet: 'See [[Target]] and again [[Target]].', count: 2, ambiguous: false },
        ]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('returns an empty list for a note without backlinks', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedVault(vaultPath, [note(TARGET, 'Target', '')]);
      const started = await startApi(vaultPath);
      try {
        const result = await json<UiBacklinksResponse>(started.base, `/api/notes/${TARGET}/backlinks`);
        expect(result.status).toBe(200);
        expect(result.body.backlinks).toEqual([]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('returns 404 for a missing target and 400 for a malformed ID', async () => {
    await withTempDir(async (dir) => {
      const started = await startApi(join(dir, 'vault'));
      try {
        const missing = await json(started.base, `/api/notes/${TARGET}/backlinks`);
        expect(missing.status).toBe(404);
        const malformed = await json(started.base, '/api/notes/not-a-uuid/backlinks');
        expect(malformed.status).toBe(400);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('reflects a body save that adds and removes links without stale entries', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedVault(vaultPath, [
        note(TARGET, 'Target', ''),
        note(SOURCE, 'Source', 'Nothing yet.'),
      ]);
      const started = await startApi(vaultPath);
      try {
        const opened = await json<{ note: UiNote }>(started.base, `/api/notes/${SOURCE}`);
        const saved = await json<{ note: UiNote }>(started.base, `/api/notes/${SOURCE}`, {
          method: 'PUT',
          body: {
            title: 'Source',
            body: 'Now links [[Target]].',
            baseHash: opened.body.note.contentHash,
          },
        });
        expect(saved.status).toBe(200);
        const afterAdd = await json<UiBacklinksResponse>(started.base, `/api/notes/${TARGET}/backlinks`);
        expect(afterAdd.body.backlinks).toHaveLength(1);
        expect(afterAdd.body.backlinks[0]).toMatchObject({ sourceId: SOURCE, count: 1 });

        const reopened = await json<{ note: UiNote }>(started.base, `/api/notes/${SOURCE}`);
        await json(started.base, `/api/notes/${SOURCE}`, {
          method: 'PUT',
          body: { title: 'Source', body: 'Link removed.', baseHash: reopened.body.note.contentHash },
        });
        const afterRemove = await json<UiBacklinksResponse>(started.base, `/api/notes/${TARGET}/backlinks`);
        expect(afterRemove.body.backlinks).toEqual([]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('drops backlinks to a title when the target title is renamed', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedVault(vaultPath, [
        note(TARGET, 'Old title', ''),
        note(SOURCE, 'Source', 'See [[Old title]].'),
      ]);
      const started = await startApi(vaultPath);
      try {
        const opened = await json<{ note: UiNote }>(started.base, `/api/notes/${TARGET}`);
        await json(started.base, `/api/notes/${TARGET}`, {
          method: 'PUT',
          body: { title: 'New title', body: '', baseHash: opened.body.note.contentHash },
        });
        const after = await json<UiBacklinksResponse>(started.base, `/api/notes/${TARGET}/backlinks`);
        expect(after.body.backlinks).toEqual([]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('keeps backlinks stable when a note moves path', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedVault(vaultPath, [
        note(TARGET, 'Target', ''),
        note(SOURCE, 'Source', 'See [[Target]].'),
      ]);
      const started = await startApi(vaultPath);
      try {
        const opened = await json<{ note: UiNote }>(started.base, `/api/notes/${SOURCE}`);
        const moved = await json(started.base, `/api/notes/${SOURCE}/move`, {
          method: 'POST',
          body: { path: 'notes/moved-source.md', baseHash: opened.body.note.contentHash },
        });
        expect(moved.status).toBe(200);
        const after = await json<UiBacklinksResponse>(started.base, `/api/notes/${TARGET}/backlinks`);
        expect(after.body.backlinks).toEqual([
          { sourceId: SOURCE, sourceTitle: 'Source', snippet: 'See [[Target]].', count: 1, ambiguous: false },
        ]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('surfaces a title ambiguity instead of resolving it silently', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedVault(vaultPath, [
        note(TARGET, 'Target', ''),
        note(SOURCE, 'Source', 'See [[Shared]].'),
        note(DUP1, 'Shared', ''),
        note(DUP2, 'Shared', ''),
      ]);
      const started = await startApi(vaultPath);
      try {
        const ambiguous = await json<UiBacklinksResponse>(started.base, `/api/notes/${DUP1}/backlinks`);
        expect(ambiguous.body.backlinks).toEqual([
          { sourceId: SOURCE, sourceTitle: 'Source', snippet: 'See [[Shared]].', count: 1, ambiguous: true },
        ]);
        // Removing one duplicate resolves the link for the remaining note.
        const dup2 = await json<{ note: UiNote }>(started.base, `/api/notes/${DUP2}`);
        await json(started.base, `/api/notes/${DUP2}`, {
          method: 'DELETE',
          body: { baseHash: dup2.body.note.contentHash },
        });
        const resolved = await json<UiBacklinksResponse>(started.base, `/api/notes/${DUP1}/backlinks`);
        expect(resolved.body.backlinks[0]).toMatchObject({ sourceId: SOURCE, ambiguous: false });
      } finally {
        await stopApi(started);
      }
    });
  });

  it('returns 404 after the target is deleted', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedVault(vaultPath, [
        note(TARGET, 'Target', ''),
        note(SOURCE, 'Source', 'See [[Target]].'),
      ]);
      const started = await startApi(vaultPath);
      try {
        const opened = await json<{ note: UiNote }>(started.base, `/api/notes/${TARGET}`);
        await json(started.base, `/api/notes/${TARGET}`, {
          method: 'DELETE',
          body: { baseHash: opened.body.note.contentHash },
        });
        const after = await json(started.base, `/api/notes/${TARGET}/backlinks`);
        expect(after.status).toBe(404);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('rebuilds the index from Markdown after a server restart', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedVault(vaultPath, [
        note(TARGET, 'Target', ''),
        note(SOURCE, 'Source', 'See [[Target]].'),
      ]);
      const first = await startApi(vaultPath);
      let status: UiVaultStatus;
      try {
        status = (await json<UiVaultStatus>(first.base, '/api/status')).body;
      } finally {
        await stopApi(first);
      }
      expect(status.counts.notes).toBe(2);

      const second = await startApi(vaultPath);
      try {
        const after = await json<UiBacklinksResponse>(second.base, `/api/notes/${TARGET}/backlinks`);
        expect(after.body.backlinks).toEqual([
          { sourceId: SOURCE, sourceTitle: 'Source', snippet: 'See [[Target]].', count: 1, ambiguous: false },
        ]);
      } finally {
        await stopApi(second);
      }
    });
  });

  it('does not write to the vault while serving backlinks', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedVault(vaultPath, [
        note(TARGET, 'Target', ''),
        note(SOURCE, 'Source', 'See [[Target]].'),
      ]);
      const started = await startApi(vaultPath);
      try {
        const before = (await json<UiVaultStatus>(started.base, '/api/status')).body;
        await json<UiBacklinksResponse>(started.base, `/api/notes/${TARGET}/backlinks`);
        const after = (await json<UiVaultStatus>(started.base, '/api/status')).body;
        expect(after.counts).toEqual(before.counts);
        expect(after.health.issues).toEqual(before.health.issues);
      } finally {
        await stopApi(started);
      }
    });
  });
});
