import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { exportVault } from '../src/storage/portable/export.js';
import { planImport, previewImport } from '../src/storage/portable/import.js';
import { withVaultRootLock } from '../src/storage/fs/root-lock.js';
import { createPortableManifest, PORTABLE_EXPORT_VERSION, validatePortableExport, validatePortableManifest, validatePortablePath } from '../src/storage/portable/manifest.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-11-04T00:00:00Z';
const NOTE_ID = '2a4c6e80-1357-4b9d-8e0f-123456789abc';
const formats = { note: 1, database: 3, databaseView: 3, databaseViewOrder: 1, propertyCatalog: 1, automation: 1, automationHistory: 1, templates: 1 };

async function inventoryHashes(root: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const item of await (await import('node:fs/promises')).readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) out.push(...await inventoryHashes(root, path));
    else out.push(`${path}:${createHash('sha256').update(await readFile(join(root, path))).digest('hex')}`);
  }
  return out.sort();
}

function manifest(resources: Array<{ kind: 'note'; id: string; path: string; bytes: number; sha256: string }> = []) {
  return createPortableManifest({ createdAt: NOW, snapshotConsistency: 'cooperating-nodus-writers', formats, resources, folders: [], excluded: [] });
}

describe('portable export manifest', () => {
  it('creates and validates a v1 manifest and accepts unknown optional fields', () => {
    const valid = manifest();
    expect(valid.version).toBe(PORTABLE_EXPORT_VERSION);
    expect(() => validatePortableManifest({ ...valid, vendorExtension: { preservedByOwner: true } })).not.toThrow();
  });

  it('rejects missing fields, unsupported versions, and unknown required features', () => {
    const valid = manifest();
    const { createdAt: _createdAt, ...missing } = valid;
    expect(() => validatePortableManifest(missing)).toThrow(/timestamp/);
    expect(() => validatePortableManifest({ ...valid, version: 2 })).toThrow(/not supported/);
    expect(() => validatePortableManifest({ ...valid, requiredFeatures: ['future-encryption'] })).toThrow(/unsupported feature/);
  });

  it('rejects duplicate identities, duplicate paths, invalid resource types, and unsupported format versions', () => {
    const resource = { kind: 'note' as const, id: 'same', path: 'one.md', bytes: 0, sha256: '0'.repeat(64) };
    expect(() => manifest([resource, { ...resource, path: 'two.md' }])).toThrow(/Duplicate portable resource identity/);
    expect(() => manifest([resource, { ...resource, id: 'other' }])).toThrow(/Duplicate portable resource path/);
    expect(() => validatePortableManifest({ ...manifest(), resources: [{ ...resource, kind: 'mystery' }] })).toThrow(/invalid required fields/);
    expect(() => validatePortableManifest({ ...manifest(), formats: { ...formats, database: 4 } })).toThrow(/unsupported database format/);
  });

  it('rejects absolute and traversing paths', () => {
    for (const path of ['/absolute/file', '../escape', 'a/../../b', 'C:/escape', 'a\\b', 'notes/..']) expect(() => validatePortablePath(path)).toThrow();
  });

  it('verifies exact resource bytes and detects modification, missing files, size errors, and extras', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(join(root, 'vault'));
      await vault.createNote(createNote({ id: NOTE_ID, path: 'notes/portable.md', title: 'Portable', body: 'exact bytes\n', now: NOW }));
      const target = join(root, 'export');
      const result = await exportVault(vault, target, { now: NOW });
      expect(result).toMatchObject({ manifest: 'nodus-export.json', manifestVersion: 1, notes: 1 });
      const before = await validatePortableExport(target);
      expect(before.resources.find((item) => item.path === 'notes/portable.md')?.sha256).toMatch(/^[a-f0-9]{64}$/);

      const notePath = join(target, 'notes/portable.md');
      const noteBytes = await readFile(notePath);
      await writeFile(notePath, Buffer.concat([noteBytes, Buffer.from('changed')]));
      await expect(validatePortableExport(target)).rejects.toThrow(/size is incorrect|checksum is incorrect/);
      await writeFile(notePath, noteBytes);
      await writeFile(join(target, 'unexpected.txt'), 'not in manifest');
      await expect(validatePortableExport(target)).rejects.toThrow(/Unmanifested file/);
      await (await import('node:fs/promises')).rm(join(target, 'unexpected.txt'));
      await (await import('node:fs/promises')).rm(notePath);
      await expect(validatePortableExport(target)).rejects.toThrow(/missing/);
    });
  });

  it('reports unsupported source files explicitly and refuses an existing destination without overwriting it', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(join(root, 'vault'));
      await vault.createNote(createNote({ id: NOTE_ID, path: 'note.md', title: 'Note', body: '', now: NOW }));
      await writeFile(join(vault.root, 'unsupported.csv'), 'x,y\n1,2\n');
      const target = join(root, 'export');
      const result = await exportVault(vault, target);
      expect(result.excluded).toContainEqual({ path: 'unsupported.csv', reason: 'File type is not supported by the portable export format.' });
      expect((await validatePortableExport(target)).excluded).toHaveLength(1);

      const conflict = join(root, 'existing');
      await mkdir(conflict);
      await writeFile(join(conflict, 'keep.txt'), 'keep');
      await expect(exportVault(vault, conflict)).rejects.toThrow(/not empty/);
      expect(await readFile(join(conflict, 'keep.txt'), 'utf8')).toBe('keep');
    });
  });

  it('captures note, database, and attachment revisions before queued Nodus writers', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(join(root, 'vault'));
      const originalNote = createNote({ id: NOTE_ID, path: 'note.md', title: 'Before', body: 'before', now: NOW });
      await vault.createNote(originalNote);
      const databaseId = '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a';
      const database = { id: databaseId, name: 'Before', properties: [{ id: '9b9b9b9b-9b9b-4b9b-9b9b-9b9b9b9b9b9b', name: 'Title', type: 'text' as const }] };
      await vault.createDatabase(database);
      const attachment = await vault.createAttachment('source.txt', Buffer.from('before attachment'));

      let entered!: () => void;
      let release!: () => void;
      const acquired = new Promise<void>((resolve) => { entered = resolve; });
      const held = new Promise<void>((resolve) => { release = resolve; });
      const lock = withVaultRootLock(vault.root, async () => { entered(); await held; });
      await acquired;
      const snapshotPromise = vault.snapshotForPortableExport();
      const noteMutation = vault.replaceNote({ ...originalNote, title: 'After', body: 'after' });
      const databaseMutation = vault.replaceDatabase({ ...database, name: 'After' });
      const attachmentMutation = vault.deleteAttachment(attachment.path);
      release();
      const snapshot = await snapshotPromise;
      await Promise.all([lock, noteMutation, databaseMutation, attachmentMutation]);

      const noteBytes = snapshot.entries.find((entry) => entry.kind === 'note')!.rawBytes!.toString('utf8');
      const databaseBytes = snapshot.entries.find((entry) => entry.kind === 'database')!.rawBytes!.toString('utf8');
      expect(noteBytes).toContain('Before');
      expect(noteBytes).toContain('before');
      expect(databaseBytes).toContain('Before');
      expect(snapshot.entries.some((entry) => entry.kind === 'attachment' && entry.id === attachment.id)).toBe(true);
      expect((await vault.readNote(NOTE_ID)).title).toBe('After');
    });
  });

  it('previews manifest and legacy imports without changing the target vault', async () => {
    await withTempDir(async (root) => {
      const source = await FileSystemVault.open(join(root, 'source'));
      const target = await FileSystemVault.open(join(root, 'target'));
      const note = createNote({ id: NOTE_ID, path: 'note.md', title: 'Preview', body: 'portable', now: NOW });
      await source.createNote(note);
      const packageDir = join(root, 'package'); await exportVault(source, packageDir, { now: NOW });
      const before = await inventoryHashes(target.root);
      const preview = await previewImport(packageDir, target);
      expect(preview.format).toBe('nodus-portable-export');
      expect(preview.resources[0]).toMatchObject({ status: 'new', id: NOTE_ID });
      expect(await inventoryHashes(target.root)).toEqual(before);
      const legacy = join(root, 'legacy'); await mkdir(legacy); await mkdir(join(legacy, 'notes')); await writeFile(join(legacy, 'notes', 'note.md'), await readFile(join(source.root, 'note.md')));
      expect((await planImport(legacy)).portableManifest).toBeUndefined();
      expect((await previewImport(legacy, target)).format).toBe('legacy-directory');
      expect(await inventoryHashes(target.root)).toEqual(before);
      await writeFile(join(packageDir, 'nodus-export.json'), '{malformed');
      await expect(previewImport(packageDir, target)).rejects.toThrow();
      expect(await inventoryHashes(target.root)).toEqual(before);
    });
  });

  it('never falls back to legacy import when a present manifest is malformed or invalid', async () => {
    await withTempDir(async (root) => {
      const source = await FileSystemVault.open(join(root, 'source'));
      await source.createNote(createNote({ id: NOTE_ID, path: 'note.md', title: 'N', body: '', now: NOW }));
      const packageDir = join(root, 'package'); await exportVault(source, packageDir, { now: NOW });
      const manifestPath = join(packageDir, 'nodus-export.json');
      const original = await readFile(manifestPath, 'utf8');
      for (const invalid of ['{broken', JSON.stringify({ format: 'nodus-portable-export', version: 1 }), JSON.stringify({ ...JSON.parse(original), digest: '0'.repeat(64) })]) {
        await writeFile(manifestPath, invalid);
        await expect(planImport(packageDir)).rejects.toThrow();
      }
      await writeFile(manifestPath, original);
      const parsed = JSON.parse(original); parsed.resources[0].sha256 = '0'.repeat(64); parsed.digest = '0'.repeat(64);
      await writeFile(manifestPath, JSON.stringify(parsed));
      await expect(planImport(packageDir)).rejects.toThrow(/digest|checksum/);
      await writeFile(manifestPath, original);
      await (await import('node:fs/promises')).rm(join(packageDir, 'note.md'));
      await expect(planImport(packageDir)).rejects.toThrow(/missing/);
    });
  });

  it('classifies identical, ID and path collisions conservatively', async () => {
    await withTempDir(async (root) => {
      const src = await FileSystemVault.open(join(root, 'src'));
      const dst = await FileSystemVault.open(join(root, 'dst'));
      const sourceNote = createNote({ id: NOTE_ID, path: 'same.md', title: 'Source', body: 'same', now: NOW });
      await src.createNote(sourceNote);
      const dir = join(root, 'package'); await exportVault(src, dir, { now: NOW });
      await dst.createNote(sourceNote);
      expect((await previewImport(dir, dst)).resources[0]).toMatchObject({ status: 'identical', safeChoices: ['skip'] });
      await dst.replaceNote({ ...sourceNote, body: 'different' });
      expect((await previewImport(dir, dst)).conflicts[0]).toMatchObject({ status: 'conflict', safeChoices: ['skip', 'replace'] });
      const moved = await FileSystemVault.open(join(root, 'moved'));
      await moved.createNote({ ...sourceNote, path: 'elsewhere.md' });
      expect((await previewImport(dir, moved)).conflicts[0]?.safeChoices).toEqual(['skip']);
      const pathOnly = await FileSystemVault.open(join(root, 'path-only'));
      await pathOnly.createNote({ ...sourceNote, id: '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b' });
      expect((await previewImport(dir, pathOnly)).conflicts[0]?.safeChoices).toEqual(['skip']);
    });
  });
});
