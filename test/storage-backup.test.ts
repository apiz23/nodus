import { lstat, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseDefinition } from '../src/database/schema.js';
import { serializeDatabase } from '../src/database/schema.js';
import { createNote } from '../src/domain/note.js';
import { createHash } from 'node:crypto';
import { createBackup, previewRestore, restoreBackup, validateBackup } from '../src/storage/backup/backup.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { withTempDir } from './tmp.js';
import { storageErrorCode } from './helpers.js';

const NOW = '2026-10-25T09:00:00Z';
const BACKUP_NOW = '2026-10-25T12:00:00Z';
const N1 = '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';
const N2 = '22222222-2222-4222-8222-222222222222';
const DB1 = '9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73';
const PROP1 = '1f0c7d2a-0b1e-4c3d-9a8f-5e6d7c8b9a01';

const noteText = `---\ntitle: Backup\nproject: Research\nnodus:\n  version: 1\n  id: ${N1}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\nCafé 日本語 🙂\n\n\`\`\`\n[[Link]]\n\`\`\`\n`;

const database: DatabaseDefinition = {
  id: DB1,
  name: 'Reading list',
  properties: [{ id: PROP1, name: 'Title', type: 'text' }],
};

const futureNodusData = {
  format: 'nodus-note-properties',
  version: 7,
  databases: {
    [DB1]: {
      [PROP1]: { nested: ['opaque', 3, { keep: true }] },
    },
  },
  futureEnvelope: { vendor: 'example', flags: [true, 'preserve'] },
};

const MANIFEST = 'nodus-backup.json';

const pkg = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { name: string; version: string };

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Independent recomputation of the documented canonical digest: fixed key
 * order, files in manifest order, JSON.stringify with no whitespace, UTF-8,
 * SHA-256 hex. Locks the serialization spec against accidental changes.
 */
function canonicalDigest(manifest: {
  version: number;
  createdAt: unknown;
  app: unknown;
  formats: unknown;
  counts: unknown;
  files: unknown;
}): string {
  const app = manifest.app as { name: string; version: string };
  const formats = manifest.formats as { note: number; database: number; backup: number; databaseView?: number };
  const counts = manifest.counts as { notes: number; databases: number; databaseViews?: number };
  const files = (manifest.files as Array<Record<string, unknown>>).map((file) => ({
    kind: file.kind,
    id: file.id,
    path: file.path,
    sha256: file.sha256,
    bytes: file.bytes,
  }));
  return createHash('sha256')
    .update(
      JSON.stringify({
        format: 'nodus-backup',
        version: manifest.version,
        createdAt: manifest.createdAt,
        app: { name: app.name, version: app.version },
        formats: { note: formats.note, database: formats.database, ...(formats.databaseView === undefined ? {} : { databaseView: formats.databaseView }), backup: formats.backup },
        counts: { notes: counts.notes, databases: counts.databases, ...(counts.databaseViews === undefined ? {} : { databaseViews: counts.databaseViews }) },
        files,
      }),
      'utf8',
    )
    .digest('hex');
}

async function seedVault(root: string): Promise<FileSystemVault> {
  const vault = await FileSystemVault.open(root);
  await mkdir(join(vault.root, 'notes'), { recursive: true });
  await writeFile(join(vault.root, 'notes/a.md'), noteText, 'utf8');
  await vault.createDatabase(database);
  return vault;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('createBackup', () => {
  it('copies notes and database files and writes a manifest last', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');

      const report = await createBackup(vault, target, { now: BACKUP_NOW });

      expect(report).toEqual({ targetDir: target, notes: 1, databases: 1, databaseViews: 0 });
      expect(await readFile(join(target, 'notes/a.md'), 'utf8')).toBe(noteText);

      const manifest = JSON.parse(await readFile(join(target, MANIFEST), 'utf8'));
      expect(manifest).toEqual({
        format: 'nodus-backup',
        version: 2,
        createdAt: BACKUP_NOW,
        app: { name: pkg.name, version: pkg.version },
        formats: { note: 1, database: 1, databaseView: 2, backup: 2 },
        counts: { notes: 1, databases: 1, databaseViews: 0 },
        files: [
          {
            kind: 'note',
            id: N1,
            path: 'notes/a.md',
            sha256: hash(noteText),
            bytes: Buffer.byteLength(noteText, 'utf8'),
          },
          {
            kind: 'database',
            id: DB1,
            path: `databases/${DB1}.json`,
            sha256: hash(serializeDatabase(database)),
            bytes: Buffer.byteLength(serializeDatabase(database), 'utf8'),
          },
        ],
        digest: canonicalDigest(manifest),
      });
    });
  });

  it('refuses a target inside the vault', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      expect(await storageErrorCode(() => createBackup(vault, join(vault.root, 'backup')))).toBe('INVALID_INPUT');
    });
  });

  it('refuses a non-empty target without deleting its contents', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await mkdir(target);
      await writeFile(join(target, 'existing.txt'), 'keep me', 'utf8');

      expect(await storageErrorCode(() => createBackup(vault, target))).toBe('CONFLICT');
      expect(await readFile(join(target, 'existing.txt'), 'utf8')).toBe('keep me');
    });
  });

  it('writes no manifest when the vault is corrupt', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      await writeFile(join(vault.root, 'broken.md'), '---\ntitle: [broken\nnodus:\n  version: 1\n---\nBody\n', 'utf8');
      const target = join(dir, 'backup');

      expect(await storageErrorCode(() => createBackup(vault, target))).toBe('INVALID_CONTENT');
      expect(await exists(join(target, MANIFEST))).toBe(false);
    });
  });
});

describe('validateBackup', () => {
  it('accepts a complete backup and returns its entries', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target, { now: BACKUP_NOW });

      const validation = await validateBackup(target);

      expect(validation.manifest.createdAt).toBe(BACKUP_NOW);
      expect(validation.notes.map((entry) => entry.id)).toEqual([N1]);
      expect(validation.databases.map((entry) => entry.id)).toEqual([DB1]);
      expect(validation.entries.find((entry) => entry.kind === 'note')?.text).toBe(noteText);
    });
  });

  it('rejects a missing manifest as an incomplete backup', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target);
      await rm(join(target, MANIFEST));

      expect(await storageErrorCode(() => validateBackup(target))).toBe('CORRUPT_BACKUP');
    });
  });

  it('rejects malformed manifest JSON', async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, 'backup');
      await mkdir(target);
      await writeFile(join(target, MANIFEST), '{ nope', 'utf8');

      expect(await storageErrorCode(() => validateBackup(target))).toBe('CORRUPT_BACKUP');
    });
  });

  it('rejects an unsupported manifest version', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target);
      const manifest = JSON.parse(await readFile(join(target, MANIFEST), 'utf8'));
      await writeFile(join(target, MANIFEST), JSON.stringify({ ...manifest, version: 3 }), 'utf8');

      expect(await storageErrorCode(() => validateBackup(target))).toBe('UNSUPPORTED_VERSION');
    });
  });

  it('detects a missing file', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target);
      await rm(join(target, 'notes/a.md'));

      expect(await storageErrorCode(() => validateBackup(target))).toBe('CORRUPT_BACKUP');
    });
  });

  it('detects tampered content by hash', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target);
      await writeFile(join(target, 'notes/a.md'), noteText.replace('Café', 'Tampered'), 'utf8');

      expect(await storageErrorCode(() => validateBackup(target))).toBe('CORRUPT_BACKUP');
    });
  });

  it('detects duplicate IDs in the manifest', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target);
      const manifest = JSON.parse(await readFile(join(target, MANIFEST), 'utf8'));
      const files = [...manifest.files, manifest.files[0]];
      await writeFile(join(target, MANIFEST), JSON.stringify({ ...manifest, files }), 'utf8');

      expect(await storageErrorCode(() => validateBackup(target))).toBe('CORRUPT_BACKUP');
    });
  });

  it('detects a document that parses but does not match the manifest', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target);
      const manifest = JSON.parse(await readFile(join(target, MANIFEST), 'utf8'));
      const changed = { ...manifest.files[0], id: '0b7c9e1a-2d3f-4a5b-8c6d-7e8f9a0b1c2d' };
      const files = [changed, ...manifest.files.slice(1)];
      await writeFile(join(target, MANIFEST), JSON.stringify({ ...manifest, files }), 'utf8');

      expect(await storageErrorCode(() => validateBackup(target))).toBe('CORRUPT_BACKUP');
    });
  });

  it('rejects a non-regular backup entry', async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, 'backup');
      await mkdir(target, { recursive: true });
      await mkdir(join(target, 'notes'), { recursive: true });
      const manifest = {
        format: 'nodus-backup',
        version: 1,
        createdAt: BACKUP_NOW,
        files: [{ kind: 'note', id: N1, path: 'notes/a.md', sha256: hash(noteText) }],
      };
      await writeFile(join(target, MANIFEST), JSON.stringify(manifest), 'utf8');
      await mkdir(join(target, 'notes/a.md'), { recursive: true });

      expect(await storageErrorCode(() => validateBackup(target))).toBe('CORRUPT_BACKUP');
    });
  });

  it('rejects a symlinked backup entry that would escape the backup root', async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, 'backup');
      const outside = join(dir, 'outside.md');
      await mkdir(join(target, 'notes'), { recursive: true });
      await writeFile(outside, noteText, 'utf8');

      try {
        await symlink(outside, join(target, 'notes/a.md'), 'file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          console.warn('Skipping symlink test: OS denies symlink creation');
          return;
        }
        throw error;
      }

      const manifest = {
        format: 'nodus-backup',
        version: 1,
        createdAt: BACKUP_NOW,
        files: [{ kind: 'note', id: N1, path: 'notes/a.md', sha256: hash(noteText) }],
      };
      await writeFile(join(target, MANIFEST), JSON.stringify(manifest), 'utf8');

      expect(await storageErrorCode(() => validateBackup(target))).toBe('CORRUPT_BACKUP');
    });
  });
});

describe('restoreBackup', () => {
  it('restores notes and databases into an empty vault', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target);

      const restored = await FileSystemVault.open(join(dir, 'restored'));
      const report = await restoreBackup(target, restored.root);

      expect(report).toEqual({ notes: 1, databases: 1, databaseViews: 0 });
      expect(await readFile(join(restored.root, 'notes/a.md'), 'utf8')).toBe(noteText);
      expect(await restored.readNote(N1)).toMatchObject({ extraFrontmatter: { project: 'Research' } });
      expect(await restored.readDatabase(DB1)).toEqual(database);
    });
  });

  it('preserves nested and future nodus_data through backup validation and restore', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'vault'));
      const existing = await source.readNote(N1);
      await source.replaceNote({
        ...existing,
        extraFrontmatter: {
          ...existing.extraFrontmatter,
          vendorExtension: { keep: ['outside', { namespace: true }] },
          nodus_data: futureNodusData,
        },
      });
      const sourceBytes = await readFile(join(source.root, 'notes/a.md'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup, { now: BACKUP_NOW });

      const validation = await validateBackup(backup);
      expect(validation.entries.find((entry) => entry.kind === 'note')?.text).toBe(sourceBytes.toString('utf8'));

      const restored = await FileSystemVault.open(join(dir, 'restored'));
      await restoreBackup(backup, restored.root);

      expect(await readFile(join(restored.root, 'notes/a.md'))).toEqual(sourceBytes);
      const parsed = await restored.readNote(N1);
      expect(parsed.extraFrontmatter).toEqual({
        project: 'Research',
        vendorExtension: { keep: ['outside', { namespace: true }] },
        nodus_data: futureNodusData,
      });
    });
  });

  it('refuses to overwrite an existing note without explicit authorization', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target);
      const manifestBefore = await readFile(join(target, MANIFEST), 'utf8');

      const restored = await FileSystemVault.open(join(dir, 'restored'));
      const local = createNote({ id: N1, path: 'notes/a.md', title: 'Local', body: 'Local body\n', now: NOW });
      await restored.createNote(local);
      const localBefore = await readFile(join(restored.root, 'notes/a.md'), 'utf8');

      expect(await storageErrorCode(() => restoreBackup(target, restored.root))).toBe('CONFLICT');
      expect(await readFile(join(restored.root, 'notes/a.md'), 'utf8')).toBe(localBefore);
      expect(await readFile(join(target, MANIFEST), 'utf8')).toBe(manifestBefore);
    });
  });

  it('overwrites when explicitly authorized', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target);
      const restored = await FileSystemVault.open(join(dir, 'restored'));
      await restored.createNote(
        createNote({ id: N1, path: 'notes/a.md', title: 'Local', body: 'Local body\n', now: NOW }),
      );

      const report = await restoreBackup(target, restored.root, { overwrite: true });

      expect(report.notes).toBe(1);
      expect(await readFile(join(restored.root, 'notes/a.md'), 'utf8')).toBe(noteText);
    });
  });

  it('leaves the target untouched when backup validation fails', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target);
      await writeFile(join(target, 'notes/a.md'), 'tampered', 'utf8');
      const manifestBefore = await readFile(join(target, MANIFEST), 'utf8');

      const restoredRoot = join(dir, 'restored');
      expect(await storageErrorCode(() => restoreBackup(target, restoredRoot))).toBe('CORRUPT_BACKUP');
      expect(await exists(restoredRoot)).toBe(false);
      expect(await readFile(join(target, MANIFEST), 'utf8')).toBe(manifestBefore);
    });
  });

  it('refuses to restore into the backup directory or its parent relationship', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target);

      expect(await storageErrorCode(() => restoreBackup(target, join(target, 'vault')))).toBe('INVALID_INPUT');
    });
  });
});

describe('interrupted write detection', () => {
  it('reports leftover temporary files as an incomplete write', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await writeFile(join(dir, '.nodus-tmp-abc'), 'partial', 'utf8');

      expect((await vault.checkHealth()).issues).toEqual([
        expect.objectContaining({ code: 'INCOMPLETE_WRITE', path: '.nodus-tmp-abc' }),
      ]);
    });
  });
});

async function readManifestJson(target: string): Promise<any> {
  return JSON.parse(await readFile(join(target, MANIFEST), 'utf8'));
}

async function writeManifestJson(target: string, manifest: unknown): Promise<void> {
  await writeFile(join(target, MANIFEST), JSON.stringify(manifest), 'utf8');
}

async function writeLegacyManifest(target: string, files: unknown[]): Promise<void> {
  await writeManifestJson(target, {
    format: 'nodus-backup', version: 1, createdAt: BACKUP_NOW, files,
  });
}

async function expectRejectedRestoreLeavesTargetUntouched(backup: string, target: string): Promise<void> {
  const before = await readFile(join(target, 'keep.md'));
  await expect(restoreBackup(backup, target)).rejects.toMatchObject({ code: 'CORRUPT_BACKUP' });
  expect(await readFile(join(target, 'keep.md'))).toEqual(before);
  await expect(lstat(join(target, 'notes/a.md'))).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('backup path and byte validation', () => {
  it('rejects symlinked and broken manifest paths', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const backup = join(dir, 'backup');
      const target = join(dir, 'target');
      const externalManifest = join(dir, 'manifest.json');
      await createBackup(vault, backup);
      await mkdir(target);
      await writeFile(join(target, 'keep.md'), 'keep');
      await writeFile(externalManifest, await readFile(join(backup, MANIFEST)));
      await rm(join(backup, MANIFEST));
      try {
        await symlink(externalManifest, join(backup, MANIFEST));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }
      await expect(validateBackup(backup)).rejects.toMatchObject({ code: 'CORRUPT_BACKUP' });
      await expectRejectedRestoreLeavesTargetUntouched(backup, target);
      await rm(join(backup, MANIFEST));
      await symlink(join(dir, 'does-not-exist'), join(backup, MANIFEST));
      await expect(validateBackup(backup)).rejects.toMatchObject({ code: 'CORRUPT_BACKUP' });
      await expectRejectedRestoreLeavesTargetUntouched(backup, target);
    });
  });

  it('rejects a symlinked backup root', async () => {
    await withTempDir(async (dir) => {
      const actual = join(dir, 'actual');
      const link = join(dir, 'backup-link');
      const target = join(dir, 'target');
      await mkdir(actual);
      await mkdir(target);
      await writeFile(join(target, 'keep.md'), 'keep');
      try {
        await symlink(actual, link, 'dir');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }
      await expect(validateBackup(link)).rejects.toMatchObject({ code: 'CORRUPT_BACKUP' });
      await expectRejectedRestoreLeavesTargetUntouched(link, target);
    });
  });

  it('rejects symlinked and broken symlinked parent directories', async () => {
    await withTempDir(async (dir) => {
      const backup = join(dir, 'backup');
      const outside = join(dir, 'outside');
      await mkdir(join(backup, 'notes'), { recursive: true });
      await mkdir(outside);
      await writeFile(join(outside, 'a.md'), noteText);
      try {
        await rm(join(backup, 'notes'), { recursive: true });
        await symlink(outside, join(backup, 'notes'), 'dir');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }
      await writeLegacyManifest(backup, [{ kind: 'note', id: N1, path: 'notes/a.md', sha256: hash(noteText) }]);
      await expect(validateBackup(backup)).rejects.toMatchObject({ code: 'CORRUPT_BACKUP' });
      await rm(join(backup, 'notes'));
      await symlink(join(dir, 'missing-parent'), join(backup, 'notes'), 'dir');
      await expect(validateBackup(backup)).rejects.toMatchObject({ code: 'CORRUPT_BACKUP' });
      const target = join(dir, 'target');
      await mkdir(target);
      await writeFile(join(target, 'keep.md'), 'keep');
      await expectRejectedRestoreLeavesTargetUntouched(backup, target);
    });
  });

  it('rejects a symlinked parent before changing restore target', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const outside = join(dir, 'outside');
      await mkdir(outside);
      await writeFile(join(outside, 'a.md'), noteText);
      await rm(join(backup, 'notes'), { recursive: true });
      try {
        await symlink(outside, join(backup, 'notes'), 'dir');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }
      const target = join(dir, 'target');
      await mkdir(target);
      await writeFile(join(target, 'keep.md'), 'keep');
      await expectRejectedRestoreLeavesTargetUntouched(backup, target);
    });
  });

  it.each([
    ['traversal', '../escape.md'],
    ['reserved namespace', 'databases/escape.md'],
    ['hidden segment', 'notes/.hidden/a.md'],
  ])('rejects %s paths before restore mutation', async (_label, path) => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const manifest = await readManifestJson(backup);
      const files = manifest.files.map((file: { kind: string; path: string }) =>
        file.kind === 'note' ? { ...file, path } : file,
      );
      await writeLegacyManifest(backup, files);
      const target = join(dir, 'target');
      await mkdir(target);
      await writeFile(join(target, 'keep.md'), 'keep');
      await expectRejectedRestoreLeavesTargetUntouched(backup, target);
      if (_label === 'traversal') {
        await expect(lstat(join(dir, 'escape.md'))).rejects.toMatchObject({ code: 'ENOENT' });
      }
    });
  });

  it('rejects malformed UTF-8 with matching raw hash and byte length before restore', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const bytes = Buffer.from([0x66, 0x80, 0x6f]);
      await writeFile(join(backup, 'notes/a.md'), bytes);
      await writeLegacyManifest(backup, [{
        kind: 'note', id: N1, path: 'notes/a.md',
        sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength,
      }]);
      const target = join(dir, 'target');
      await mkdir(target);
      await writeFile(join(target, 'keep.md'), 'keep');
      await expectRejectedRestoreLeavesTargetUntouched(backup, target);
    });
  });

  it('rejects incorrect byte lengths before restore mutation', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const manifest = await readManifestJson(backup);
      const files = manifest.files.map((file: { kind: string; bytes?: number }) =>
        file.kind === 'note' ? { ...file, bytes: (file.bytes ?? 0) + 1 } : file,
      );
      await writeLegacyManifest(backup, files);
      const target = join(dir, 'target');
      await mkdir(target);
      await writeFile(join(target, 'keep.md'), 'keep');
      await expectRejectedRestoreLeavesTargetUntouched(backup, target);
    });
  });

  it('hashes and restores valid multibyte UTF-8 as original bytes', async () => {
    await withTempDir(async (dir) => {
      const sourceRoot = join(dir, 'source');
      const source = await seedVault(sourceRoot);
      const original = await readFile(join(sourceRoot, 'notes/a.md'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const saved = await readFile(join(backup, 'notes/a.md'));
      const entry = (await readManifestJson(backup)).files.find((file: { kind: string }) => file.kind === 'note');
      expect(saved).toEqual(original);
      expect(entry.bytes).toBe(original.byteLength);
      expect(entry.sha256).toBe(createHash('sha256').update(original).digest('hex'));
      const restored = join(dir, 'restored');
      await restoreBackup(backup, restored);
      expect(await readFile(join(restored, 'notes/a.md'))).toEqual(original);
    });
  });

  it('preserves a UTF-8 BOM through backup validation and restore with raw integrity metadata', async () => {
    await withTempDir(async (dir) => {
      const sourceRoot = join(dir, 'source');
      const source = await seedVault(sourceRoot);
      const sourcePath = join(sourceRoot, 'notes/a.md');
      const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile(sourcePath)]);
      await writeFile(sourcePath, original);

      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const manifest = await readManifestJson(backup);
      const file = manifest.files.find((entry: { kind: string }) => entry.kind === 'note');
      expect(file.bytes).toBe(original.byteLength);
      expect(file.sha256).toBe(createHash('sha256').update(original).digest('hex'));
      expect(manifest.digest).toBe(canonicalDigest(manifest));

      const validation = await validateBackup(backup);
      expect(validation.entries.find((entry) => entry.kind === 'note')?.text.charCodeAt(0)).toBe(0xfeff);
      const restored = join(dir, 'restored');
      await restoreBackup(backup, restored);
      expect(await readFile(join(restored, 'notes/a.md'))).toEqual(original);
    });
  });

  it('refuses to create a backup from malformed UTF-8 source bytes', async () => {
    await withTempDir(async (dir) => {
      const sourceRoot = join(dir, 'source');
      const source = await seedVault(sourceRoot);
      const valid = await readFile(join(sourceRoot, 'notes/a.md'));
      await writeFile(join(sourceRoot, 'notes/a.md'), Buffer.concat([valid, Buffer.from([0x80])]));
      const backup = join(dir, 'backup');

      await expect(createBackup(source, backup)).rejects.toThrow(/valid UTF-8/);
      await expect(lstat(backup)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });
});

describe('manifest metadata', () => {
  it('keeps reading existing v2 manifests declaring saved-view format v1', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target, { now: BACKUP_NOW });
      const manifest = await readManifestJson(target);
      manifest.formats.databaseView = 1;
      manifest.digest = canonicalDigest(manifest);
      await writeManifestJson(target, manifest);
      expect((await validateBackup(target)).manifest.formats?.databaseView).toBe(1);
    });
  });
  it('records actual UTF-8 byte lengths for non-ASCII content', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target, { now: BACKUP_NOW });

      const manifest = await readManifestJson(target);
      const noteEntry = manifest.files.find((file: { kind: string }) => file.kind === 'note');
      expect(noteEntry.bytes).toBe(Buffer.byteLength(noteText, 'utf8'));
      expect(noteEntry.bytes).toBeGreaterThan(noteText.length);
    });
  });

  it('validates a legacy v1 manifest without optional metadata', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target, { now: BACKUP_NOW });
      const manifest = await readManifestJson(target);
      await writeManifestJson(target, {
        format: manifest.format,
        version: 1,
        createdAt: manifest.createdAt,
        files: manifest.files.map(
          ({ kind, id, path, sha256 }: { kind: string; id: string; path: string; sha256: string }) => ({
            kind,
            id,
            path,
            sha256,
          }),
        ),
      });

      const validation = await validateBackup(target);

      expect(validation.manifest.app).toBeUndefined();
      expect(validation.manifest.formats).toBeUndefined();
      expect(validation.manifest.counts).toBeUndefined();
      expect(validation.manifest.digest).toBeUndefined();
      expect(validation.manifest.files[0]?.bytes).toBeUndefined();
      expect(validation.notes.map((note) => note.id)).toEqual([N1]);
      expect(validation.databases.map((entry) => entry.id)).toEqual([DB1]);
    });
  });

  it('produces a deterministic digest for identical inputs', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const first = join(dir, 'backup-1');
      const second = join(dir, 'backup-2');
      await createBackup(vault, first, { now: BACKUP_NOW });
      await createBackup(vault, second, { now: BACKUP_NOW });

      const manifestOne = await readManifestJson(first);
      const manifestTwo = await readManifestJson(second);

      expect(manifestOne.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(manifestOne.digest).toBe(manifestTwo.digest);
      expect(manifestOne.digest).toBe(canonicalDigest(manifestOne));
    });
  });

  it('rejects a manifest whose digest no longer matches', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target, { now: BACKUP_NOW });
      const manifest = await readManifestJson(target);
      manifest.createdAt = '2020-01-01T00:00:00.000Z';
      await writeManifestJson(target, manifest);

      await expect(validateBackup(target)).rejects.toMatchObject({
        code: 'CORRUPT_BACKUP',
        details: { issues: [expect.stringContaining('digest')] },
      });
    });
  });

  it('rejects a digest when file entries lack bytes', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target, { now: BACKUP_NOW });
      const manifest = await readManifestJson(target);
      manifest.files = manifest.files.map(
        ({ kind, id, path, sha256 }: { kind: string; id: string; path: string; sha256: string }) => ({
          kind,
          id,
          path,
          sha256,
        }),
      );
      await writeManifestJson(target, manifest);

      await expect(validateBackup(target)).rejects.toMatchObject({
        code: 'CORRUPT_BACKUP',
        details: { issues: [expect.stringContaining('byte lengths')] },
      });
    });
  });

  it('rejects counts that disagree with the file entries', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target, { now: BACKUP_NOW });
      const manifest = await readManifestJson(target);
      manifest.counts = { notes: 2, databases: 1, databaseViews: 0 };
      await writeManifestJson(target, manifest);

      await expect(validateBackup(target)).rejects.toMatchObject({
        code: 'CORRUPT_BACKUP',
        details: { issues: [expect.stringContaining('counts')] },
      });
    });
  });
});

describe('restore digest verification', () => {
  it('refuses a digest mismatch before writing anything to the target', async () => {
    await withTempDir(async (dir) => {
      const vault = await seedVault(join(dir, 'vault'));
      const target = join(dir, 'backup');
      await createBackup(vault, target, { now: BACKUP_NOW });
      const manifest = await readManifestJson(target);
      manifest.createdAt = '2020-01-01T00:00:00.000Z';
      await writeManifestJson(target, manifest);
      const manifestBefore = await readFile(join(target, MANIFEST), 'utf8');

      const restoredRoot = join(dir, 'restored');
      expect(await storageErrorCode(() => restoreBackup(target, restoredRoot))).toBe('CORRUPT_BACKUP');
      expect(await exists(restoredRoot)).toBe(false);
      expect(await readFile(join(target, MANIFEST), 'utf8')).toBe(manifestBefore);
    });
  });
});

describe('previewRestore', () => {
  it('reports counts and no conflicts against a disjoint vault', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup, { now: BACKUP_NOW });
      const live = await FileSystemVault.open(join(dir, 'live'));

      const preview = await previewRestore(backup, live);

      expect(preview.counts).toEqual({ notes: 1, databases: 1, databaseViews: 0 });
      expect(preview.conflicts).toEqual({ ids: [], paths: [] });
      expect(preview.manifest.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(preview.manifest.createdAt).toBe(BACKUP_NOW);
    });
  });

  it('reports id and path conflicts and writes nothing', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup, { now: BACKUP_NOW });

      const live = await FileSystemVault.open(join(dir, 'live'));
      await mkdir(join(live.root, 'notes'), { recursive: true });
      // Same path, different ID -> path conflict.
      await writeFile(join(live.root, 'notes/a.md'), noteText.replace(N1, N2), 'utf8');
      // Same ID, different path -> ID conflict.
      await writeFile(join(live.root, 'notes/other.md'), noteText, 'utf8');

      const liveBefore = JSON.stringify(await live.snapshot());
      const manifestBefore = await readFile(join(backup, MANIFEST), 'utf8');

      const preview = await previewRestore(backup, live);

      expect(preview.conflicts.ids).toEqual([N1]);
      expect(preview.conflicts.paths).toEqual(['notes/a.md']);
      expect(JSON.stringify(await live.snapshot())).toBe(liveBefore);
      expect(await readFile(join(backup, MANIFEST), 'utf8')).toBe(manifestBefore);
    });
  });

  it('rejects a corrupt backup without touching the live vault', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup, { now: BACKUP_NOW });
      await rm(join(backup, 'notes/a.md'));
      const live = await FileSystemVault.open(join(dir, 'live'));

      expect(await storageErrorCode(() => previewRestore(backup, live))).toBe('CORRUPT_BACKUP');
      expect(await live.snapshot()).toEqual([]);
    });
  });
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type WriteDocument = (
  this: FileSystemVault,
  path: string,
  text: string | Uint8Array,
  allowReserved?: boolean,
  beforeWrite?: () => Promise<void>,
) => Promise<void>;

function pauseWriteAt(pathToPause: string) {
  const entered = deferred();
  const release = deferred();
  const prototype = FileSystemVault.prototype as unknown as { writeDocument: WriteDocument };
  const original = prototype.writeDocument;
  let paused = false;
  const spy = vi.spyOn(prototype, 'writeDocument').mockImplementation(async function (
    this: FileSystemVault,
    path: string,
    text: string | Uint8Array,
    allowReserved?: boolean,
    beforeWrite?: () => Promise<void>,
  ) {
    if (!paused && path === pathToPause) {
      paused = true;
      entered.resolve();
      await release.promise;
    }
    return original.call(this, path, text, allowReserved, beforeWrite);
  });
  return { entered: entered.promise, release: () => release.resolve(), spy };
}

describe('restore mutation coordination', () => {
  it('serializes restore against note save across vault instances', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const targetRoot = join(dir, 'target');
      const target = await FileSystemVault.open(targetRoot);
      await target.createNote(createNote({ id: N1, path: 'notes/a.md', title: 'Before', body: 'Before\n', now: NOW }));

      const pause = pauseWriteAt('notes/a.md');
      try {
        const restoring = restoreBackup(backup, targetRoot, { overwrite: true });
        await pause.entered;
        const otherInstance = await FileSystemVault.open(targetRoot);
        const current = await otherInstance.readNote(N1);
        let saveFinished = false;
        const saving = otherInstance.replaceNote({ ...current, body: 'Saved after restore\n' }).finally(() => {
          saveFinished = true;
        });
        await Promise.resolve();
        expect(saveFinished).toBe(false);
        expect(await readFile(join(targetRoot, 'notes/a.md'), 'utf8')).toContain('Before');

        pause.release();
        await restoring;
        await saving;
        expect(await target.readNote(N1)).toMatchObject({ body: 'Saved after restore\n' });
      } finally {
        pause.release();
        pause.spy.mockRestore();
      }
    });
  });

  it('serializes restore against note create and keeps overwrite false safe', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const targetRoot = join(dir, 'target');
      const target = await FileSystemVault.open(targetRoot);

      const pause = pauseWriteAt('notes/a.md');
      try {
        const restoring = restoreBackup(backup, targetRoot);
        await pause.entered;
        const otherInstance = await FileSystemVault.open(targetRoot);
        const creating = otherInstance.createNote(
          createNote({ id: N2, path: 'notes/a.md', title: 'Concurrent', body: 'Concurrent\n', now: NOW }),
        );
        pause.release();

        await restoring;
        await expect(creating).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(await target.readNote(N1)).toMatchObject({ body: 'Café 日本語 🙂\n\n```\n[[Link]]\n```\n' });
      } finally {
        pause.release();
        pause.spy.mockRestore();
      }
    });
  });

  it('serializes restore against note delete across vault instances', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const targetRoot = join(dir, 'target');
      const target = await FileSystemVault.open(targetRoot);
      await target.createNote(createNote({ id: N1, path: 'notes/a.md', title: 'Before', body: 'Before\n', now: NOW }));

      const pause = pauseWriteAt('notes/a.md');
      try {
        const restoring = restoreBackup(backup, targetRoot, { overwrite: true });
        await pause.entered;
        const otherInstance = await FileSystemVault.open(targetRoot);
        let deleteFinished = false;
        const deleting = otherInstance.deleteNote(N1).finally(() => {
          deleteFinished = true;
        });
        await Promise.resolve();
        expect(deleteFinished).toBe(false);
        pause.release();
        await restoring;
        await deleting;
        await expect(target.readNote(N1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      } finally {
        pause.release();
        pause.spy.mockRestore();
      }
    });
  });

  it('serializes two competing restores', async () => {
    await withTempDir(async (dir) => {
      const sourceOne = await seedVault(join(dir, 'source-one'));
      const backupOne = join(dir, 'backup-one');
      await createBackup(sourceOne, backupOne);
      const sourceTwo = await seedVault(join(dir, 'source-two'));
      await writeFile(join(sourceTwo.root, 'notes/a.md'), noteText.replace('Café', 'Second restore'));
      const backupTwo = join(dir, 'backup-two');
      await createBackup(sourceTwo, backupTwo);
      const targetRoot = join(dir, 'target');
      const target = await FileSystemVault.open(targetRoot);

      const pause = pauseWriteAt('notes/a.md');
      try {
        const first = restoreBackup(backupOne, targetRoot);
        await pause.entered;
        const second = restoreBackup(backupTwo, targetRoot, { overwrite: true });
        pause.release();
        await Promise.all([first, second]);
        expect(await target.readNote(N1)).toMatchObject({ body: expect.stringContaining('Second restore') });
      } finally {
        pause.release();
        pause.spy.mockRestore();
      }
    });
  });

  it('detects target content changed after import preflight', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const targetRoot = join(dir, 'target');
      const target = await FileSystemVault.open(targetRoot);
      await target.createNote(createNote({ id: N1, path: 'notes/a.md', title: 'Before', body: 'Before\n', now: NOW }));

      const pause = pauseWriteAt('notes/a.md');
      try {
        const restoring = restoreBackup(backup, targetRoot, { overwrite: true });
        await pause.entered;
        const concurrentText = noteText.replace('Café', 'External change');
        await writeFile(join(targetRoot, 'notes/a.md'), concurrentText);
        pause.release();
        await expect(restoring).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(await readFile(join(targetRoot, 'notes/a.md'), 'utf8')).toBe(concurrentText);
      } finally {
        pause.release();
        pause.spy.mockRestore();
      }
    });
  });

  it('does not overwrite a path that appears after overwrite-false preflight', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const targetRoot = join(dir, 'target');
      await FileSystemVault.open(targetRoot);

      const pause = pauseWriteAt('notes/a.md');
      try {
        const restoring = restoreBackup(backup, targetRoot);
        await pause.entered;
        const concurrentText = noteText.replace(N1, N2).replace('Café', 'Concurrent writer');
        await mkdir(join(targetRoot, 'notes'), { recursive: true });
        await writeFile(join(targetRoot, 'notes/a.md'), concurrentText);
        pause.release();
        await expect(restoring).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(await readFile(join(targetRoot, 'notes/a.md'), 'utf8')).toBe(concurrentText);
      } finally {
        pause.release();
        pause.spy.mockRestore();
      }
    });
  });

  it('keeps overwrite true exact-path behavior and rejects normalized collisions', async () => {
    await withTempDir(async (dir) => {
      const sourceRoot = join(dir, 'source');
      const source = await FileSystemVault.open(sourceRoot);
      await source.createNote(createNote({ id: N1, path: 'notes/A.md', title: 'Backup', body: 'Backup\n', now: NOW }));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const targetRoot = join(dir, 'target');
      const target = await FileSystemVault.open(targetRoot);
      await target.createNote(createNote({ id: N2, path: 'notes/a.md', title: 'Local', body: 'Local\n', now: NOW }));
      const before = await readFile(join(targetRoot, 'notes/a.md'), 'utf8');

      await expect(restoreBackup(backup, targetRoot, { overwrite: true })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await readFile(join(targetRoot, 'notes/a.md'), 'utf8')).toBe(before);
    });
  });

  it('rejects overwrite at an exact path when note IDs differ', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      await source.createNote(createNote({ id: N1, path: 'notes/a.md', title: 'Backup', body: 'Backup\n', now: NOW }));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const targetRoot = join(dir, 'target');
      const target = await FileSystemVault.open(targetRoot);
      await target.createNote(createNote({ id: N2, path: 'notes/a.md', title: 'Local', body: 'Local\n', now: NOW }));
      const before = await readFile(join(targetRoot, 'notes/a.md'), 'utf8');

      await expect(restoreBackup(backup, targetRoot, { overwrite: true })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await readFile(join(targetRoot, 'notes/a.md'), 'utf8')).toBe(before);
    });
  });
});

describe('restore partial-write reporting', () => {
  it('reports a failed write and prior write without claiming retry recovery', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      await source.createNote(createNote({ id: N2, path: 'notes/b.md', title: 'Second', body: 'Second\n', now: NOW }));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const targetRoot = join(dir, 'target');
      await FileSystemVault.open(targetRoot);
      const prototype = FileSystemVault.prototype as unknown as { writeDocument: WriteDocument };
      const original = prototype.writeDocument;
      const databasePath = `databases/${DB1}.json`;
      const spy = vi.spyOn(prototype, 'writeDocument').mockImplementation(async function (
        this: FileSystemVault,
        path: string,
        text: string | Uint8Array,
        allowReserved?: boolean,
        beforeWrite?: () => Promise<void>,
      ) {
        if (path === databasePath) throw new Error('injected write failure');
        return original.call(this, path, text, allowReserved, beforeWrite);
      });
      try {
        await expect(restoreBackup(backup, targetRoot)).rejects.toMatchObject({
          code: 'PARTIAL_WRITE',
          details: { paths: ['notes/a.md', 'notes/b.md', databasePath] },
          message: expect.not.stringMatching(/retry|recover automatically/i),
        });
        expect(await readFile(join(targetRoot, 'notes/a.md'), 'utf8')).toBe(noteText);
        await expect(lstat(join(targetRoot, databasePath))).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('reports stale-path deletion failure and duplicate-ID risk after a move', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const targetRoot = join(dir, 'target');
      const target = await FileSystemVault.open(targetRoot);
      await target.createNote(createNote({ id: N1, path: 'notes/old.md', title: 'Old', body: 'Old\n', now: NOW }));
      const prototype = FileSystemVault.prototype as unknown as {
        removeDocument: (this: FileSystemVault, path: string, expectedHash: string | undefined) => Promise<void>;
      };
      const original = prototype.removeDocument;
      const spy = vi.spyOn(prototype, 'removeDocument').mockImplementation(async function (
        this: FileSystemVault,
        path: string,
        expectedHash: string | undefined,
      ) {
        if (path === 'notes/old.md') throw new Error('injected stale delete failure');
        return original.call(this, path, expectedHash);
      });
      try {
        await expect(restoreBackup(backup, targetRoot, { overwrite: true })).rejects.toMatchObject({
          code: 'PARTIAL_WRITE',
          details: { paths: ['notes/a.md', `databases/${DB1}.json`, 'notes/old.md'] },
        });
        expect(await readFile(join(targetRoot, 'notes/a.md'), 'utf8')).toBe(noteText);
        expect(await readFile(join(targetRoot, 'notes/old.md'), 'utf8')).toContain('Old');
        expect((await target.checkHealth()).issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATE_ID' })]),
        );
      } finally {
        spy.mockRestore();
      }
    });
  });
});
