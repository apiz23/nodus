import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createBackup, restoreBackup, validateBackup } from '../src/storage/backup/backup.js';
import { exportVault } from '../src/storage/portable/export.js';
import { applyImport, planImport } from '../src/storage/portable/import.js';
import { writeFileAtomicExclusive } from '../src/storage/fs/atomic.js';
import { createNote } from '../src/domain/note.js';
import { randomUUID } from 'node:crypto';
import { withTempDir } from './tmp.js';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const NOW = '2026-10-30T09:00:00Z';

describe('vault attachments', () => {
  it('atomically creates a file exclusively and never replaces an existing target', async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, 'exclusive.bin');
      await writeFile(target, 'keep');
      await expect(writeFileAtomicExclusive(target, Buffer.from('replace'))).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(target, 'utf8')).toBe('keep');
      const created = join(dir, 'new.bin');
      await writeFileAtomicExclusive(created, PNG);
      expect(await readFile(created)).toEqual(PNG);
    });
  });

  it('creates unique vault-relative files without overwriting and preserves extensions', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      const first = await vault.createAttachment('cover.png', PNG);
      const second = await vault.createAttachment('cover.png', PNG);
      expect(first.path).toMatch(/^attachments\/[0-9a-f-]+-cover\.png$/);
      expect(second.path).not.toBe(first.path);
      expect(await readFile(join(vault.root, first.path))).toEqual(PNG);
      expect((await vault.listFolders())).not.toContain('attachments');
      expect((await vault.listAttachments()).map((item) => item.path)).toEqual([first.path, second.path].sort());
      const invalidNote = createNote({ id: randomUUID(), title: 'Misplaced note', path: 'attachments/misplaced.md', body: '', now: NOW });
      await expect(vault.createNote(invalidNote)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });
  });

  it('rejects unsupported types, mismatched content, oversized files and traversal paths', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      await expect(vault.createAttachment('script.svg', PNG)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(vault.createAttachment('fake.png', Buffer.from('<script>'))).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      await expect(vault.createAttachment('large.png', Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(vault.readAttachment('../outside.png')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    });
  });

  it('detects references outside code, protects deletion until confirmed, and leaves notes intact', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      const note = createNote({ id: randomUUID(), title: 'Image note', path: 'notes/image-note.md', body: '', now: NOW });
      await vault.createNote(note);
      const attachment = await vault.createAttachment('diagram.png', PNG);
      const relative = `../${attachment.path}`;
      const current = await vault.readNoteWithHash(note.id);
      await vault.replaceNote({ ...current.note, body: `![diagram](${relative})\n\n![reference][diagram-ref]\n\n[diagram-ref]: ${relative}\n[unused]: ../attachments/not-this-file.png\n\n\`[ignored](${relative})\`` }, { expectedHash: current.hash });
      expect((await vault.listAttachments())[0]?.references).toEqual([note.path]);
      await expect(vault.deleteAttachment(attachment.path)).rejects.toMatchObject({ code: 'CONFLICT' });
      await vault.deleteAttachment(attachment.path, true);
      expect((await vault.readNote(note.id)).body).toContain(relative);
      await expect(vault.readAttachment(attachment.path)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('does not follow symlinked attachment files', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      const outside = join(dir, 'outside.png');
      await writeFile(outside, PNG);
      const path = 'attachments/11111111-1111-4111-8111-111111111111-outside.png';
      await mkdir(join(vault.root, 'attachments'));
      await symlink(outside, join(vault.root, path));
      await expect(vault.readAttachment(path)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
      await expect(vault.listAttachments()).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
    });
  });

  it('preserves an existing user folder named attachments instead of reclassifying its contents', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      await mkdir(join(vault.root, 'attachments'));
      await writeFile(join(vault.root, 'attachments', 'reference.txt'), 'user data');
      expect(await vault.listFolders()).toContain('attachments');
      await expect(vault.createAttachment('new.png', PNG)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await readFile(join(vault.root, 'attachments', 'reference.txt'), 'utf8')).toBe('user data');
    });
  });

  it('includes binary attachments in portable backups and restores them with note references', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const note = createNote({ id: randomUUID(), title: 'Portable image', path: 'notes/portable-image.md', body: '', now: NOW });
      await source.createNote(note);
      const attachment = await source.createAttachment('photo.png', PNG);
      const current = await source.readNoteWithHash(note.id);
      await source.replaceNote({ ...current.note, body: `![photo](../${attachment.path})` }, { expectedHash: current.hash });
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const validation = await validateBackup(backup);
      expect(validation.manifest.version).toBe(4);
      expect(validation.entries.some((entry) => entry.kind === 'attachment' && entry.rawBytes?.equals(PNG))).toBe(true);
      const restored = await restoreBackup(backup, join(dir, 'restored'));
      expect(restored.attachments).toBe(1);
      const target = await FileSystemVault.open(join(dir, 'restored'));
      expect(await readFile(join(target.root, attachment.path))).toEqual(PNG);
      expect((await target.readNote(note.id)).body).toContain(attachment.path);
      await writeFile(join(backup, 'attachments', 'unlisted.png'), PNG);
      await expect(validateBackup(backup)).rejects.toMatchObject({ code: 'CORRUPT_BACKUP' });
      await rm(backup, { recursive: true, force: true });
    });
  });

  it('preserves managed attachments through portable export and import', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const attachment = await source.createAttachment('exported.png', PNG);
      const exported = join(dir, 'exported-vault');
      expect(await exportVault(source, exported)).toMatchObject({ attachments: 1 });
      expect(await readFile(join(exported, attachment.path))).toEqual(PNG);
      const destination = await FileSystemVault.open(join(dir, 'destination'));
      const imported = await applyImport(destination, await planImport(exported));
      expect(imported.attachments).toBe(1);
      expect(await readFile(join(destination.root, attachment.path))).toEqual(PNG);
    });
  });
});
