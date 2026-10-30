import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { withTempDir } from './tmp.js';

const ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-10-25T12:00:00Z';
const LATER = '2026-10-26T12:00:00Z';

async function seed(vault: FileSystemVault) {
  const note = {
    ...createNote({ id: ID, title: 'Keep draft data', path: 'notes/tags.md', body: '# Body stays verbatim\n', now: NOW, tags: [] }),
    tags: [' Nodus ', 'nodus', 'Cafe\u0301'],
    aliases: ['Alternate title'],
    extraFrontmatter: {
      icon: '📘', custom: { nested: ['keep', 3] },
      nodus_data: { format: 'nodus-note-properties', version: 1, databases: { keep: { score: 4 } } },
    },
  };
  await vault.createNote(note);
  return note;
}

describe('conditional tag storage', () => {
  it('adds normalized tags while preserving existing metadata and body', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const original = await seed(vault);
      const opened = await vault.readNoteWithHash(ID);
      const result = await vault.updateNoteTags(ID, { type: 'add', tag: '  New tag  ' }, { expectedHash: opened.hash, now: LATER });
      expect(result.note).toMatchObject({
        id: ID, title: original.title, path: original.path, body: original.body,
        tags: [...original.tags, 'New tag'], aliases: original.aliases,
        updatedAt: LATER,
        extraFrontmatter: original.extraFrontmatter,
      });
      expect(result.hash).toBe((await vault.readNoteWithHash(ID)).hash);
    });
  });

  it('removes all matching legacy duplicates and replaces lists in requested order while retaining first spellings', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await seed(vault);
      let opened = await vault.readNoteWithHash(ID);
      const removed = await vault.updateNoteTags(ID, { type: 'remove', tag: 'NODUS' }, { expectedHash: opened.hash, now: LATER });
      expect(removed.note.tags).toEqual(['Cafe\u0301']);
      opened = await vault.readNoteWithHash(ID);
      const replaced = await vault.updateNoteTags(ID, { type: 'replace', tags: ['later', 'café', 'FIRST'] }, { expectedHash: opened.hash, now: NOW });
      expect(replaced.note.tags).toEqual(['later', 'Cafe\u0301', 'FIRST']);
      expect(replaced.note.updatedAt).toBe(NOW);
    });
  });

  it('rejects invalid and duplicate tags without changing bytes; supports no-op removes', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const note = await seed(vault);
      const opened = await vault.readNoteWithHash(ID);
      const path = join(dir, note.path);
      const before = await readFile(path);
      await expect(vault.updateNoteTags(ID, { type: 'add', tag: ' nodus ' }, { expectedHash: opened.hash, now: LATER })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(vault.updateNoteTags(ID, { type: 'replace', tags: ['x', ' X '] }, { expectedHash: opened.hash, now: LATER })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      const noOp = await vault.updateNoteTags(ID, { type: 'remove', tag: 'missing' }, { expectedHash: opened.hash, now: LATER });
      expect(noOp.hash).toBe(opened.hash);
      expect(noOp.note.updatedAt).toBe(NOW);
      expect(await readFile(path)).toEqual(before);
    });
  });

  it('rejects missing and stale revisions and allows only one concurrent update', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await seed(vault);
      const opened = await vault.readNoteWithHash(ID);
      await expect(vault.updateNoteTags('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { type: 'add', tag: 'x' }, { expectedHash: opened.hash, now: LATER })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const path = join(dir, opened.note.path);
      await writeFile(path, Buffer.concat([await readFile(path), Buffer.from('\nExternal body edit')]));
      await expect(vault.updateNoteTags(ID, { type: 'add', tag: 'x' }, { expectedHash: opened.hash, now: LATER })).rejects.toMatchObject({ code: 'STALE_WRITE' });

      const latest = await vault.readNoteWithHash(ID);
      const outcomes = await Promise.allSettled([
        vault.updateNoteTags(ID, { type: 'add', tag: 'one' }, { expectedHash: latest.hash, now: LATER }),
        vault.updateNoteTags(ID, { type: 'add', tag: 'two' }, { expectedHash: latest.hash, now: LATER }),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => (outcome as PromiseRejectedResult).reason.code)).toEqual(['STALE_WRITE']);
    });
  });
});
