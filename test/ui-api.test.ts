import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote, type Note } from '../src/domain/note.js';
import { parseNote, serializeNote } from '../src/format/note-format.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiDatabase, UiNote, UiVaultPickResult, UiVaultStatus } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-10-25T12:00:00Z';
const N1 = '11111111-1111-4111-8111-111111111111';
const N2 = '22222222-2222-4222-8222-222222222222';
const DB1 = '33333333-3333-4333-8333-333333333333';
const PROP1 = '44444444-4444-4444-8444-444444444444';

interface StartedApi {
  server: Server;
  base: string;
}

async function startApi(
  vaultPath: string,
  folderPicker?: () => Promise<string | null>,
): Promise<StartedApi> {
  const middleware = createLocalApiMiddleware({ vaultPath, now: () => NOW, folderPicker });
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
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

function noteFixture(id: string, title: string, path: string, body: string): Note {
  return {
    ...createNote({ id, title, path, body, now: NOW }),
    extraFrontmatter: { project: 'Research', status: 'draft' },
  };
}

describe('local UI API', () => {
  it('starts with an empty workspace and reports no sync connection', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const started = await startApi(vaultPath);
      try {
        const status = await json<UiVaultStatus>(started.base, '/api/status');
        expect(status.status).toBe(200);
        expect(status.body.counts.notes).toBe(0);
        expect(status.body.counts.databases).toBe(0);
        expect(status.body.sync).toMatchObject({
          status: 'not-connected',
          label: 'Not connected',
        });
        expect(status.body.sync.detail).toContain('Phase 4');

        const notes = await json<{ notes: unknown[] }>(started.base, '/api/notes');
        expect(notes.status).toBe(200);
        expect(notes.body.notes).toEqual([]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('switches vaults only through the server-side folder picker', async () => {
    await withTempDir(async (dir) => {
      const vaultA = join(dir, 'vault-a');
      const vaultB = join(dir, 'vault-b');
      const first = await FileSystemVault.open(vaultA);
      await first.createNote(
        createNote({
          id: N1,
          title: 'From A',
          path: 'notes/a.md',
          body: 'A\n',
          now: NOW,
        }),
      );
      const second = await FileSystemVault.open(vaultB);
      await second.createNote(
        createNote({
          id: N2,
          title: 'From B',
          path: 'notes/b.md',
          body: 'B\n',
          now: NOW,
        }),
      );

      const started = await startApi(vaultA, async () => vaultB);
      try {
        const picked = await json<UiVaultPickResult>(started.base, '/api/vault/pick', {
          method: 'POST',
        });
        expect(picked.status).toBe(200);
        expect(picked.body.canceled).toBe(false);
        if (!picked.body.canceled) {
          expect(picked.body.status.vault.name).toBe('vault-b');
        }

        const notes = await json<{ notes: Array<{ id: string }> }>(started.base, '/api/notes');
        expect(notes.body.notes.map((note) => note.id)).toEqual([N2]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('opens an absolute vault path from settings', async () => {
    await withTempDir(async (dir) => {
      const vaultA = join(dir, 'vault-a');
      const vaultB = join(dir, 'vault-b');
      const first = await FileSystemVault.open(vaultA);
      await first.createNote(
        createNote({
          id: N1,
          title: 'A',
          path: 'notes/a.md',
          body: 'A\n',
          now: NOW,
        }),
      );
      const second = await FileSystemVault.open(vaultB);
      await second.createNote(
        createNote({
          id: N2,
          title: 'B',
          path: 'notes/b.md',
          body: 'B\n',
          now: NOW,
        }),
      );

      const started = await startApi(vaultA);
      try {
        const opened = await json<UiVaultStatus>(started.base, '/api/vault/open', {
          method: 'POST',
          body: { path: vaultB },
        });
        expect(opened.status).toBe(200);
        expect(opened.body.vault.name).toBe('vault-b');

        const notes = await json<{ notes: Array<{ id: string }> }>(started.base, '/api/notes');
        expect(notes.body.notes.map((note) => note.id)).toEqual([N2]);

        const bad = await json<{ error: { code: string } }>(started.base, '/api/vault/open', {
          method: 'POST',
          body: { path: 'relative/vault' },
        });
        expect(bad.status).toBe(400);
        expect(bad.body.error.code).toBe('INVALID_VAULT');
      } finally {
        await stopApi(started);
      }
    });
  });

  it('keeps the current vault when the native picker is canceled', async () => {
    await withTempDir(async (dir) => {
      const vaultA = join(dir, 'vault-a');
      const first = await FileSystemVault.open(vaultA);
      await first.createNote(
        createNote({
          id: N1,
          title: 'Still here',
          path: 'notes/a.md',
          body: 'A\n',
          now: NOW,
        }),
      );

      const started = await startApi(vaultA, async () => null);
      try {
        const picked = await json<UiVaultPickResult>(started.base, '/api/vault/pick', {
          method: 'POST',
        });
        expect(picked.status).toBe(200);
        expect(picked.body).toEqual({ canceled: true });

        const notes = await json<{ notes: Array<{ id: string }> }>(started.base, '/api/notes');
        expect(notes.body.notes[0]?.id).toBe(N1);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('creates, lists, opens, saves, and reloads a note', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const started = await startApi(vaultPath);
      try {
        const created = await json<{ note: UiNote }>(started.base, '/api/notes', {
          method: 'POST',
          body: { title: 'My first note' },
        });
        expect(created.status).toBe(201);
        expect(created.body.note.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(created.body.note.path).toBe('notes/my-first-note.md');

        const list = await json<{ notes: Array<{ id: string }> }>(started.base, '/api/notes');
        expect(list.body.notes).toHaveLength(1);
        expect(list.body.notes[0]?.id).toBe(created.body.note.id);

        const opened = await json<{ note: UiNote }>(
          started.base,
          `/api/notes/${created.body.note.id}`,
        );
        expect(opened.body.note.contentHash).toMatch(/^[0-9a-f]{64}$/);

        const saved = await json<{ note: UiNote }>(
          started.base,
          `/api/notes/${created.body.note.id}`,
          {
            method: 'PUT',
            body: {
              title: 'My first note',
              body: 'Hello **world**\n',
              baseHash: opened.body.note.contentHash,
            },
          },
        );
        expect(saved.status).toBe(200);
        expect(saved.body.note.body).toContain('Hello **world**');

        const raw = await readFile(join(vaultPath, 'notes/my-first-note.md'), 'utf8');
        expect(raw).toContain('nodus:');
        expect(raw).toContain('Hello **world**');

        const reloaded = await json<{ note: UiNote }>(
          started.base,
          `/api/notes/${created.body.note.id}`,
        );
        expect(reloaded.body.note.body).toBe('Hello **world**\n');
        expect(reloaded.body.note.id).toBe(created.body.note.id);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('preserves stable ID and unknown frontmatter through an edit', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      const original = noteFixture(N1, 'Research note', 'notes/research.md', 'Original\n');
      await mkdir(join(vaultPath, 'notes'), { recursive: true });
      await writeFile(join(vaultPath, original.path), serializeNote(original), 'utf8');

      const started = await startApi(vaultPath);
      try {
        const opened = await json<{ note: UiNote }>(started.base, `/api/notes/${N1}`);
        expect(opened.body.note.id).toBe(N1);
        expect(opened.body.note.metadataKeys).toEqual(['project', 'status']);

        const saved = await json<{ note: UiNote }>(started.base, `/api/notes/${N1}`, {
          method: 'PUT',
          body: {
            title: 'Research note',
            body: 'Edited body\n',
            baseHash: opened.body.note.contentHash,
          },
        });
        expect(saved.status).toBe(200);
        expect(saved.body.note.id).toBe(N1);

        const raw = await readFile(join(vaultPath, 'notes/research.md'), 'utf8');
        const reparsed = parseNote(raw, 'notes/research.md');
        expect(reparsed.id).toBe(N1);
        expect(reparsed.createdAt).toBe(original.createdAt);
        expect(reparsed.extraFrontmatter).toEqual({ project: 'Research', status: 'draft' });
      } finally {
        await stopApi(started);
      }
    });
  });

  it('refuses to overwrite a note changed outside the UI', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const started = await startApi(vaultPath);
      try {
        const created = await json<{ note: UiNote }>(started.base, '/api/notes', {
          method: 'POST',
          body: { title: 'Conflict' },
        });
        const opened = await json<{ note: UiNote }>(
          started.base,
          `/api/notes/${created.body.note.id}`,
        );

        await writeFile(
          join(vaultPath, created.body.note.path),
          serializeNote(noteFixture(created.body.note.id, 'Conflict', created.body.note.path, 'Changed externally\n')),
          'utf8',
        );

        const saved = await json<{ error: { code: string; currentHash?: string } }>(
          started.base,
          `/api/notes/${created.body.note.id}`,
          {
            method: 'PUT',
            body: {
              title: 'Conflict',
              body: 'UI edit\n',
              baseHash: opened.body.note.contentHash,
            },
          },
        );
        expect(saved.status).toBe(409);
        expect(saved.body.error.code).toBe('STALE_WRITE');
        expect(saved.body.error.currentHash).toMatch(/^[0-9a-f]{64}$/);

        const raw = await readFile(join(vaultPath, created.body.note.path), 'utf8');
        expect(raw).toContain('Changed externally');
        expect(raw).not.toContain('UI edit');
      } finally {
        await stopApi(started);
      }
    });
  });

  it('searches note titles and bodies', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createNote(
        createNote({
          id: N1,
          title: 'Alpha',
          path: 'notes/alpha.md',
          body: 'The needle is in the body.\n',
          now: NOW,
        }),
      );
      await vault.createNote(
        createNote({
          id: N2,
          title: 'Needle title',
          path: 'notes/needle.md',
          body: 'Haystack.\n',
          now: NOW,
        }),
      );

      const started = await startApi(vaultPath);
      try {
        const results = await json<{ results: Array<{ id: string; snippet: string }> }>(
          started.base,
          '/api/search?q=needle',
        );
        expect(results.status).toBe(200);
        expect(results.body.results).toHaveLength(2);
        expect(results.body.results.some((result) => result.id === N1)).toBe(true);
        expect(results.body.results.some((result) => result.id === N2)).toBe(true);
        expect(results.body.results.find((result) => result.id === N1)?.snippet).toContain('needle');

        const none = await json<{ results: unknown[] }>(started.base, '/api/search?q=absent');
        expect(none.body.results).toEqual([]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('renames safely and rejects traversal', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const started = await startApi(vaultPath);
      try {
        const created = await json<{ note: UiNote }>(started.base, '/api/notes', {
          method: 'POST',
          body: { title: 'Rename me' },
        });
        const moved = await json<{ note: UiNote }>(
          started.base,
          `/api/notes/${created.body.note.id}/move`,
          {
            method: 'POST',
            body: {
              path: 'archive/renamed.md',
              baseHash: created.body.note.contentHash,
            },
          },
        );
        expect(moved.status).toBe(200);
        expect(moved.body.note.id).toBe(created.body.note.id);
        expect(moved.body.note.path).toBe('archive/renamed.md');

        const unsafe = await json<{ error: { code: string } }>(
          started.base,
          `/api/notes/${created.body.note.id}/move`,
          {
            method: 'POST',
            body: {
              path: '../outside.md',
              baseHash: moved.body.note.contentHash,
            },
          },
        );
        expect(unsafe.status).toBe(400);
        expect(unsafe.body.error.code).toBe('UNSAFE_PATH');
        await expect(readFile(join(dir, 'outside.md'), 'utf8')).rejects.toThrow();
      } finally {
        await stopApi(started);
      }
    });
  });

  it('deletes only with the current hash', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const started = await startApi(vaultPath);
      try {
        const created = await json<{ note: UiNote }>(started.base, '/api/notes', {
          method: 'POST',
          body: { title: 'Delete me' },
        });

        const stale = await json<{ error: { code: string } }>(
          started.base,
          `/api/notes/${created.body.note.id}`,
          {
            method: 'DELETE',
            body: { baseHash: '0'.repeat(64) },
          },
        );
        expect(stale.status).toBe(409);

        const deleted = await json<{ deleted: boolean }>(
          started.base,
          `/api/notes/${created.body.note.id}`,
          {
            method: 'DELETE',
            body: { baseHash: created.body.note.contentHash },
          },
        );
        expect(deleted.status).toBe(200);
        expect(deleted.body.deleted).toBe(true);

        const list = await json<{ notes: unknown[] }>(started.base, '/api/notes');
        expect(list.body.notes).toEqual([]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('returns database definitions read-only', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createDatabase({
        id: DB1,
        name: 'Reading list',
        properties: [{ id: PROP1, name: 'Title', type: 'text' }],
      });

      const started = await startApi(vaultPath);
      try {
        const result = await json<{ databases: UiDatabase[] }>(started.base, '/api/databases');
        expect(result.status).toBe(200);
        expect(result.body.databases).toHaveLength(1);
        expect(result.body.databases[0]).toMatchObject({
          id: DB1,
          name: 'Reading list',
          path: `databases/${DB1}.json`,
        });
        expect(result.body.databases[0]?.properties[0]?.type).toBe('text');

        const writeAttempt = await json<{ error: { code: string } }>(
          started.base,
          '/api/databases',
          { method: 'POST', body: { name: 'Nope' } },
        );
        expect(writeAttempt.status).toBe(404);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('reports malformed notes as health issues and blocks strict listing', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await mkdir(join(vaultPath, 'notes'), { recursive: true });
      await writeFile(join(vaultPath, 'notes/broken.md'), 'not frontmatter', 'utf8');

      const started = await startApi(vaultPath);
      try {
        const status = await json<UiVaultStatus>(started.base, '/api/status');
        expect(status.status).toBe(200);
        expect(status.body.counts.issues).toBe(1);
        expect(status.body.health.issues[0]?.code).toBe('INVALID_CONTENT');

        const notes = await json<{ error: { code: string } }>(started.base, '/api/notes');
        expect(notes.status).toBe(422);
        expect(notes.body.error.code).toBe('INVALID_CONTENT');
      } finally {
        await stopApi(started);
      }
    });
  });

  it('rejects cross-origin writes to the local API', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const started = await startApi(vaultPath);
      try {
        const response = await fetch(`${started.base}/api/notes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://evil.example',
          },
          body: JSON.stringify({ title: 'Nope' }),
        });
        expect(response.status).toBe(403);
      } finally {
        await stopApi(started);
      }
    });
  });
});
