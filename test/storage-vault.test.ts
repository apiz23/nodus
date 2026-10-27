import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DatabaseDefinition } from '../src/database/schema.js';
import { createNote, type Note } from '../src/domain/note.js';
import { parseNote, serializeNote } from '../src/format/note-format.js';
import { StorageError } from '../src/storage/errors.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { withTempDir } from './tmp.js';
import { storageErrorCode } from './helpers.js';

const NOW = '2026-10-25T09:00:00Z';
const N1 = '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';
const N2 = '0b7c9e1a-2d3f-4a5b-8c6d-7e8f9a0b1c2d';
const N3 = 'a0d3c1f2-8e4b-4f6a-9c2d-7b1e5f3a9d88';
const DB1 = '9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73';
const PROP1 = '1f0c7d2a-0b1e-4c3d-9a8f-5e6d7c8b9a01';

function note(id: string, path: string, extra: Partial<Parameters<typeof createNote>[0]> = {}): Note {
  return createNote({ id, path, title: `Note ${id.slice(0, 4)}`, body: 'Body\n', now: NOW, ...extra });
}

function database(id = DB1, name = 'Reading list'): DatabaseDefinition {
  return {
    id,
    name,
    properties: [{ id: PROP1, name: 'Title', type: 'text' }],
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('FileSystemVault.open', () => {
  it('creates the vault root when it does not exist', async () => {
    await withTempDir(async (dir) => {
      const root = join(dir, 'vault');
      const vault = await FileSystemVault.open(root);
      expect((await stat(vault.root)).isDirectory()).toBe(true);
      expect(await vault.listNotes()).toEqual([]);
    });
  });
});

describe('note storage', () => {
  it('scans mixed plain and Nodus Markdown and saves plain content without adding metadata', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const plain = '# Daily entry\n\nCafé 日本語 🙂\n';
      await mkdir(join(dir, 'daily'), { recursive: true });
      await writeFile(join(dir, 'daily/2026-08-03.md'), plain, 'utf8');
      await vault.createNote(note(N1, 'notes/native.md'));

      const summaries = await vault.listNotes();
      expect(summaries.map(({ path, title }) => [path, title])).toEqual([
        ['daily/2026-08-03.md', '2026-08-03'],
        ['notes/native.md', `Note ${N1.slice(0, 4)}`],
      ]);

      const loaded = await vault.readNoteWithHash(parseNote(plain, 'daily/2026-08-03.md').id);
      await vault.replaceNote({
        ...loaded.note,
        body: `${loaded.note.body}Edited without conversion.\n`,
        updatedAt: '2026-10-25T10:00:00Z',
      }, { expectedHash: loaded.hash });

      expect(await readFile(join(dir, 'daily/2026-08-03.md'), 'utf8')).toBe(
        `${plain}Edited without conversion.\n`,
      );
      expect(await vault.listNotes()).toHaveLength(2);
    });
  });

  it('keeps a plain note ID when explicitly moved by adding Nodus metadata', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await writeFile(join(dir, 'daily.md'), 'Plain body\n', 'utf8');
      const before = await vault.readNoteWithHash(parseNote('Plain body\n', 'daily.md').id);

      const moved = await vault.moveNote(before.note.id, 'archive/daily.md', { expectedHash: before.hash });

      expect(moved.id).toBe(before.note.id);
      expect((await vault.readNoteWithHash(before.note.id)).note.path).toBe('archive/daily.md');
      expect(await readFile(join(dir, 'archive/daily.md'), 'utf8')).toContain(`id: ${before.note.id}`);
    });
  });

  it('writes a note as canonical Markdown at its approved path', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const created = note(N1, 'notes/roadmap.md', { title: 'Roadmap', tags: ['planning'] });

      await vault.createNote(created);

      expect(await readFile(join(vault.root, 'notes/roadmap.md'), 'utf8')).toBe(serializeNote(created));
    });
  });

  it('reads a note by stable ID', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const created = note(N1, 'notes/a.md');
      await vault.createNote(created);

      expect(await vault.readNote(N1)).toEqual(created);
    });
  });

  it('reads a note at an exact path', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note(N1, 'notes/a.md'));

      expect((await vault.readNoteAtPath('notes/a.md')).id).toBe(N1);
    });
  });

  it('lists note summaries sorted by path', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note(N1, 'b/second.md'));
      await vault.createNote(note(N2, 'a/first.md'));

      expect(await vault.listNotes()).toEqual([
        { id: N2, path: 'a/first.md', title: 'Note 0b7c', updatedAt: NOW },
        { id: N1, path: 'b/second.md', title: 'Note 6f1c', updatedAt: NOW },
      ]);
    });
  });

  it('rejects a second note with the same ID and writes nothing', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note(N1, 'a.md'));

      expect(await storageErrorCode(() => vault.createNote(note(N1, 'b.md')))).toBe('DUPLICATE_ID');
      expect(await exists(join(vault.root, 'b.md'))).toBe(false);
    });
  });

  it('rejects a second note at the same path', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note(N1, 'a.md'));

      expect(await storageErrorCode(() => vault.createNote(note(N2, 'a.md')))).toBe('CONFLICT');
    });
  });

  it('replaces a note by ID and keeps its path', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const created = note(N1, 'notes/a.md');
      await vault.createNote(created);

      await vault.replaceNote({ ...created, body: 'New body\n', updatedAt: '2026-10-25T10:00:00Z' });

      const stored = await vault.readNote(N1);
      expect(stored.body).toBe('New body\n');
      expect(stored.path).toBe('notes/a.md');
      expect(await readFile(join(vault.root, 'notes/a.md'), 'utf8')).toContain('New body');
    });
  });

  it('rejects replacing a missing note', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      expect(await storageErrorCode(() => vault.replaceNote(note(N1, 'a.md')))).toBe('NOT_FOUND');
    });
  });

  it('rejects a replace that changes the path', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note(N1, 'a.md'));

      expect(await storageErrorCode(() => vault.replaceNote(note(N1, 'b.md')))).toBe('CONFLICT');
      expect(await vault.readNote(N1)).toMatchObject({ path: 'a.md' });
    });
  });

  it('moves a note and keeps its ID and exact bytes', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const created = note(N1, 'notes/a.md', { body: 'Café 日本語 🙂\r\n```\r\n[[Link]]\r\n```\r\n' });
      await vault.createNote(created);
      const before = await readFile(join(vault.root, 'notes/a.md'), 'utf8');

      const moved = await vault.moveNote(N1, 'archive/moved.md');

      expect(moved.id).toBe(N1);
      expect(moved.path).toBe('archive/moved.md');
      expect(await exists(join(vault.root, 'notes/a.md'))).toBe(false);
      expect(await readFile(join(vault.root, 'archive/moved.md'), 'utf8')).toBe(before);
      expect((await vault.readNote(N1)).path).toBe('archive/moved.md');
    });
  });

  it('rejects a move onto an existing path without touching either file', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note(N1, 'a.md', { body: 'one\n' }));
      await vault.createNote(note(N2, 'b.md', { body: 'two\n' }));

      expect(await storageErrorCode(() => vault.moveNote(N1, 'b.md'))).toBe('CONFLICT');
      expect((await vault.readNote(N1)).body).toBe('one\n');
      expect((await vault.readNote(N2)).body).toBe('two\n');
    });
  });

  it('rejects moving a missing note', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      expect(await storageErrorCode(() => vault.moveNote(N1, 'a.md'))).toBe('NOT_FOUND');
    });
  });

  it('rejects paths that collide only by case', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note(N1, 'a.md'));

      expect(await storageErrorCode(() => vault.createNote(note(N2, 'A.md')))).toBe('CONFLICT');
      expect(await storageErrorCode(() => vault.moveNote(N1, 'A.md'))).toBe('CONFLICT');
      expect((await vault.readNote(N1)).path).toBe('a.md');
    });
  });

  it('deletes a note and reports a missing note', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note(N1, 'a.md'));

      await vault.deleteNote(N1);

      expect(await exists(join(vault.root, 'a.md'))).toBe(false);
      expect(await storageErrorCode(() => vault.readNote(N1))).toBe('NOT_FOUND');
      expect(await storageErrorCode(() => vault.deleteNote(N1))).toBe('NOT_FOUND');
    });
  });

  it('rejects invalid note input and unsafe paths', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const badId = { ...note(N1, 'a.md'), id: 'not-a-uuid' };

      expect(await storageErrorCode(() => vault.createNote(badId))).toBe('INVALID_INPUT');
      expect(
        await storageErrorCode(() => vault.createNote({ ...note(N2, 'safe.md'), path: '../escape.md' })),
      ).toBe('UNSAFE_PATH');
    });
  });

  it('reports an on-disk note with a newer format version', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await writeFile(
        join(dir, 'future.md'),
        `---\ntitle: Future\nnodus:\n  version: 2\n  id: ${N1}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\nBody\n`,
        'utf8',
      );

      expect(await storageErrorCode(() => vault.readNote(N1))).toBe('UNSUPPORTED_VERSION');
      expect(await storageErrorCode(() => vault.listNotes())).toBe('UNSUPPORTED_VERSION');
    });
  });

  it('reports malformed notes through health without throwing', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await writeFile(join(dir, 'broken.md'), '---\ntitle: [broken\nnodus:\n  version: 1\n---\nBody\n', 'utf8');

      expect(await storageErrorCode(() => vault.listNotes())).toBe('INVALID_CONTENT');
      const health = await vault.checkHealth();
      expect(health.notes).toEqual([]);
      expect(health.issues).toEqual([
        expect.objectContaining({ code: 'INVALID_CONTENT', path: 'broken.md' }),
      ]);
    });
  });

  it('detects duplicate IDs on disk', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const created = note(N1, 'one.md');
      await vault.createNote(created);
      await writeFile(join(dir, 'two.md'), serializeNote({ ...created, path: 'two.md' }), 'utf8');

      expect(await storageErrorCode(() => vault.readNote(N1))).toBe('DUPLICATE_ID');
      expect(await storageErrorCode(() => vault.listNotes())).toBe('DUPLICATE_ID');
      const health = await vault.checkHealth();
      expect(health.issues.filter((issue) => issue.code === 'DUPLICATE_ID')).toHaveLength(2);
    });
  });

  it('leaves no temp files behind when a write fails', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await writeFile(join(dir, 'blocker'), 'not a directory', 'utf8');

      expect(await storageErrorCode(() => vault.createNote(note(N1, 'blocker/a.md')))).toBe('STORAGE_FAILURE');
      const leftovers = (await import('node:fs/promises')).readdir(dir);
      expect((await leftovers).filter((name) => name.startsWith('.nodus-tmp-'))).toEqual([]);
    });
  });

  it('snapshots raw entries in a stable order', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note(N2, 'b.md'));
      await vault.createNote(note(N1, 'a.md'));
      await vault.createDatabase(database());

      const entries = await vault.snapshot();
      expect(entries.map((entry) => `${entry.kind}:${entry.path}`)).toEqual([
        'note:a.md',
        'note:b.md',
        `database:databases/${DB1}.json`,
      ]);
      expect(entries[0]?.text).toBe(serializeNote(note(N1, 'a.md')));
    });
  });
});

describe('database definition storage', () => {
  it('creates, reads, and lists a database definition', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createDatabase(database());

      expect(await vault.readDatabase(DB1)).toEqual(database());
      expect(await vault.listDatabases()).toEqual([
        { id: DB1, name: 'Reading list', path: `databases/${DB1}.json`, propertyCount: 1 },
      ]);
      expect(await exists(join(vault.root, 'databases', `${DB1}.json`))).toBe(true);
    });
  });

  it('rejects a duplicate database ID', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createDatabase(database());

      expect(await storageErrorCode(() => vault.createDatabase(database(DB1, 'Other')))).toBe('CONFLICT');
    });
  });

  it('replaces and deletes a database definition', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createDatabase(database());

      await vault.replaceDatabase({ ...database(), name: 'Renamed' });
      expect((await vault.readDatabase(DB1)).name).toBe('Renamed');

      await vault.deleteDatabase(DB1);
      expect(await storageErrorCode(() => vault.readDatabase(DB1))).toBe('NOT_FOUND');
      expect(await storageErrorCode(() => vault.deleteDatabase(DB1))).toBe('NOT_FOUND');
    });
  });

  it('reports a malformed database definition and an unknown ID', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await mkdir(join(dir, 'databases'), { recursive: true });
      await writeFile(join(dir, 'databases', 'broken.json'), '{ nope', 'utf8');

      expect(await storageErrorCode(() => vault.readDatabase(DB1))).toBe('NOT_FOUND');
      expect(await storageErrorCode(() => vault.listDatabases())).toBe('INVALID_CONTENT');
    });
  });

  it('rejects a non-definition file in the reserved databases directory', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await mkdir(join(dir, 'databases'), { recursive: true });
      await writeFile(join(dir, 'databases', 'notes.txt'), 'not a definition', 'utf8');

      expect(await storageErrorCode(() => vault.listDatabases())).toBe('INVALID_CONTENT');
      expect((await vault.checkHealth()).issues).toEqual([
        expect.objectContaining({ path: 'databases/notes.txt' }),
      ]);
    });
  });

  it('rejects an invalid database definition as input', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const invalid = { ...database(), properties: [{ id: PROP1, name: 'X', type: 'relation' }] };
      expect(
        await storageErrorCode(() => vault.createDatabase(invalid as unknown as DatabaseDefinition)),
      ).toBe('INVALID_INPUT');
    });
  });
});

describe('conditional writes (expectedHash)', () => {
  const externalBody = 'External edit\n';

  async function externalEdit(vault: FileSystemVault, path: string): Promise<void> {
    await writeFile(join(vault.root, path), serializeNote({ ...note(N1, path), body: externalBody }), 'utf8');
  }

  it('readNoteWithHash returns the SHA-256 of the raw file bytes', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note(N1, 'notes/a.md'));

      const { note: read, hash, text } = await vault.readNoteWithHash(N1);
      const raw = await readFile(join(vault.root, 'notes/a.md'));

      expect(read.id).toBe(N1);
      expect(text).toBe(raw.toString('utf8'));
      expect(hash).toBe(createHash('sha256').update(raw).digest('hex'));
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it('rejects a stale replace with STALE_WRITE and keeps the external edit', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const created = note(N1, 'notes/a.md', { body: 'Original\n' });
      await vault.createNote(created);
      const { hash } = await vault.readNoteWithHash(N1);

      await externalEdit(vault, 'notes/a.md');
      const externalHash = (await vault.readNoteWithHash(N1)).hash;

      let error: StorageError | undefined;
      try {
        await vault.replaceNote({ ...created, body: 'New body\n' }, { expectedHash: hash });
      } catch (caught) {
        error = caught as StorageError;
      }
      expect(error?.code).toBe('STALE_WRITE');
      expect(error?.details?.currentHash).toBe(externalHash);

      expect(await readFile(join(vault.root, 'notes/a.md'), 'utf8')).toContain(externalBody);
      expect((await vault.readNote(N1)).body).toBe(externalBody);
    });
  });

  it('writes when expectedHash matches the file on disk', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const created = note(N1, 'notes/a.md', { body: 'Original\n' });
      await vault.createNote(created);
      const { hash } = await vault.readNoteWithHash(N1);

      await vault.replaceNote({ ...created, body: 'New body\n', updatedAt: '2026-10-25T11:00:00Z' }, {
        expectedHash: hash,
      });

      expect((await vault.readNote(N1)).body).toBe('New body\n');
    });
  });

  it('omitting expectedHash behaves exactly as before (last write wins)', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const created = note(N1, 'notes/a.md', { body: 'Original\n' });
      await vault.createNote(created);
      await vault.readNoteWithHash(N1);
      await externalEdit(vault, 'notes/a.md');

      await vault.replaceNote({ ...created, body: 'New body\n', updatedAt: '2026-10-25T11:00:00Z' });

      expect((await vault.readNote(N1)).body).toBe('New body\n');
    });
  });

  it('rejects a stale move and leaves both files untouched', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note(N1, 'notes/a.md', { body: 'Original\n' }));
      const { hash } = await vault.readNoteWithHash(N1);
      await externalEdit(vault, 'notes/a.md');
      const externalHash = (await vault.readNoteWithHash(N1)).hash;

      let error: StorageError | undefined;
      try {
        await vault.moveNote(N1, 'archive/b.md', { expectedHash: hash });
      } catch (caught) {
        error = caught as StorageError;
      }

      expect(error?.code).toBe('STALE_WRITE');
      expect(error?.details?.currentHash).toBe(externalHash);
      expect(await exists(join(vault.root, 'archive/b.md'))).toBe(false);
      expect(await readFile(join(vault.root, 'notes/a.md'), 'utf8')).toContain(externalBody);
    });
  });

  it('rejects a stale delete and keeps the external edit', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note(N1, 'notes/a.md', { body: 'Original\n' }));
      const { hash } = await vault.readNoteWithHash(N1);
      await externalEdit(vault, 'notes/a.md');

      expect(await storageErrorCode(() => vault.deleteNote(N1, { expectedHash: hash }))).toBe(
        'STALE_WRITE',
      );
      expect(await exists(join(vault.root, 'notes/a.md'))).toBe(true);
      expect(await readFile(join(vault.root, 'notes/a.md'), 'utf8')).toContain(externalBody);
    });
  });

  it('serializes concurrent replaceNote calls on the same path', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const created = note(N1, 'notes/a.md', { body: 'Original\n' });
      await vault.createNote(created);
      const { hash } = await vault.readNoteWithHash(N1);

      const first = vault.replaceNote(
        { ...created, body: 'First\n', updatedAt: '2026-10-25T11:00:00Z' },
        { expectedHash: hash },
      );
      const second = vault.replaceNote(
        { ...created, body: 'Second\n', updatedAt: '2026-10-25T12:00:00Z' },
        { expectedHash: hash },
      );

      const settled = await Promise.allSettled([first, second]);
      const codes = settled.map((result) =>
        result.status === 'fulfilled'
          ? 'ok'
          : ((result.reason as StorageError).code ?? 'unknown'),
      );

      // The mutex guarantees the second check runs after the first write, so
      // exactly one succeeds and the other reports STALE_WRITE with no interleaving.
      expect(codes.filter((code) => code === 'ok')).toHaveLength(1);
      expect(codes.filter((code) => code === 'STALE_WRITE')).toHaveLength(1);

      const finalBody = (await vault.readNote(N1)).body;
      expect(['First\n', 'Second\n']).toContain(finalBody);
    });
  });
});
