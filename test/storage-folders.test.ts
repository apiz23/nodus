import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { parseNote } from '../src/format/note-format.js';
import { createBackup, restoreBackup } from '../src/storage/backup/backup.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-10-25T09:00:00Z';
const NOTE_ID = '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';
const OTHER_ID = '0b7c9e1a-2d3f-4a5b-8c6d-7e8f9a0b1c2d';

function note(id: string, path: string, extra: Partial<Parameters<typeof createNote>[0]> = {}) {
  return createNote({ id, title: path.split('/').at(-1)!.replace(/\.md$/, ''), path, body: 'Body\n', now: NOW, ...extra });
}

describe('filesystem folder operations', () => {
  it('creates and lists root, nested, and empty folders from the filesystem', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createFolder('Projects');
      await vault.createFolder('Projects/Research');
      await vault.createFolder('Empty');
      expect(await vault.listFolders()).toEqual(['Empty', 'Projects', 'Projects/Research']);
      await expect(vault.createFolder('Projects')).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(vault.createFolder('../escape')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
      await expect(vault.createFolder('CON')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
      await expect(vault.createFolder('databases')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });
  });

  it('prevents different storage paths from collapsing to one sidebar folder', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(note(NOTE_ID, 'notes/seed.md'));
      await vault.createFolder('notes/Research');
      await expect(vault.createFolder('Research')).rejects.toMatchObject({ code: 'CONFLICT' });
      await vault.createFolder('Archive');
      await expect(vault.moveFolder('Archive', 'Research')).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(vault.listFolders()).resolves.toContain('notes/Research');
    });
  });

  it('moves populated folders without replacing destinations and preserves note IDs, bytes, and links', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createFolder('Work');
      await vault.createFolder('Archive');
      const source = note(NOTE_ID, 'Work/reference.md', {
        title: 'Reference', aliases: ['Quick reference'], body: 'See [[Other note]] and [[00000000-0000-4000-8000-000000000001|pinned]].\n',
      });
      await vault.createNote(source);
      const originalBytes = await readFile(join(root, source.path));
      await writeFile(join(root, 'Work/attachment.bin'), Buffer.from([0, 1, 2, 255]));
      await vault.moveFolder('Work', 'Archive/Work');

      const moved = await vault.readNoteWithHash(NOTE_ID);
      expect(moved.note.path).toBe('Archive/Work/reference.md');
      expect(moved.note.id).toBe(NOTE_ID);
      expect(moved.note.body).toBe(source.body);
      expect(moved.note.aliases).toEqual(['Quick reference']);
      expect(await readFile(join(root, moved.note.path))).toEqual(originalBytes);
      expect(await readFile(join(root, 'Archive/Work/attachment.bin'))).toEqual(Buffer.from([0, 1, 2, 255]));
      await expect(vault.moveFolder('Archive/Work', 'Archive/Work/child')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(vault.moveFolder('Archive/Work', 'Archive/Work')).resolves.toBeUndefined();
    });
  });

  it('materializes path-derived IDs before moving a plain-Markdown folder', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createFolder('Daily');
      await vault.createFolder('Archive');
      const body = '# Plain note\n\n[[A linked note]] café 日本語 🙂\n';
      await writeFile(join(root, 'Daily/plain.md'), body);
      const id = parseNote(body, 'Daily/plain.md').id;

      await vault.moveFolder('Daily', 'Archive/Daily');

      const moved = await vault.readNoteWithHash(id);
      expect(moved.note.path).toBe('Archive/Daily/plain.md');
      expect(moved.note.id).toBe(id);
      expect(moved.note.body).toBe(body);
      expect(moved.note.sourceFormat).toBeUndefined();
      expect(await readFile(join(root, moved.note.path), 'utf8')).toContain(`id: ${id}`);
    });
  });

  it('keeps moved note paths and stable identities compatible with backup and restore', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(join(root, 'vault'));
      await vault.createFolder('Projects');
      await vault.createFolder('Archive');
      const source = note(NOTE_ID, 'Projects/plan.md', {
        title: 'Plan', body: 'Reference [[A destination|the destination]].\n', aliases: ['Project plan'],
      });
      await vault.createNote(source);
      await vault.moveFolder('Projects', 'Archive/Projects');

      const backupPath = join(root, 'backup');
      await createBackup(vault, backupPath);
      const restored = await FileSystemVault.open(join(root, 'restored'));
      await restoreBackup(backupPath, restored.root);

      const restoredNote = await restored.readNoteWithHash(NOTE_ID);
      expect(restoredNote.note).toMatchObject({
        id: NOTE_ID,
        path: 'Archive/Projects/plan.md',
        aliases: ['Project plan'],
        body: source.body,
      });
    });
  });

  it('requires a fresh impact token before deleting empty or populated folders', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createFolder('Box');
      await vault.createFolder('Box/Inside');
      await vault.createNote(note(NOTE_ID, 'Box/Inside/note.md'));
      await writeFile(join(root, 'Box/photo.png'), Buffer.from('attachment'));

      const impact = await vault.inspectFolder('Box');
      expect(impact).toMatchObject({ folders: 1, notes: 1, files: 1, noteIds: [NOTE_ID] });
      await writeFile(join(root, 'Box/new.txt'), 'changed after confirmation');
      await expect(vault.deleteFolder('Box', impact.token)).rejects.toMatchObject({ code: 'STALE_WRITE' });
      const fresh = await vault.inspectFolder('Box');
      expect(fresh.files).toBe(2);
      await expect(vault.deleteFolder('Box', fresh.token)).resolves.toEqual([NOTE_ID]);
      await expect(stat(join(root, 'Box'))).rejects.toMatchObject({ code: 'ENOENT' });

      await vault.createFolder('Empty');
      const empty = await vault.inspectFolder('Empty');
      expect(empty).toMatchObject({ folders: 0, notes: 0, files: 0 });
      await expect(vault.deleteFolder('Empty', empty.token)).resolves.toEqual([]);
    });
  });

  it('serializes concurrent creates and rejects file destinations, traversal, and reserved roots', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      const results = await Promise.allSettled([vault.createFolder('Shared'), vault.createFolder('Shared')]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

      await vault.createFolder('Move me');
      await expect(vault.moveFolder('Move me', 'move me/child')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await vault.createNote(note(OTHER_ID, 'destination.md'));
      await expect(vault.moveFolder('Move me', 'destination.md')).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(vault.moveFolder('Move me', '../escape')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
      await expect(vault.deleteFolder('notes', '0'.repeat(64))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });
  });
});
