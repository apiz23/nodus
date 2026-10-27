import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote, type Note } from '../src/domain/note.js';
import { parseNote, serializeNote } from '../src/format/note-format.js';
import { createBackup } from '../src/storage/backup/backup.js';
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

  it('rejects opening a vault outside the allowed roots by default', async () => {
    await withTempDir(async (dir) => {
      const vaultA = join(dir, 'vault-a');
      const started = await startApi(vaultA);
      try {
        // The default root is the current vault's parent (dir), not tmpdir()
        // and not the user's home directory.
        const outside = tmpdir();
        expect(outside.startsWith(dir)).toBe(false);

        const rejected = await json<{ error: { code: string; message: string } }>(
          started.base,
          '/api/vault/open',
          { method: 'POST', body: { path: outside } },
        );
        expect(rejected.status).toBe(403);
        expect(rejected.body.error.code).toBe('VAULT_NOT_ALLOWED');
        expect(rejected.body.error.message).toContain('NODUS_VAULT_ROOTS');

        const status = await json<UiVaultStatus>(started.base, '/api/status');
        expect(status.body.vault.path).toBe(
          await realpath(vaultA).catch(() => vaultA),
        );
      } finally {
        await stopApi(started);
      }
    });
  });

  it('accepts a vault inside the default root and rejects symlink escapes', async () => {
    await withTempDir(async (dir) => {
      const vaultA = join(dir, 'vault-a');
      const vaultB = join(dir, 'vault-b');
      await FileSystemVault.open(vaultB);
      const outside = await mkdtemp(join(tmpdir(), 'nodus-outside-'));
      const escapeLink = join(dir, 'escape-link');
      const insideLink = join(dir, 'inside-link');
      await symlink(outside, escapeLink, 'dir');
      await symlink(vaultB, insideLink, 'dir');

      const started = await startApi(vaultA);
      try {
        const inside = await json<UiVaultStatus>(started.base, '/api/vault/open', {
          method: 'POST',
          body: { path: insideLink },
        });
        expect(inside.status).toBe(200);
        expect(inside.body.vault.path).toBe(await realpath(vaultB));

        const escaped = await json<{ error: { code: string } }>(started.base, '/api/vault/open', {
          method: 'POST',
          body: { path: escapeLink },
        });
        expect(escaped.status).toBe(403);
        expect(escaped.body.error.code).toBe('VAULT_NOT_ALLOWED');
      } finally {
        await stopApi(started);
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('allows an outside vault when NODUS_VAULT_ROOTS lists its root', async () => {
    await withTempDir(async (dir) => {
      const allowed = await mkdtemp(join(tmpdir(), 'nodus-allowed-'));
      const outsideVault = join(allowed, 'vault-x');
      await mkdir(outsideVault, { recursive: true });
      const vaultA = join(dir, 'vault-a');
      const started = await startApi(vaultA);
      process.env.NODUS_VAULT_ROOTS = allowed;
      try {
        const opened = await json<UiVaultStatus>(started.base, '/api/vault/open', {
          method: 'POST',
          body: { path: outsideVault },
        });
        expect(opened.status).toBe(200);
        expect(opened.body.vault.name).toBe('vault-x');
      } finally {
        delete process.env.NODUS_VAULT_ROOTS;
        await stopApi(started);
        await rm(allowed, { recursive: true, force: true });
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

  it('sets, removes, and preserves the page icon through saves', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      const original = noteFixture(N1, 'Research note', 'notes/research.md', 'Original\n');
      await mkdir(join(vaultPath, 'notes'), { recursive: true });
      await writeFile(join(vaultPath, original.path), serializeNote(original), 'utf8');

      const started = await startApi(vaultPath);
      try {
        const opened = await json<{ note: { icon: string | null; metadataKeys: string[]; contentHash: string } }>(
          started.base,
          `/api/notes/${N1}`,
        );
        expect(opened.body.note.icon).toBeNull();

        const set = await json<{ note: { icon: string | null } }>(started.base, `/api/notes/${N1}`, {
          method: 'PUT',
          body: {
            title: 'Research note',
            body: 'Edited body\n',
            baseHash: opened.body.note.contentHash,
            icon: '📘',
          },
        });
        expect(set.status).toBe(200);
        expect(set.body.note.icon).toBe('📘');

        const rawWithIcon = await readFile(join(vaultPath, 'notes/research.md'), 'utf8');
        const reparsedWithIcon = parseNote(rawWithIcon, 'notes/research.md');
        expect(reparsedWithIcon.extraFrontmatter).toEqual({ project: 'Research', status: 'draft', icon: '📘' });

        const openedAgain = await json<{ note: { contentHash: string } }>(
          started.base,
          `/api/notes/${N1}`,
        );
        const preserved = await json<{ note: { icon: string | null } }>(
          started.base,
          `/api/notes/${N1}`,
          {
            method: 'PUT',
            body: {
              title: 'Research note',
              body: 'Edited body again\n',
              baseHash: openedAgain.body.note.contentHash,
            },
          },
        );
        expect(preserved.body.note.icon).toBe('📘');

        const openedAfterPreserve = await json<{ note: { contentHash: string } }>(
          started.base,
          `/api/notes/${N1}`,
        );
        const removed = await json<{ note: { icon: string | null; metadataKeys: string[] } }>(
          started.base,
          `/api/notes/${N1}`,
          {
            method: 'PUT',
            body: {
              title: 'Research note',
              body: 'Edited body\n',
              baseHash: openedAfterPreserve.body.note.contentHash,
              icon: null,
            },
          },
        );
        expect(removed.body.note.icon).toBeNull();
        expect(removed.body.note.metadataKeys).toEqual(['project', 'status']);

        const rawAfterRemove = await readFile(join(vaultPath, 'notes/research.md'), 'utf8');
        const reparsedAfterRemove = parseNote(rawAfterRemove, 'notes/research.md');
        expect(reparsedAfterRemove.extraFrontmatter).toEqual({ project: 'Research', status: 'draft' });

        const rawWithInvalid = rawAfterRemove.replace('status: draft', 'status: draft\nicon: 123');
        await writeFile(join(vaultPath, 'notes/research.md'), rawWithInvalid, 'utf8');
        const openedInvalid = await json<{ note: { icon: string | null; contentHash: string } }>(
          started.base,
          `/api/notes/${N1}`,
        );
        expect(openedInvalid.body.note.icon).toBeNull();
        await json(started.base, `/api/notes/${N1}`, {
          method: 'PUT',
          body: {
            title: 'Research note',
            body: 'Unrelated edit\n',
            baseHash: openedInvalid.body.note.contentHash,
          },
        });
        const rawPreservedInvalid = await readFile(join(vaultPath, 'notes/research.md'), 'utf8');
        expect(parseNote(rawPreservedInvalid, 'notes/research.md').extraFrontmatter).toEqual({
          project: 'Research',
          status: 'draft',
          icon: 123,
        });
      } finally {
        await stopApi(started);
      }
    });
  });

  it('rejects an invalid icon value', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const started = await startApi(vaultPath);
      try {
        const created = await json<{ note: { id: string; contentHash: string } }>(started.base, '/api/notes', {
          method: 'POST',
          body: { title: 'Icon test' },
        });
        const saved = await json<{ error: { code: string } }>(
          started.base,
          `/api/notes/${created.body.note.id}`,
          {
            method: 'PUT',
            body: {
              title: 'Icon test',
              body: 'Body\n',
              baseHash: created.body.note.contentHash,
              icon: 'a'.repeat(100),
            },
          },
        );
        expect(saved.status).toBe(400);
        expect(saved.body.error.code).toBe('INVALID_INPUT');
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

  it('refuses to rename a note changed outside the UI', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const started = await startApi(vaultPath);
      try {
        const created = await json<{ note: UiNote }>(started.base, '/api/notes', {
          method: 'POST',
          body: { title: 'Move conflict' },
        });
        const opened = await json<{ note: UiNote }>(
          started.base,
          `/api/notes/${created.body.note.id}`,
        );

        await writeFile(
          join(vaultPath, created.body.note.path),
          serializeNote(
            noteFixture(created.body.note.id, 'Move conflict', created.body.note.path, 'Moved externally\n'),
          ),
          'utf8',
        );

        const moved = await json<{ error: { code: string; currentHash?: string } }>(
          started.base,
          `/api/notes/${created.body.note.id}/move`,
          {
            method: 'POST',
            body: {
              path: 'archive/renamed.md',
              baseHash: opened.body.note.contentHash,
            },
          },
        );
        expect(moved.status).toBe(409);
        expect(moved.body.error.code).toBe('STALE_WRITE');
        expect(moved.body.error.currentHash).toMatch(/^[0-9a-f]{64}$/);

        const raw = await readFile(join(vaultPath, created.body.note.path), 'utf8');
        expect(raw).toContain('Moved externally');
        expect(await readFile(join(vaultPath, 'archive/renamed.md'), 'utf8').catch(() => '')).toBe('');
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
      await writeFile(
        join(vaultPath, 'notes/broken.md'),
        '---\ntitle: [broken\nnodus:\n  version: 1\n---\nBody\n',
        'utf8',
      );

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

  it('allows requests from the UI origin and rejects other localhost ports', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const started = await startApi(vaultPath);
      try {
        for (const origin of [
          'http://127.0.0.1:5173',
          'http://localhost:5173',
          'http://127.0.0.1:4173',
          'http://localhost:4173',
        ]) {
          const allowed = await fetch(`${started.base}/api/status`, { headers: { Origin: origin } });
          expect(allowed.status, `origin ${origin} should be allowed`).toBe(200);
        }

        const otherPort = await fetch(`${started.base}/api/status`, {
          headers: { Origin: 'http://127.0.0.1:9999' },
        });
        expect(otherPort.status).toBe(403);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('honors the NODUS_ALLOWED_ORIGINS override', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const previous = process.env.NODUS_ALLOWED_ORIGINS;
      process.env.NODUS_ALLOWED_ORIGINS = 'http://127.0.0.1:9999';
      const started = await startApi(vaultPath);
      try {
        const overrideAllowed = await fetch(`${started.base}/api/status`, {
          headers: { Origin: 'http://127.0.0.1:9999' },
        });
        expect(overrideAllowed.status).toBe(200);

        const defaultRejected = await fetch(`${started.base}/api/status`, {
          headers: { Origin: 'http://127.0.0.1:5173' },
        });
        expect(defaultRejected.status).toBe(403);
      } finally {
        if (previous === undefined) delete process.env.NODUS_ALLOWED_ORIGINS;
        else process.env.NODUS_ALLOWED_ORIGINS = previous;
        await stopApi(started);
      }
    });
  });
});

interface ErrorBody {
  error: { code: string; message: string; issues?: string[]; paths?: string[] };
}

describe('backup and restore API routes', () => {
  const N3 = '55555555-5555-4555-8555-555555555555';
  const MANIFEST_FILE = 'nodus-backup.json';

  async function seedBackupVault(root: string): Promise<FileSystemVault> {
    const vault = await FileSystemVault.open(root);
    await vault.createNote(
      createNote({ id: N1, title: 'Backup note', path: 'notes/a.md', body: 'Backup body\n', now: NOW }),
    );
    await vault.createDatabase({
      id: DB1,
      name: 'Reading list',
      properties: [{ id: PROP1, name: 'Title', type: 'text' }],
    });
    return vault;
  }

  async function pathExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  it('creates a backup and validates it over HTTP', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedBackupVault(vaultPath);
      const started = await startApi(vaultPath);
      const target = join(dir, 'backup-http');
      try {
        const created = await json<{ targetDir: string; notes: number; databases: number }>(
          started.base,
          '/api/backup',
          { method: 'POST', body: { targetDir: target } },
        );
        expect(created.status).toBe(201);
        expect(created.body).toEqual({ targetDir: target, notes: 1, databases: 1 });
        expect((await stat(join(target, MANIFEST_FILE))).isFile()).toBe(true);

        const validated = await json<{
          manifest: { format: string; files: Array<{ path: string }> };
          counts: { notes: number; databases: number };
        }>(started.base, '/api/backup/validate', { method: 'POST', body: { dir: target } });
        expect(validated.status).toBe(200);
        expect(validated.body.manifest.format).toBe('nodus-backup');
        expect(validated.body.counts).toEqual({ notes: 1, databases: 1 });
        expect(validated.body.manifest.files.every((file) => !file.path.startsWith('/'))).toBe(true);
        expect(JSON.stringify(validated.body)).not.toContain(dir);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('rejects invalid backup target fields without writing', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await mkdir(vaultPath, { recursive: true });
      const started = await startApi(vaultPath);
      const outside = await mkdtemp(join(tmpdir(), 'nodus-api-outside-'));
      try {
        const missing = await json<ErrorBody>(started.base, '/api/backup', {
          method: 'POST',
          body: {},
        });
        expect(missing.status).toBe(400);
        expect(missing.body.error.code).toBe('INVALID_INPUT');
        expect(missing.body.error.message).toContain('targetDir');

        const wrongType = await json<ErrorBody>(started.base, '/api/backup', {
          method: 'POST',
          body: { targetDir: 42 },
        });
        expect(wrongType.status).toBe(400);
        expect(wrongType.body.error.code).toBe('INVALID_INPUT');

        const relative = await json<ErrorBody>(started.base, '/api/backup', {
          method: 'POST',
          body: { targetDir: 'backups/relative' },
        });
        expect(relative.status).toBe(400);
        expect(relative.body.error.message).toContain('absolute');

        const insideVault = join(vaultPath, 'inside');
        const inside = await json<ErrorBody>(started.base, '/api/backup', {
          method: 'POST',
          body: { targetDir: insideVault },
        });
        expect(inside.status).toBe(400);
        expect(inside.body.error.message).toContain('outside the vault');
        expect(await pathExists(insideVault)).toBe(false);

        const unlisted = await json<ErrorBody>(started.base, '/api/backup', {
          method: 'POST',
          body: { targetDir: join(outside, 'backup') },
        });
        expect(unlisted.status).toBe(403);
        expect(unlisted.body.error.code).toBe('BACKUP_TARGET_NOT_ALLOWED');
        expect(await pathExists(join(outside, 'backup'))).toBe(false);
      } finally {
        await stopApi(started);
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('maps corrupt, unsupported, and missing backups to 422/404', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedBackupVault(vaultPath);
      const started = await startApi(vaultPath);
      try {
        const corruptTarget = join(dir, 'backup-corrupt');
        const unsupportedTarget = join(dir, 'backup-unsupported');
        expect(
          (
            await json(started.base, '/api/backup', {
              method: 'POST',
              body: { targetDir: corruptTarget },
            })
          ).status,
        ).toBe(201);
        expect(
          (
            await json(started.base, '/api/backup', {
              method: 'POST',
              body: { targetDir: unsupportedTarget },
            })
          ).status,
        ).toBe(201);

        await writeFile(join(corruptTarget, 'notes', 'a.md'), 'tampered', 'utf8');
        const corrupt = await json<ErrorBody>(started.base, '/api/backup/validate', {
          method: 'POST',
          body: { dir: corruptTarget },
        });
        expect(corrupt.status).toBe(422);
        expect(corrupt.body.error.code).toBe('CORRUPT_BACKUP');
        expect(Array.isArray(corrupt.body.error.issues)).toBe(true);
        expect((corrupt.body.error.issues ?? []).length).toBeGreaterThan(0);

        const unsupportedRaw = JSON.parse(
          await readFile(join(unsupportedTarget, MANIFEST_FILE), 'utf8'),
        ) as { version: number };
        unsupportedRaw.version = 2;
        await writeFile(
          join(unsupportedTarget, MANIFEST_FILE),
          JSON.stringify(unsupportedRaw),
          'utf8',
        );
        const unsupported = await json<ErrorBody>(started.base, '/api/backup/validate', {
          method: 'POST',
          body: { dir: unsupportedTarget },
        });
        expect(unsupported.status).toBe(422);
        expect(unsupported.body.error.code).toBe('UNSUPPORTED_VERSION');

        const absent = await json<ErrorBody>(started.base, '/api/backup/validate', {
          method: 'POST',
          body: { dir: join(dir, 'no-such-backup') },
        });
        expect(absent.status).toBe(404);
        expect(absent.body.error.code).toBe('NOT_FOUND');

        const missingField = await json<ErrorBody>(started.base, '/api/backup/validate', {
          method: 'POST',
          body: {},
        });
        expect(missingField.status).toBe(400);
        expect(missingField.body.error.message).toContain('dir');
      } finally {
        await stopApi(started);
      }
    });
  });

  it('previews additions and conflicts without writing', async () => {
    await withTempDir(async (dir) => {
      const source = await seedBackupVault(join(dir, 'source'));
      const backupDir = join(dir, 'backup-preview');
      await createBackup(source, backupDir);

      const vaultPath = join(dir, 'vault');
      const active = await FileSystemVault.open(vaultPath);
      await active.createNote(
        createNote({ id: N2, title: 'Unrelated', path: 'notes/b.md', body: 'B\n', now: NOW }),
      );
      const started = await startApi(vaultPath);
      try {
        const additions = await json<{
          counts: { notes: number; databases: number };
          conflicts: { ids: string[]; paths: string[] };
          manifest: { digest?: string };
        }>(started.base, '/api/restore/preview', { method: 'POST', body: { dir: backupDir } });
        expect(additions.status).toBe(200);
        expect(additions.body.counts).toEqual({ notes: 1, databases: 1 });
        expect(additions.body.conflicts).toEqual({ ids: [], paths: [] });
        expect(additions.body.manifest.digest).toMatch(/^[0-9a-f]{64}$/);

        await active.createNote(
          createNote({ id: N1, title: 'Id clash', path: 'notes/other.md', body: 'X\n', now: NOW }),
        );
        await active.createNote(
          createNote({ id: N3, title: 'Path clash', path: 'notes/a.md', body: 'Y\n', now: NOW }),
        );

        const vaultBefore = JSON.stringify(await active.snapshot());
        const manifestBefore = await readFile(join(backupDir, MANIFEST_FILE), 'utf8');

        const conflicts = await json<{
          counts: { notes: number; databases: number };
          conflicts: { ids: string[]; paths: string[] };
        }>(started.base, '/api/restore/preview', { method: 'POST', body: { dir: backupDir } });
        expect(conflicts.status).toBe(200);
        expect(conflicts.body.conflicts.ids).toEqual([N1]);
        expect(conflicts.body.conflicts.paths).toEqual(['notes/a.md']);

        expect(JSON.stringify(await active.snapshot())).toBe(vaultBefore);
        expect(await readFile(join(backupDir, MANIFEST_FILE), 'utf8')).toBe(manifestBefore);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('restores into the active vault with merge semantics', async () => {
    await withTempDir(async (dir) => {
      const source = await seedBackupVault(join(dir, 'source'));
      const backupDir = join(dir, 'backup-restore');
      await createBackup(source, backupDir);

      const vaultPath = join(dir, 'vault');
      const started = await startApi(vaultPath);
      try {
        const restored = await json<{ notes: number; databases: number }>(
          started.base,
          '/api/restore',
          { method: 'POST', body: { dir: backupDir } },
        );
        expect(restored.status).toBe(200);
        expect(restored.body).toEqual({ notes: 1, databases: 1 });

        const notes = await json<{ notes: Array<{ id: string }> }>(started.base, '/api/notes');
        expect(notes.body.notes.map((note) => note.id)).toEqual([N1]);
        const databases = await json<{ databases: Array<{ id: string }> }>(
          started.base,
          '/api/databases',
        );
        expect(databases.body.databases.map((database) => database.id)).toEqual([DB1]);

        const noteBefore = await readFile(join(vaultPath, 'notes', 'a.md'), 'utf8');
        const manifestBefore = await readFile(join(backupDir, MANIFEST_FILE), 'utf8');
        const conflict = await json<ErrorBody>(started.base, '/api/restore', {
          method: 'POST',
          body: { dir: backupDir },
        });
        expect(conflict.status).toBe(409);
        expect(conflict.body.error.code).toBe('CONFLICT');
        expect(await readFile(join(vaultPath, 'notes', 'a.md'), 'utf8')).toBe(noteBefore);
        expect(await readFile(join(backupDir, MANIFEST_FILE), 'utf8')).toBe(manifestBefore);

        const overwritten = await json<{ notes: number; databases: number }>(
          started.base,
          '/api/restore',
          { method: 'POST', body: { dir: backupDir, overwrite: true } },
        );
        expect(overwritten.status).toBe(200);
        expect(overwritten.body).toEqual({ notes: 1, databases: 1 });
      } finally {
        await stopApi(started);
      }
    });
  });

  it('rejects invalid restore requests without writing anywhere', async () => {
    await withTempDir(async (dir) => {
      const source = await seedBackupVault(join(dir, 'source'));
      const backupDir = join(dir, 'backup-guard');
      await createBackup(source, backupDir);

      const vaultPath = join(dir, 'vault');
      const active = await FileSystemVault.open(vaultPath);
      await active.createNote(
        createNote({ id: N2, title: 'Marker', path: 'notes/b.md', body: 'Marker\n', now: NOW }),
      );
      const started = await startApi(vaultPath);
      const outside = await mkdtemp(join(tmpdir(), 'nodus-restore-outside-'));
      const fakeDestination = join(dir, 'fake-destination');
      try {
        const manifestBefore = await readFile(join(backupDir, MANIFEST_FILE), 'utf8');
        const vaultBefore = JSON.stringify(await active.snapshot());

        const missingField = await json<ErrorBody>(started.base, '/api/restore', {
          method: 'POST',
          body: {},
        });
        expect(missingField.status).toBe(400);
        expect(missingField.body.error.message).toContain('dir');

        const badOverwrite = await json<ErrorBody>(started.base, '/api/restore', {
          method: 'POST',
          body: { dir: backupDir, overwrite: 'yes' },
        });
        expect(badOverwrite.status).toBe(400);
        expect(badOverwrite.body.error.message).toContain('overwrite must be a boolean');

        const destination = await json<ErrorBody>(started.base, '/api/restore', {
          method: 'POST',
          body: { dir: backupDir, destination: fakeDestination },
        });
        expect(destination.status).toBe(400);
        expect(destination.body.error.message).toContain('destination is not accepted');
        expect(await pathExists(fakeDestination)).toBe(false);

        const relative = await json<ErrorBody>(started.base, '/api/restore', {
          method: 'POST',
          body: { dir: 'backup-relative' },
        });
        expect(relative.status).toBe(400);
        expect(relative.body.error.message).toContain('absolute');

        const insideVault = await json<ErrorBody>(started.base, '/api/restore', {
          method: 'POST',
          body: { dir: join(vaultPath, 'backup-copy') },
        });
        expect(insideVault.status).toBe(400);
        expect(insideVault.body.error.message).toContain('outside the vault');

        const unlisted = await json<ErrorBody>(started.base, '/api/restore', {
          method: 'POST',
          body: { dir: join(outside, 'backup') },
        });
        expect(unlisted.status).toBe(403);
        expect(unlisted.body.error.code).toBe('BACKUP_TARGET_NOT_ALLOWED');

        const absent = await json<ErrorBody>(started.base, '/api/restore', {
          method: 'POST',
          body: { dir: join(dir, 'no-such-backup') },
        });
        expect(absent.status).toBe(404);
        expect(absent.body.error.code).toBe('NOT_FOUND');

        expect(JSON.stringify(await active.snapshot())).toBe(vaultBefore);
        expect(await readFile(join(backupDir, MANIFEST_FILE), 'utf8')).toBe(manifestBefore);
      } finally {
        await stopApi(started);
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('returns PARTIAL_WRITE with completed and failed paths', async () => {
    await withTempDir(async (dir) => {
      const source = await seedBackupVault(join(dir, 'source'));
      const backupDir = join(dir, 'backup-partial');
      await createBackup(source, backupDir);

      const vaultPath = join(dir, 'vault');
      const active = await FileSystemVault.open(vaultPath);
      await active.createNote(
        createNote({ id: N2, title: 'Kept', path: 'notes/b.md', body: 'Kept\n', now: NOW }),
      );
      await writeFile(
        join(vaultPath, 'databases'),
        'stray file blocking the databases directory',
        'utf8',
      );

      const started = await startApi(vaultPath);
      try {
        const failed = await json<ErrorBody>(started.base, '/api/restore', {
          method: 'POST',
          body: { dir: backupDir },
        });
        expect(failed.status).toBe(500);
        expect(failed.body.error.code).toBe('PARTIAL_WRITE');
        expect(failed.body.error.paths).toEqual(['notes/a.md', `databases/${DB1}.json`]);

        expect(await readFile(join(vaultPath, 'notes', 'a.md'), 'utf8')).toContain('Backup body');
        expect(await readFile(join(vaultPath, 'databases'), 'utf8')).toContain('stray file');
      } finally {
        await stopApi(started);
      }
    });
  });
});
