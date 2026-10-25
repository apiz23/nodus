import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DatabaseDefinition } from '../src/database/schema.js';
import { serializeDatabase } from '../src/database/schema.js';
import { createNote } from '../src/domain/note.js';
import { createHash } from 'node:crypto';
import { createBackup, restoreBackup, validateBackup } from '../src/storage/backup/backup.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { withTempDir } from './tmp.js';
import { storageErrorCode } from './helpers.js';

const NOW = '2026-10-25T09:00:00Z';
const BACKUP_NOW = '2026-10-25T12:00:00Z';
const N1 = '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';
const DB1 = '9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73';
const PROP1 = '1f0c7d2a-0b1e-4c3d-9a8f-5e6d7c8b9a01';

const noteText = `---\ntitle: Backup\nproject: Research\nnodus:\n  version: 1\n  id: ${N1}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\nCafé 日本語 🙂\n\n\`\`\`\n[[Link]]\n\`\`\`\n`;

const database: DatabaseDefinition = {
  id: DB1,
  name: 'Reading list',
  properties: [{ id: PROP1, name: 'Title', type: 'text' }],
};

const MANIFEST = 'nodus-backup.json';

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
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

      expect(report).toEqual({ targetDir: target, notes: 1, databases: 1 });
      expect(await readFile(join(target, 'notes/a.md'), 'utf8')).toBe(noteText);

      const manifest = JSON.parse(await readFile(join(target, MANIFEST), 'utf8'));
      expect(manifest).toEqual({
        format: 'nodus-backup',
        version: 1,
        createdAt: BACKUP_NOW,
        files: [
          { kind: 'note', id: N1, path: 'notes/a.md', sha256: hash(noteText) },
          {
            kind: 'database',
            id: DB1,
            path: `databases/${DB1}.json`,
            sha256: hash(serializeDatabase(database)),
          },
        ],
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
      await writeFile(join(vault.root, 'broken.md'), '# broken\n', 'utf8');
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
      await writeFile(join(target, MANIFEST), JSON.stringify({ ...manifest, version: 2 }), 'utf8');

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

      expect(report).toEqual({ notes: 1, databases: 1 });
      expect(await readFile(join(restored.root, 'notes/a.md'), 'utf8')).toBe(noteText);
      expect(await restored.readNote(N1)).toMatchObject({ extraFrontmatter: { project: 'Research' } });
      expect(await restored.readDatabase(DB1)).toEqual(database);
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
