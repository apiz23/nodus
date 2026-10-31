import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NOTE_PROPERTIES_FORMAT } from '../src/database/note-properties.js';
import type { DatabaseDefinition } from '../src/database/schema.js';
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
const DB2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROP1 = '44444444-4444-4444-8444-444444444444';
const PROP2 = '55555555-5555-4555-8555-555555555555';
const OPTION1 = '66666666-6666-4666-8666-666666666666';
const VIEW1 = '77777777-7777-4777-8777-777777777777';
const FILTER1 = '88888888-8888-4888-8888-888888888888';

const propertyDatabase: DatabaseDefinition = {
  id: DB1,
  name: 'Research',
  properties: [
    { id: PROP1, name: 'Status', type: 'text' },
    {
      id: PROP2,
      name: 'Category',
      type: 'select',
      options: [{ id: OPTION1, name: 'Reading' }],
    },
  ],
};

function propertiesNamespace(databases: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    format: NOTE_PROPERTIES_FORMAT,
    version: 1,
    databases,
    ...extra,
  };
}

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
        expect(created.status, JSON.stringify(created.body)).toBe(201);
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

  it('atomically creates conflict-copy content in the requested folder with collision-safe paths', async () => {
    await withTempDir(async (dir) => {
      const started = await startApi(join(dir, 'vault'));
      try {
        const input = { title: 'Research draft copy', folder: '', body: '![map](attachments/map.png)\n\nLocal text', icon: '📌' };
        const first = await json<{ note: UiNote }>(started.base, '/api/notes', { method: 'POST', body: input });
        const second = await json<{ note: UiNote }>(started.base, '/api/notes', { method: 'POST', body: input });
        expect(first.status).toBe(201);
        expect(first.body.note.path).toBe('research-draft-copy.md');
        expect(first.body.note.body).toBe(input.body);
        expect(first.body.note.icon).toBe(input.icon);
        expect(second.body.note.path).toBe('research-draft-copy-2.md');
        const reloaded = await json<{ note: UiNote }>(started.base, `/api/notes/${first.body.note.id}`);
        expect(reloaded.body.note.body).toBe(input.body);
        expect(reloaded.body.note.icon).toBe(input.icon);
      } finally {
        await stopApi(started);
      }
    });
  }, 20_000);

  it('rejects malformed UTF-8 in a valid save request without changing note bytes', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      const original = noteFixture(N1, 'Existing note', 'notes/existing.md', 'Original body 日本語 🙂\n');
      await vault.createNote(original);
      const before = await readFile(join(vaultPath, original.path));
      const beforeHash = createHash('sha256').update(before).digest('hex');
      const started = await startApi(vaultPath);
      try {
        const opened = await json<{ note: UiNote }>(started.base, `/api/notes/${N1}`);
        const malformedBody = Buffer.concat([
          Buffer.from(`{\"title\":\"Existing note\",\"body\":\"Changed `),
          Buffer.from([0xc3, 0x28]),
          Buffer.from(`\",\"baseHash\":\"${opened.body.note.contentHash}\"}`),
        ]);
        const response = await fetch(`${started.base}/api/notes/${N1}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: malformedBody,
        });
        const error = (await response.json()) as { error: { code: string; message: string } };

        expect(response.status).toBe(400);
        expect(error.error).toMatchObject({ code: 'INVALID_JSON' });
        expect(error.error.message).toContain('valid UTF-8');
        const after = await readFile(join(vaultPath, original.path));
        expect(createHash('sha256').update(after).digest('hex')).toBe(beforeHash);
        expect(after).toEqual(before);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('saves and reloads valid multibyte Unicode, non-English text, and emoji', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const started = await startApi(vaultPath);
      try {
        const created = await json<{ note: UiNote }>(started.base, '/api/notes', {
          method: 'POST',
          body: { title: 'Unicode note' },
        });
        const opened = await json<{ note: UiNote }>(started.base, `/api/notes/${created.body.note.id}`);
        const content = 'Café 日本語 مرحبا 🙂\n';
        const saved = await json<{ note: UiNote }>(started.base, `/api/notes/${created.body.note.id}`, {
          method: 'PUT',
          body: { title: 'Unicode note', body: content, baseHash: opened.body.note.contentHash },
        });

        expect(saved.status).toBe(200);
        expect(saved.body.note.body).toBe(content);
        const reloaded = await json<{ note: UiNote }>(started.base, `/api/notes/${created.body.note.id}`);
        expect(reloaded.body.note.body).toBe(content);
        expect(await readFile(join(vaultPath, created.body.note.path), 'utf8')).toContain(content);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('projects structured values and diagnostics through the note properties API', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createDatabase(propertyDatabase);
      const note = noteFixture(N1, 'Research note', 'notes/research.md', 'Body\n');
      note.extraFrontmatter.nodus_data = propertiesNamespace({
        [DB1]: {
          [PROP1]: 'In progress',
          [PROP2]: '77777777-7777-4777-8777-777777777777',
          '88888888-8888-4888-8888-888888888888': { retained: true },
        },
        ['99999999-9999-4999-8999-999999999999']: { [PROP1]: 'Orphaned' },
      });
      await vault.createNote(note);

      const started = await startApi(vaultPath);
      try {
        const result = await json<{
          noteId: string;
          path: string;
          contentHash: string;
          rows: Array<{ databaseId: string; values: Record<string, unknown> }>;
          issues: Array<{ code: string }>;
        }>(started.base, `/api/notes/${N1}/properties`);
        expect(result.status).toBe(200);
        expect(result.body.noteId).toBe(N1);
        expect(result.body.path).toBe(note.path);
        expect(result.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(result.body.rows).toEqual([
          { noteId: N1, path: note.path, databaseId: DB1, values: { [PROP1]: 'In progress' } },
        ]);
        expect(result.body.issues.map(({ code }) => code)).toEqual([
          'MISSING_OPTION',
          'MISSING_PROPERTY',
          'MISSING_DATABASE',
        ]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('discovers database members from one projection route and exposes opaque diagnostics', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createDatabase(propertyDatabase);
      await vault.createDatabase({ ...propertyDatabase, id: DB2, name: 'Empty database' });
      const member = noteFixture(N1, 'Member note', 'notes/member.md', 'Member body\n');
      member.extraFrontmatter.nodus_data = propertiesNamespace({ [DB1]: { [PROP1]: 'Ready' } });
      await vault.createNote(member);
      await vault.createNote(noteFixture(N2, 'Plain note', 'notes/plain.md', 'No membership\n'));
      const future = noteFixture('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Future note', 'notes/future.md', 'Opaque body\n');
      future.extraFrontmatter.nodus_data = {
        format: NOTE_PROPERTIES_FORMAT,
        version: 2,
        databases: { [DB1]: { [PROP1]: 'future' } },
      };
      await vault.createNote(future);

      const started = await startApi(vaultPath);
      try {
        const result = await json<{
          databaseId: string;
          schemaHash: string;
          rows: Array<{ noteId: string; title: string; contentHash: string; values: Record<string, unknown>; issues: unknown[] }>;
          diagnostics: Array<{ noteId: string; code: string }>;
        }>(started.base, `/api/databases/${DB1}/rows`);
        expect(result.status).toBe(200);
        expect(result.body.databaseId).toBe(DB1);
        const schemaBytes = await readFile(join(vaultPath, 'databases', `${DB1}.json`));
        expect(result.body.schemaHash).toBe(createHash('sha256').update(schemaBytes).digest('hex'));
        expect(result.body.rows).toHaveLength(1);
        expect(result.body.rows[0]).toMatchObject({
          noteId: N1,
          title: 'Member note',
          values: { [PROP1]: 'Ready' },
          issues: [],
        });
        const raw = await readFile(join(vaultPath, member.path));
        expect(result.body.rows[0]?.contentHash).toBe(createHash('sha256').update(raw).digest('hex'));
        expect(result.body.diagnostics).toEqual([
          expect.objectContaining({ noteId: future.id, code: 'UNSUPPORTED_NAMESPACE_VERSION' }),
        ]);

        const empty = await json<{ rows: unknown[]; diagnostics: unknown[] }>(
          started.base,
          `/api/databases/${DB2}/rows`,
        );
        expect(empty.status).toBe(200);
        expect(empty.body.rows).toEqual([]);

        // The schema selector may have been loaded before this change. The
        // rows route must reject that revision rather than project rows under
        // a schema that the UI did not select.
        const selectedSchemaHash = result.body.schemaHash;
        const currentSchema = await vault.readDatabaseWithHash(DB1);
        await vault.replaceDatabase(
          { ...currentSchema.database, name: 'Renamed while loading rows' },
          { expectedHash: currentSchema.hash },
        );
        const staleSchema = await json<{ error: { code: string; currentHash: string } }>(
          started.base,
          `/api/databases/${DB1}/rows?schemaHash=${selectedSchemaHash}`,
        );
        expect(staleSchema.status).toBe(409);
        expect(staleSchema.body.error.code).toBe('SCHEMA_CHANGED');
        expect(staleSchema.body.error.currentHash).not.toBe(selectedSchemaHash);
        const refreshed = await json<{ schemaHash: string; rows: unknown[] }>(
          started.base,
          `/api/databases/${DB1}/rows?schemaHash=${staleSchema.body.error.currentHash}`,
        );
        expect(refreshed.status).toBe(200);
        expect(refreshed.body.schemaHash).toBe(staleSchema.body.error.currentHash);
        expect(refreshed.body.rows).toHaveLength(1);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('keeps ordinary note saves from creating or changing structured metadata', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createDatabase(propertyDatabase);
      const withData = noteFixture(N1, 'Research note', 'notes/research.md', 'Original\n');
      withData.extraFrontmatter.nodus_data = propertiesNamespace({
        [DB1]: { [PROP1]: 'Existing' },
      }, { futureExtension: { retained: [1, 'x'] } });
      await vault.createNote(withData);
      const plainPath = 'notes/plain.md';
      await mkdir(join(vaultPath, 'notes'), { recursive: true });
      await writeFile(join(vaultPath, plainPath), '# Plain markdown\n\nBody\n', 'utf8');
      const plain = await vault.readNoteAtPath(plainPath);

      const started = await startApi(vaultPath);
      try {
        const opened = await json<{ note: UiNote }>(started.base, `/api/notes/${N1}`);
        const saved = await json<{ note: UiNote }>(started.base, `/api/notes/${N1}`, {
          method: 'PUT',
          body: {
            title: 'Renamed research note',
            body: 'Edited body\n',
            baseHash: opened.body.note.contentHash,
            icon: '📚',
          },
        });
        expect(saved.status).toBe(200);
        expect((await vault.readNote(N1)).extraFrontmatter).toEqual({
          ...withData.extraFrontmatter,
          icon: '📚',
        });

        const plainOpened = await json<{ note: UiNote }>(started.base, `/api/notes/${plain.id}`);
        const plainSaved = await json<{ note: UiNote }>(started.base, `/api/notes/${plain.id}`, {
          method: 'PUT',
          body: {
            title: plain.title,
            body: 'Plain body edited\n',
            baseHash: plainOpened.body.note.contentHash,
          },
        });
        expect(plainSaved.status).toBe(200);
        expect(await readFile(join(vaultPath, plainPath), 'utf8')).toBe('Plain body edited\n');
        expect((await vault.readNote(plain.id)).extraFrontmatter).toEqual({});
      } finally {
        await stopApi(started);
      }
    });
  });

  it('updates exactly one property through an explicit conditional API operation', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createDatabase(propertyDatabase);
      const original = noteFixture(N1, 'Research note', 'notes/research.md', 'Keep body\r\n');
      original.extraFrontmatter.nodus_data = propertiesNamespace({
        [DB1]: { [PROP1]: 'Old', [PROP2]: OPTION1 },
      });
      original.extraFrontmatter.custom = { preserve: true };
      await vault.createNote(original);
      const started = await startApi(vaultPath);
      try {
        const opened = await json<{ note: UiNote }>(started.base, `/api/notes/${N1}`);
        const changed = await json<{
          contentHash: string;
          rows: Array<{ values: Record<string, unknown> }>;
          issues: unknown[];
        }>(started.base, `/api/notes/${N1}/properties`, {
          method: 'PUT',
          body: {
            databaseId: DB1,
            propertyId: PROP1,
            value: 'New',
            baseHash: opened.body.note.contentHash,
          },
        });
        expect(changed.status).toBe(200);
        expect(changed.body.rows[0]?.values).toEqual({ [PROP1]: 'New', [PROP2]: OPTION1 });
        expect(changed.body.issues).toEqual([]);
        const stored = await vault.readNote(N1);
        expect(stored.body).toBe('Keep body\r\n');
        expect(stored.extraFrontmatter.custom).toEqual({ preserve: true });
        expect(stored.extraFrontmatter.nodus_data).toEqual(
          propertiesNamespace({ [DB1]: { [PROP1]: 'New', [PROP2]: OPTION1 } }),
        );
        const invalidType = await json<{
          error: { code: string; structuredDataIssues?: Array<{ code: string }> };
        }>(started.base, `/api/notes/${N1}/properties`, {
          method: 'PUT',
          body: {
            databaseId: DB1,
            propertyId: PROP1,
            value: 42,
            baseHash: changed.body.contentHash,
          },
        });
        expect(invalidType.status).toBe(422);
        expect(invalidType.body.error.code).toBe('STRUCTURED_DATA_INVALID');
        expect(invalidType.body.error.structuredDataIssues).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: 'TYPE_MISMATCH' })]),
        );
        expect(await vault.readNote(N1)).toEqual(stored);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('requires explicit confirmation before structured metadata is added to a plain note', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createDatabase(propertyDatabase);
      const path = 'daily/plain.md';
      await mkdir(join(vaultPath, 'daily'), { recursive: true });
      const source = '# Plain note\r\n\r\nBody stays.\r\n';
      await writeFile(join(vaultPath, path), source, 'utf8');
      const plain = await vault.readNoteAtPath(path);
      const started = await startApi(vaultPath);
      try {
        const opened = await json<{ note: UiNote }>(started.base, `/api/notes/${plain.id}`);
        const before = await readFile(join(vaultPath, path));
        const unconfirmed = await json<{ error: { code: string } }>(
          started.base,
          `/api/notes/${plain.id}/properties`,
          {
            method: 'PUT',
            body: {
              databaseId: DB1,
              propertyId: PROP1,
              value: 'Added',
              baseHash: opened.body.note.contentHash,
            },
          },
        );
        expect(unconfirmed.status).toBe(409);
        expect(unconfirmed.body.error.code).toBe('CONFIRMATION_REQUIRED');
        expect(await readFile(join(vaultPath, path))).toEqual(before);

        const confirmed = await json<{ contentHash: string }>(
          started.base,
          `/api/notes/${plain.id}/properties`,
          {
            method: 'PUT',
            body: {
              databaseId: DB1,
              propertyId: PROP1,
              value: 'Added',
              baseHash: opened.body.note.contentHash,
              confirmCreate: true,
            },
          },
        );
        expect(confirmed.status).toBe(200);
        const stored = parseNote(await readFile(join(vaultPath, path), 'utf8'), path);
        expect(stored.id).toBe(plain.id);
        expect(stored.body).toBe(source);
        expect(stored.extraFrontmatter.nodus_data).toEqual(
          propertiesNamespace({ [DB1]: { [PROP1]: 'Added' } }),
        );
      } finally {
        await stopApi(started);
      }
    });
  });

  it('rejects invalid, orphaned, or unsupported structured data without changing note bytes', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createDatabase(propertyDatabase);
      const invalid = noteFixture(N1, 'Invalid structured note', 'notes/invalid.md', 'Body\n');
      invalid.extraFrontmatter.nodus_data = propertiesNamespace({
        [DB1]: { [PROP2]: '77777777-7777-4777-8777-777777777777' },
      });
      await vault.createNote(invalid);
      const future = noteFixture(N2, 'Future structured note', 'notes/future.md', 'Future body\n');
      const futureNamespace = {
        format: NOTE_PROPERTIES_FORMAT,
        version: 2,
        databases: { [DB1]: { [PROP1]: { future: 'keep' } } },
        futureEnvelope: { keep: true },
      };
      future.extraFrontmatter.nodus_data = futureNamespace;
      await vault.createNote(future);
      const rawPath = join(vaultPath, invalid.path);
      const started = await startApi(vaultPath);
      try {
        const opened = await json<{ note: UiNote }>(started.base, `/api/notes/${N1}`);
        const before = await readFile(rawPath);
        const badOption = await json<{ error: { code: string; structuredDataIssues?: Array<{ code: string }> } }>(
          started.base,
          `/api/notes/${N1}/properties`,
          {
            method: 'PUT',
            body: {
              databaseId: DB1,
              propertyId: PROP1,
              value: 'New',
              baseHash: opened.body.note.contentHash,
            },
          },
        );
        expect(badOption.status).toBe(422);
        expect(badOption.body.error.structuredDataIssues).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: 'MISSING_OPTION' })]),
        );
        expect(await readFile(rawPath)).toEqual(before);

        const invalidType = await json<{ error: { code: string; structuredDataIssues?: Array<{ code: string }> } }>(
          started.base,
          `/api/notes/${N1}/properties`,
          {
            method: 'PUT',
            body: {
              databaseId: DB1,
              propertyId: PROP1,
              value: 9,
              baseHash: opened.body.note.contentHash,
            },
          },
        );
        expect(invalidType.status).toBe(422);
        expect(invalidType.body.error.structuredDataIssues).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: 'MISSING_OPTION' })]),
        );
        expect(await readFile(rawPath)).toEqual(before);

        const stale = await json<{ error: { code: string; currentHash?: string } }>(
          started.base,
          `/api/notes/${N1}/properties`,
          {
            method: 'PUT',
            body: {
              databaseId: DB1,
              propertyId: PROP1,
              value: 'New',
              baseHash: '0'.repeat(64),
            },
          },
        );
        expect(stale.status).toBe(409);
        expect(stale.body.error.code).toBe('STALE_WRITE');
        expect(stale.body.error.currentHash).toBe(opened.body.note.contentHash);
        expect(await readFile(rawPath)).toEqual(before);

        const futureOpened = await json<{ note: UiNote }>(started.base, `/api/notes/${N2}`);
        const futureRawPath = join(vaultPath, future.path);
        const futureBefore = await readFile(futureRawPath);
        const futureRead = await json<{ issues: Array<{ code: string }>; rows: unknown[] }>(
          started.base,
          `/api/notes/${N2}/properties`,
        );
        expect(futureRead.body.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: 'UNSUPPORTED_NAMESPACE_VERSION' })]),
        );
        expect(futureRead.body.rows).toEqual([]);
        const futureWrite = await json<{ error: { structuredDataIssues?: Array<{ code: string }> } }>(
          started.base,
          `/api/notes/${N2}/properties`,
          {
            method: 'PUT',
            body: {
              databaseId: DB1,
              propertyId: PROP1,
              value: 'Must not replace future data',
              baseHash: futureOpened.body.note.contentHash,
            },
          },
        );
        expect(futureWrite.status).toBe(422);
        expect(futureWrite.body.error.structuredDataIssues).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: 'UNSUPPORTED_NAMESPACE_VERSION' })]),
        );
        expect(await readFile(futureRawPath)).toEqual(futureBefore);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('does not overwrite a note changed after API preflight', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createDatabase(propertyDatabase);
      const original = noteFixture(N1, 'Research note', 'notes/research.md', 'Original\n');
      original.extraFrontmatter.nodus_data = propertiesNamespace({ [DB1]: { [PROP1]: 'Old' } });
      await vault.createNote(original);
      const otherWriter = await FileSystemVault.open(vaultPath);
      const setProperty = FileSystemVault.prototype.setNoteProperty;
      let injected = false;
      const race = vi.spyOn(FileSystemVault.prototype, 'setNoteProperty').mockImplementation(async function (this: FileSystemVault, ...args) {
        if (!injected) {
          injected = true;
          const latest = await otherWriter.readNoteWithHash(N1);
          await otherWriter.replaceNote(
            { ...latest.note, body: 'Concurrent external content\n' },
            { expectedHash: latest.hash },
          );
        }
        return setProperty.apply(this, args);
      });
      const started = await startApi(vaultPath);
      try {
        const opened = await json<{ note: UiNote }>(started.base, `/api/notes/${N1}`);
        const changed = await json<{ error: { code: string; currentHash?: string } }>(
          started.base,
          `/api/notes/${N1}/properties`,
          {
            method: 'PUT',
            body: {
              databaseId: DB1,
              propertyId: PROP1,
              value: 'API write must lose safely',
              baseHash: opened.body.note.contentHash,
            },
          },
        );
        expect(changed.status).toBe(409);
        expect(changed.body.error.code).toBe('STALE_WRITE');
        expect(changed.body.error.currentHash).not.toBe(opened.body.note.contentHash);
        expect((await otherWriter.readNote(N1)).body).toBe('Concurrent external content\n');
      } finally {
        race.mockRestore();
        await stopApi(started);
      }
    });
  });

  it('leaves source bytes unchanged when the conditional structured write fails', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createDatabase(propertyDatabase);
      const original = noteFixture(N1, 'Research note', 'notes/research.md', 'Original\n');
      original.extraFrontmatter.nodus_data = propertiesNamespace({ [DB1]: { [PROP1]: 'Old' } });
      await vault.createNote(original);
      const rawPath = join(vaultPath, original.path);
      const started = await startApi(vaultPath);
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      const write = vi.spyOn(FileSystemVault.prototype, 'setNoteProperty').mockRejectedValue(new Error('injected write failure'));
      try {
        const opened = await json<{ note: UiNote }>(started.base, `/api/notes/${N1}`);
        const before = await readFile(rawPath);
        const failed = await json<{ error: { code: string } }>(
          started.base,
          `/api/notes/${N1}/properties`,
          {
            method: 'PUT',
            body: {
              databaseId: DB1,
              propertyId: PROP1,
              value: 'New',
              baseHash: opened.body.note.contentHash,
            },
          },
        );
        expect(failed.status).toBe(500);
        expect(await readFile(rawPath)).toEqual(before);
      } finally {
        write.mockRestore();
        errorLog.mockRestore();
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

  it('manages folders through the local API and protects populated deletion with a fresh inventory', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const started = await startApi(vaultPath);
      try {
        const createFolder = await json<{ path: string }>(started.base, '/api/folders', {
          method: 'POST', body: { path: 'Work' },
        });
        expect(createFolder.status).toBe(201);
        await json(started.base, '/api/folders', { method: 'POST', body: { path: 'Archive' } });
        const created = await json<{ note: UiNote }>(started.base, '/api/notes', {
          method: 'POST', body: { title: 'API folder note', folder: 'Work' },
        });
        expect(created.body.note.path).toBe('Work/api-folder-note.md');

        const moved = await json<{ path: string }>(started.base, '/api/folders/move', {
          method: 'POST', body: { fromPath: 'Work', toPath: 'Archive/Work' },
        });
        expect(moved.status).toBe(200);
        const note = await json<{ note: UiNote }>(started.base, `/api/notes/${created.body.note.id}`);
        expect(note.body.note.path).toBe('Archive/Work/api-folder-note.md');
        expect(note.body.note.id).toBe(created.body.note.id);
        const folders = await json<{ folders: string[] }>(started.base, '/api/folders');
        expect(folders.body.folders).toContain('Archive/Work');
        expect(folders.body.folders).not.toContain('Work');

        const impact = await json<{ impact: { token: string; notes: number } }>(started.base, '/api/folders/impact?path=Archive%2FWork');
        expect(impact.body.impact.notes).toBe(1);
        await writeFile(join(vaultPath, 'Archive/Work/late.txt'), 'external change');
        const stale = await json<{ error: { code: string } }>(started.base, '/api/folders', {
          method: 'DELETE', body: { path: 'Archive/Work', token: impact.body.impact.token },
        });
        expect(stale.status).toBe(409);
        expect(stale.body.error.code).toBe('STALE_WRITE');

        const refreshed = await json<{ impact: { token: string } }>(started.base, '/api/folders/impact?path=Archive%2FWork');
        const deleted = await json<{ deleted: true; noteIds: string[] }>(started.base, '/api/folders', {
          method: 'DELETE', body: { path: 'Archive/Work', token: refreshed.body.impact.token },
        });
        expect(deleted.body.deleted).toBe(true);
        expect(deleted.body.noteIds).toContain(created.body.note.id);
        const search = await json<{ results: unknown[] }>(started.base, '/api/search?q=API%20folder%20note');
        expect(search.body.results).toEqual([]);
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
        expect(writeAttempt.status).toBe(400);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('creates, lists, conditionally updates, and diagnoses saved views through the API', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createDatabase(propertyDatabase);
      const started = await startApi(vaultPath);
      try {
        const view = {
          id: VIEW1, databaseId: DB1, name: 'Reading',
          sort: { propertyId: 'title', direction: 'asc' },
          filters: [{ id: FILTER1, propertyId: PROP2, operator: 'is', value: OPTION1 }],
          visiblePropertyIds: [PROP2],
        };
        const created = await json<{ view: { view: typeof view; contentHash: string; diagnostics: unknown[] } }>(
          started.base, `/api/databases/${DB1}/views`, { method: 'POST', body: { view } },
        );
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        expect(created.body.view.view).toEqual(view);
        expect(created.body.view.contentHash).toMatch(/^[0-9a-f]{64}$/);

        const listed = await json<{ views: Array<{ view: typeof view; contentHash: string }> }>(started.base, `/api/databases/${DB1}/views`);
        expect(listed.body.views).toHaveLength(1);
        const updated = { ...view, name: 'Updated' };
        const saved = await json<{ view: { view: typeof view; contentHash: string } }>(started.base, `/api/databases/${DB1}/views/${VIEW1}`, {
          method: 'PUT', body: { view: updated, baseHash: listed.body.views[0]!.contentHash },
        });
        expect(saved.status).toBe(200);
        expect(saved.body.view.view.name).toBe('Updated');
        const stale = await json<{ error: { code: string } }>(started.base, `/api/databases/${DB1}/views/${VIEW1}`, {
          method: 'PUT', body: { view, baseHash: listed.body.views[0]!.contentHash },
        });
        expect(stale.status).toBe(409);
        expect(stale.body.error.code).toBe('STALE_WRITE');

        const invalid = await json<{ error: { code: string } }>(started.base, `/api/databases/${DB1}/views`, {
          method: 'POST', body: { view: { ...view, future: true } },
        });
        expect(invalid.status).toBe(400);
        expect(invalid.body.error.code).toBe('INVALID_INPUT');

        const invalidReferences = await json<{ error: { code: string } }>(started.base, `/api/databases/${DB1}/views`, {
          method: 'POST', body: { view: { ...view, filters: [{ ...view.filters[0], value: DB2 }] } },
        });
        expect(invalidReferences.status).toBe(422);
        expect(invalidReferences.body.error.code).toBe('INVALID_VIEW_REFERENCES');

        await vault.deleteDatabase(DB1);
        const orphaned = await json<{ views: Array<{ diagnostics: Array<{ code: string }> }> }>(started.base, `/api/databases/${DB1}/views`);
        expect(orphaned.body.views[0]?.diagnostics).toMatchObject([{ code: 'MISSING_DATABASE' }]);
        const deleted = await json<{ deleted: true }>(started.base, `/api/databases/${DB1}/views/${VIEW1}`, {
          method: 'DELETE', body: { baseHash: saved.body.view.contentHash },
        });
        expect(deleted.status).toBe(200);
        expect(deleted.body.deleted).toBe(true);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('reads and duplicates typed saved views, enforces revisions, and clears one property without removing membership', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      await vault.createDatabase(propertyDatabase);
      await vault.createNote({ ...createNote({ id: N1, title: 'Board card', path: 'notes/card.md', body: 'Markdown body stays.', now: NOW }), extraFrontmatter: {
        custom: { keep: true }, nodus_data: propertiesNamespace({ [DB1]: { [PROP1]: 'Preserved', [PROP2]: OPTION1 } }),
      } });
      const started = await startApi(vault.root);
      try {
        const board = { id: VIEW1, databaseId: DB1, name: 'Board', type: 'kanban', settings: { groupPropertyId: PROP2 }, sort: { propertyId: 'title', direction: 'asc' }, filters: [], visiblePropertyIds: [PROP1] };
        const created = await json<any>(started.base, `/api/databases/${DB1}/views`, { method: 'POST', body: { view: board } });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        const read = await json<any>(started.base, `/api/databases/${DB1}/views/${VIEW1}`);
        expect(read.body.view.view).toEqual(board);
        const duplicate = await json<any>(started.base, `/api/databases/${DB1}/views/${VIEW1}/duplicate`, { method: 'POST', body: { id: FILTER1, name: 'Board copy', baseHash: read.body.view.contentHash } });
        expect(duplicate.status).toBe(201);
        expect(duplicate.body.view.view).toEqual({ ...board, id: FILTER1, name: 'Board copy' });
        const updated = await json<any>(started.base, `/api/databases/${DB1}/views/${VIEW1}`, { method: 'PUT', body: { view: { ...board, name: 'Updated board' }, baseHash: read.body.view.contentHash } });
        expect(updated.status).toBe(200);
        const rejected = await json<any>(started.base, `/api/databases/${DB1}/views/${VIEW1}/duplicate`, { method: 'POST', body: { id: 'fcd84688-c6dc-4535-a238-ab3dab2ccdc4', name: 'Stale copy', baseHash: read.body.view.contentHash } });
        expect(rejected.status).toBe(409);
        const staleDelete = await json<any>(started.base, `/api/databases/${DB1}/views/${VIEW1}`, { method: 'DELETE', body: { baseHash: read.body.view.contentHash } });
        expect(staleDelete.status).toBe(409);
        const beforeInvalid = await readFile(join(vault.root, updated.body.view.path));
        const invalid = await json<any>(started.base, `/api/databases/${DB1}/views/${VIEW1}`, { method: 'PUT', body: { view: { ...board, settings: { groupPropertyId: PROP2, unknown: true } }, baseHash: updated.body.view.contentHash } });
        expect(invalid.status).toBe(400);
        expect(await readFile(join(vault.root, updated.body.view.path))).toEqual(beforeInvalid);
        const note = await vault.readNoteWithHash(N1);
        const cleared = await json<any>(started.base, `/api/notes/${N1}/properties`, { method: 'PUT', body: { databaseId: DB1, propertyId: PROP2, baseHash: note.hash, remove: true } });
        expect(cleared.status).toBe(200);
        expect(cleared.body.rows).toMatchObject([{ databaseId: DB1, values: { [PROP1]: 'Preserved' } }]);
        expect(cleared.body.rows[0].values).not.toHaveProperty(PROP2);
        const stored = await vault.readNoteWithHash(N1);
        expect(stored.note.extraFrontmatter.custom).toEqual({ keep: true });
        expect(stored.note.body).toBe('Markdown body stays.');
        const bytes = await readFile(join(vault.root, stored.note.path));
        const stale = await json<any>(started.base, `/api/notes/${N1}/properties`, { method: 'PUT', body: { databaseId: DB1, propertyId: PROP2, baseHash: note.hash, remove: true } });
        expect(stale.status).toBe(409);
        const both = await json<any>(started.base, `/api/notes/${N1}/properties`, { method: 'PUT', body: { databaseId: DB1, propertyId: PROP2, baseHash: stored.hash, remove: true, value: OPTION1 } });
        expect(both.status).toBe(400);
        expect(await readFile(join(vault.root, stored.note.path))).toEqual(bytes);
      } finally { await stopApi(started); }
    });
  });

  it('creates and conditionally updates schemas without touching note property values', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      const note = noteFixture(N1, 'A note', 'notes/a.md', 'Original body\n');
      note.extraFrontmatter.nodus_data = propertiesNamespace({
        [DB1]: { [PROP1]: 'Existing value', [PROP2]: OPTION1 },
      }, { futureField: { nested: ['keep', 1] } });
      await vault.createNote(note);
      const notePath = join(vaultPath, note.path);
      const beforeNote = await readFile(notePath);
      const started = await startApi(vaultPath);

      try {
        const created = await json<{ database: UiDatabase; error?: { code: string } }>(
          started.base,
          '/api/databases',
          { method: 'POST', body: { database: propertyDatabase } },
        );
        expect(created.status).toBe(201);
        expect(created.body.database).toMatchObject({ id: DB1, name: 'Research' });
        expect(created.body.database.contentHash).toMatch(/^[0-9a-f]{64}$/);

        const invalid = await json<{ error: { code: string } }>(started.base, '/api/databases', {
          method: 'POST',
          body: { database: { ...propertyDatabase, id: DB2, properties: [
            { id: PROP1, name: 'Same', type: 'text' },
            { id: PROP2, name: 'same', type: 'text' },
          ] } },
        });
        expect(invalid.status).toBe(400);
        expect(invalid.body.error.code).toBe('INVALID_INPUT');

        const optionInvalid = await json<{ error: { code: string } }>(started.base, '/api/databases', {
          method: 'POST',
          body: { database: { ...propertyDatabase, id: DB2, properties: [{
            id: PROP2,
            name: 'Status',
            type: 'select',
            options: [
              { id: OPTION1, name: 'Duplicate' },
              { id: '77777777-7777-4777-8777-777777777777', name: 'Duplicate' },
            ],
          }] } },
        });
        expect(optionInvalid.status).toBe(400);
        expect(optionInvalid.body.error.code).toBe('INVALID_INPUT');

        const renamed = {
          ...propertyDatabase,
          name: 'Research notes',
          properties: propertyDatabase.properties.map((property) => property.id === PROP1
            ? { ...property, name: 'Progress' }
            : { ...property, options: property.options?.map((option) => ({ ...option, name: 'To read' })) }),
        };
        const updated = await json<{ database: UiDatabase }>(
          started.base,
          `/api/databases/${DB1}`,
          { method: 'PUT', body: { database: renamed, baseHash: created.body.database.contentHash } },
        );
        expect(updated.status).toBe(200);
        expect(updated.body.database.name).toBe('Research notes');
        expect(updated.body.database.properties.map((property) => property.id)).toEqual([PROP1, PROP2]);
        expect(updated.body.database.properties[1]?.options?.[0]?.id).toBe(OPTION1);
        expect(await readFile(notePath)).toEqual(beforeNote);

        await writeFile(join(vaultPath, `databases/${DB1}.json`), '{"format":"nodus-database","version":1,"id":"33333333-3333-4333-8333-333333333333","name":"unsupported","properties":[],"future":{"preserve":true}}\n');
        const malformedRaw = await readFile(join(vaultPath, `databases/${DB1}.json`));
        const rejectedMalformed = await json<{ error: { code: string } }>(
          started.base,
          `/api/databases/${DB1}`,
          { method: 'PUT', body: { database: renamed, baseHash: createHash('sha256').update(malformedRaw).digest('hex') } },
        );
        expect(rejectedMalformed.status).toBe(422);
        expect(await readFile(join(vaultPath, `databases/${DB1}.json`))).toEqual(malformedRaw);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('rejects unknown schema fields and unsupported versions before create or update writes', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createDatabase(propertyDatabase);
      const started = await startApi(vaultPath);
      const schemaPath = join(vaultPath, `databases/${DB1}.json`);
      const before = await readFile(schemaPath);
      const invalidSchemas: Array<{ label: string; schema: Record<string, unknown> }> = [
        { label: 'top-level key', schema: { ...propertyDatabase, unknownTopLevel: { preserve: true } } },
        {
          label: 'property key',
          schema: {
            ...propertyDatabase,
            properties: [{ ...propertyDatabase.properties[0], unknownProperty: true }, propertyDatabase.properties[1]],
          },
        },
        {
          label: 'option key',
          schema: {
            ...propertyDatabase,
            properties: [propertyDatabase.properties[0], {
              ...propertyDatabase.properties[1],
              options: [{ ...propertyDatabase.properties[1]?.options?.[0], unknownOption: 'keep' }],
            }],
          },
        },
        { label: 'unsupported version', schema: { ...propertyDatabase, version: 3 } },
      ];
      try {
        for (const [index, item] of invalidSchemas.entries()) {
          const createSchema = { ...item.schema, id: DB2 };
          const created = await json<{ error: { code: string } }>(started.base, '/api/databases', {
            method: 'POST', body: { database: createSchema },
          });
          expect(created.status, `create rejects ${item.label}`).toBe(400);
          expect(created.body.error.code).toBe('INVALID_INPUT');
          await expect(readFile(join(vaultPath, `databases/${DB2}.json`))).rejects.toMatchObject({ code: 'ENOENT' });

          const updateSchema = { ...item.schema, id: DB1, name: `Rejected update ${index}` };
          const updated = await json<{ error: { code: string } }>(started.base, `/api/databases/${DB1}`, {
            method: 'PUT',
            body: { database: updateSchema, baseHash: createHash('sha256').update(before).digest('hex') },
          });
          expect(updated.status, `update rejects ${item.label}`).toBe(400);
          expect(updated.body.error.code).toBe('INVALID_INPUT');
          expect(await readFile(schemaPath)).toEqual(before);
        }
      } finally {
        await stopApi(started);
      }
    });
  });

  it('serializes concurrent schema updates with the same base hash and stores exactly the winner', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createDatabase(propertyDatabase);
      const started = await startApi(vaultPath);
      const schemaPath = join(vaultPath, `databases/${DB1}.json`);
      try {
        const initial = await json<{ databases: UiDatabase[] }>(started.base, '/api/databases');
        const baseHash = initial.body.databases[0]?.contentHash;
        expect(baseHash).toBeDefined();

        const candidates = ['Concurrent edit A', 'Concurrent edit B'].map((name) => ({
          ...propertyDatabase,
          name,
        }));
        const results = await Promise.all(candidates.map((database) => json<{
          database?: UiDatabase;
          error?: { code: string };
        }>(started.base, `/api/databases/${DB1}`, {
          method: 'PUT',
          body: { database, baseHash },
        })));

        expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
        const winner = results.find((result) => result.status === 200)?.body.database;
        const loser = results.find((result) => result.status === 409)?.body.error;
        expect(winner).toBeDefined();
        expect(loser?.code).toBe('STALE_WRITE');
        const stored = await readFile(schemaPath);
        expect(createHash('sha256').update(stored).digest('hex')).toBe(winner?.contentHash);
        expect(JSON.parse(stored.toString('utf8')).name).toBe(winner?.name);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('rejects stale database schema replacement without overwriting newer bytes', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createDatabase(propertyDatabase);
      const started = await startApi(vaultPath);
      try {
        const listed = await json<{ databases: UiDatabase[] }>(started.base, '/api/databases');
        const staleHash = listed.body.databases[0]?.contentHash;
        expect(staleHash).toBeDefined();
        const external = { ...propertyDatabase, name: 'External edit' };
        const externalText = JSON.stringify({ format: 'nodus-database', version: 1, ...external }, null, 2) + '\n';
        await writeFile(join(vaultPath, `databases/${DB1}.json`), externalText, 'utf8');
        const response = await json<{ error: { code: string } }>(started.base, `/api/databases/${DB1}`, {
          method: 'PUT',
          body: { database: { ...propertyDatabase, name: 'My stale edit' }, baseHash: staleHash },
        });
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('STALE_WRITE');
        expect(await readFile(join(vaultPath, `databases/${DB1}.json`), 'utf8')).toBe(externalText);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('does not replace an existing schema containing unknown fields', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      const started = await startApi(vaultPath);
      const schemaPath = join(vaultPath, `databases/${DB1}.json`);
      try {
        await mkdir(join(vaultPath, 'databases'), { recursive: true });
        const unknown = `{"format":"nodus-database","version":1,"id":"${DB1}","name":"Unknown","properties":[],"future":{"keep":true}}\n`;
        await writeFile(schemaPath, unknown, 'utf8');
        const hash = createHash('sha256').update(unknown).digest('hex');
        const response = await json<{ error: { code: string } }>(started.base, `/api/databases/${DB1}`, {
          method: 'PUT',
          body: { database: { id: DB1, name: 'Replacement', properties: [] }, baseHash: hash },
        });
        expect(response.status).toBe(422);
        expect(await readFile(schemaPath, 'utf8')).toBe(unknown);
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
        expect(created.body).toEqual({ targetDir: target, notes: 1, databases: 1, databaseViews: 0 });
        expect((await stat(join(target, MANIFEST_FILE))).isFile()).toBe(true);

        const validated = await json<{
          manifest: { format: string; files: Array<{ path: string }> };
          counts: { notes: number; databases: number };
        }>(started.base, '/api/backup/validate', { method: 'POST', body: { dir: target } });
        expect(validated.status).toBe(200);
        expect(validated.body.manifest.format).toBe('nodus-backup');
        expect(validated.body.counts).toEqual({ notes: 1, databases: 1, databaseViews: 0 });
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
        unsupportedRaw.version = 5;
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
        expect(additions.body.counts).toEqual({ notes: 1, databases: 1, databaseViews: 0 });
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
        expect(restored.body).toEqual({ notes: 1, databases: 1, databaseViews: 0 });

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
        expect(overwritten.body).toEqual({ notes: 1, databases: 1, databaseViews: 0 });
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
