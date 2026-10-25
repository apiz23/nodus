import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Note } from '../src/domain/note.js';
import { serializeNote } from '../src/format/note-format.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { withTempDir } from './tmp.js';
import { storageErrorCode } from './helpers.js';

const NOW = '2026-10-25T09:00:00Z';
const N1 = '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';

const note = (path: string): Note => ({
  id: N1,
  title: 'Path test',
  path,
  body: 'Body\n',
  createdAt: NOW,
  updatedAt: NOW,
  tags: [],
  aliases: [],
  extraFrontmatter: {},
});

const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

describe('vault path safety', () => {
  it('rejects traversal paths at the adapter boundary', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      expect(await storageErrorCode(() => vault.createNote(note('../outside.md')))).toBe('UNSAFE_PATH');
      expect(await storageErrorCode(() => vault.createNote(note('notes/../../outside.md')))).toBe('UNSAFE_PATH');
    });
  });

  it('rejects note paths inside the reserved databases directory', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      expect(await storageErrorCode(() => vault.createNote(note('databases/a.md')))).toBe('INVALID_INPUT');
    });
  });

  it('does not follow a directory link that escapes the vault', async () => {
    await withTempDir(async (dir) => {
      const root = join(dir, 'vault');
      const outside = join(dir, 'outside');
      await mkdir(root, { recursive: true });
      await mkdir(outside, { recursive: true });
      await symlink(outside, join(root, 'link'), LINK_TYPE);

      const vault = await FileSystemVault.open(root);

      expect(await storageErrorCode(() => vault.createNote(note('link/escape.md')))).toBe('UNSAFE_PATH');
      const health = await vault.checkHealth();
      expect(health.issues).toEqual([expect.objectContaining({ code: 'UNSAFE_PATH', path: 'link' })]);
    });
  });

  it('does not treat a symlinked note file as vault content', async () => {
    await withTempDir(async (dir) => {
      const root = join(dir, 'vault');
      const outside = join(dir, 'outside');
      await mkdir(root, { recursive: true });
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, 'real.md'), serializeNote(note('real.md')), 'utf8');
      await symlink(join(outside, 'real.md'), join(root, 'leak.md'), 'file');

      const vault = await FileSystemVault.open(root);

      expect(await vault.listNotes()).toEqual([]);
      expect((await vault.checkHealth()).issues).toEqual([
        expect.objectContaining({ code: 'UNSAFE_PATH', path: 'leak.md' }),
      ]);
    });
  });

  it('ignores hidden files and directories', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await mkdir(join(dir, '.git'), { recursive: true });
      await writeFile(join(dir, '.git', 'README.md'), serializeNote(note('.git/README.md')), 'utf8');

      expect(await vault.listNotes()).toEqual([]);
      expect((await vault.checkHealth()).issues).toEqual([]);
    });
  });
});
