import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeDatabase } from '../src/database/schema.js';
import { createNote } from '../src/domain/note.js';
import { serializeNote } from '../src/format/note-format.js';
import { FileSystemVault, sha256Hex } from '../src/storage/fs/vault.js';
import { withTempDir } from './tmp.js';

const ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTHER = 'bbbbbbbb-2222-4222-8222-222222222222';
const NOW = '2026-10-25T12:00:00Z';
const database = { id: ID, name: 'Fixture', properties: [] };
const note = (path = 'notes/a.md', id = ID) => createNote({ id, path, title: 'Fixture', body: 'Café 日本語 📝\n', now: NOW });

describe('vault text integrity', () => {
  it('rejects malformed UTF-8 on reads and saves without changing the source bytes', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await mkdir(join(dir, 'notes'));
      const bytes = Buffer.concat([Buffer.from(serializeNote(note())), Buffer.from([0xc3, 0x28])]);
      await writeFile(join(dir, 'notes/a.md'), bytes);

      for (const read of [() => vault.readNote(ID), () => vault.readNoteWithHash(ID),
        () => vault.readNoteAtPath('notes/a.md'), () => vault.listNotes(), () => vault.snapshot()]) {
        await expect(read()).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      }
      await expect(vault.replaceNote({ ...note(), title: 'Changed' }, { expectedHash: sha256Hex(bytes) }))
        .rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      expect((await vault.checkHealth()).issues).toEqual([
        expect.objectContaining({ code: 'INVALID_CONTENT', path: 'notes/a.md' }),
      ]);
      expect(await readFile(join(dir, 'notes/a.md'))).toEqual(bytes);
      expect(await readdir(join(dir, 'notes'))).toEqual(['a.md']);
    });
  });

  it('keeps valid multibyte text and the raw BOM/hash contract intact', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await mkdir(join(dir, 'notes'));
      const bytes = Buffer.from(`\uFEFF${serializeNote(note())}`);
      await writeFile(join(dir, 'notes/a.md'), bytes);
      const stored = await vault.readNoteWithHash(ID);
      expect(stored.note.body).toBe(note().body);
      expect(stored.text).toBe(bytes.toString('utf8'));
      expect(stored.hash).toBe(sha256Hex(bytes));
      await vault.replaceNote({ ...stored.note, title: 'Changed' }, { expectedHash: stored.hash });
      expect((await vault.readNote(ID)).body).toBe(note().body);
    });
  });

  it('rejects malformed UTF-8 inside otherwise valid database JSON', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await mkdir(join(dir, 'databases'));
      const text = serializeDatabase(database);
      const index = text.indexOf('Fixture');
      const bytes = Buffer.concat([Buffer.from(text.slice(0, index)), Buffer.from([0x80]), Buffer.from(text.slice(index + 7))]);
      await writeFile(join(dir, 'databases', `${ID}.json`), bytes);
      await expect(vault.readDatabase(ID)).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      await expect(vault.listDatabases()).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      expect(await readFile(join(dir, 'databases', `${ID}.json`))).toEqual(bytes);
    });
  });
});

describe('vault mutation boundaries', () => {
  it.each(['outside-directory', 'inside-directory', 'broken-directory', 'leaf', 'broken-leaf'])(
    'rejects database deletion through a %s symlink', async (kind) => {
      await withTempDir(async (dir) => {
        const vault = await FileSystemVault.open(join(dir, 'vault'));
        const external = join(dir, 'external');
        await mkdir(external);
        const bytes = Buffer.from(serializeDatabase(database));
        await writeFile(join(external, `${ID}.json`), bytes);
        if (kind.endsWith('directory')) {
          const inside = join(vault.root, 'internal');
          await mkdir(inside);
          await writeFile(join(inside, `${ID}.json`), bytes);
          const target = kind === 'outside-directory' ? external : kind === 'inside-directory' ? inside : join(dir, 'missing');
          await symlink(target, join(vault.root, 'databases'), 'dir');
        } else {
          await mkdir(join(vault.root, 'databases'));
          await symlink(join(external, kind === 'leaf' ? `${ID}.json` : 'missing.json'), join(vault.root, 'databases', `${ID}.json`), 'file');
        }
        await expect(vault.deleteDatabase(ID)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
        expect(await readFile(join(external, `${ID}.json`))).toEqual(bytes);
        if (kind === 'inside-directory') expect(await readFile(join(vault.root, 'internal', `${ID}.json`))).toEqual(bytes);
      });
    },
  );

  it.each([
    ['.hidden.md', 'UNSAFE_PATH'], ['notes/.archive/a.md', 'UNSAFE_PATH'],
    ['.nodus-tmp-note.md', 'UNSAFE_PATH'], ['databases/a.md', 'INVALID_INPUT'], ['Databases/a.md', 'INVALID_INPUT'],
  ])('rejects excluded destination %s before create, move, or import mutates the vault', async (path, code) => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note());
      const files = await readdir(dir, { recursive: true });
      const bytes = await readFile(join(dir, 'notes/a.md'));
      const incoming = note(path, OTHER);
      await expect(vault.createNote(incoming)).rejects.toMatchObject({ code });
      await expect(vault.moveNote(ID, path)).rejects.toMatchObject({ code });
      await expect(vault.applyImport({ notes: [incoming], databases: [], entries: [
        { kind: 'note', id: OTHER, path, text: serializeNote(incoming) },
      ] })).rejects.toMatchObject({ code });
      expect(await readdir(dir, { recursive: true })).toEqual(files);
      expect(await readFile(join(dir, 'notes/a.md'))).toEqual(bytes);
    });
  });

  it('rejects a note destination under an in-root symlink that the scanner would exclude', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note());
      await mkdir(join(dir, 'internal'));
      await symlink(join(dir, 'internal'), join(dir, 'shortcut'), 'dir');
      await expect(vault.createNote(note('shortcut/new.md', OTHER))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
      await expect(vault.moveNote(ID, 'shortcut/new.md')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
      expect(await readdir(join(dir, 'internal'))).toEqual([]);
      expect((await vault.readNote(ID)).path).toBe('notes/a.md');
    });
  });
});
