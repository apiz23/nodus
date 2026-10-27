import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DatabaseDefinition } from '../src/database/schema.js';
import { serializeDatabase } from '../src/database/schema.js';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { exportVault } from '../src/storage/portable/export.js';
import { applyImport, planImport } from '../src/storage/portable/import.js';
import { withTempDir } from './tmp.js';
import { storageErrorCode } from './helpers.js';

const NOW = '2026-10-25T09:00:00Z';
const N1 = '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';
const N2 = '0b7c9e1a-2d3f-4a5b-8c6d-7e8f9a0b1c2d';
const DB1 = '9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73';
const PROP1 = '1f0c7d2a-0b1e-4c3d-9a8f-5e6d7c8b9a01';

const note = (id: string, path: string, body = 'Body\n') =>
  createNote({ id, path, title: `Note ${id.slice(0, 4)}`, body, now: NOW });

const database: DatabaseDefinition = {
  id: DB1,
  name: 'Reading list',
  properties: [{ id: PROP1, name: 'Title', type: 'text' }],
};

const noteWithExtra = `---\ntitle: Portable\ntags:\n  - keep\nproject: Research\nnodus:\n  version: 1\n  id: ${N2}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\nCafé 日本語 🙂\n\n\`\`\`ts\nconst link = "[[Target]]";\n\`\`\`\n`;

describe('exportVault', () => {
  it('mirrors notes and database definitions into a valid vault layout', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      await vault.createNote(note(N1, 'notes/a.md', 'Café\n'));
      await vault.createDatabase(database);

      const target = join(dir, 'export');
      const report = await exportVault(vault, target);

      expect(report).toEqual({ targetDir: target, notes: 1, databases: 1 });
      expect(await readFile(join(target, 'notes/a.md'), 'utf8')).toBe(await readFile(join(vault.root, 'notes/a.md'), 'utf8'));
      expect(await readFile(join(target, 'databases', `${DB1}.json`), 'utf8')).toBe(serializeDatabase(database));
    });
  });

  it('refuses a target inside the vault', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      expect(await storageErrorCode(() => exportVault(vault, join(dir, 'export')))).toBe('INVALID_INPUT');
    });
  });

  it('refuses to write into a non-empty target', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      await vault.createNote(note(N1, 'a.md'));
      const target = join(dir, 'export');
      await mkdir(target);
      await writeFile(join(target, 'user.txt'), 'keep me', 'utf8');

      expect(await storageErrorCode(() => exportVault(vault, target))).toBe('CONFLICT');
      expect(await readFile(join(target, 'user.txt'), 'utf8')).toBe('keep me');
    });
  });

  it('fails instead of exporting a vault with corrupt notes', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      await writeFile(join(vault.root, 'broken.md'), '---\ntitle: [broken\nnodus:\n  version: 1\n---\nBody\n', 'utf8');

      expect(await storageErrorCode(() => exportVault(vault, join(dir, 'export')))).toBe('INVALID_CONTENT');
    });
  });
});

describe('planImport', () => {
  it('validates an entire import without writing anything', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      await vault.createNote(note(N1, 'notes/a.md'));
      await vault.createDatabase(database);
      const source = join(dir, 'export');
      await exportVault(vault, source);

      const plan = await planImport(source);

      expect(plan.notes.map((entry) => entry.id)).toEqual([N1]);
      expect(plan.databases.map((entry) => entry.id)).toEqual([DB1]);
      expect(await readdir(source)).toEqual(['databases', 'notes']);
    });
  });

  it('reports a missing source directory', async () => {
    await withTempDir(async (dir) => {
      expect(await storageErrorCode(() => planImport(join(dir, 'missing')))).toBe('NOT_FOUND');
    });
  });

  it('rejects a malformed note', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source);
      await writeFile(join(source, 'bad.md'), '---\ntitle: [broken\nnodus:\n  version: 1\n---\nBody\n', 'utf8');

      expect(await storageErrorCode(() => planImport(source))).toBe('INVALID_CONTENT');
    });
  });

  it('imports mixed plain Markdown and Nodus notes without changing the source files', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(join(source, 'daily'), { recursive: true });
      const plain = '# Internship day\n\nTask notes: Café 🙂\n';
      await writeFile(join(source, 'daily/2026-08-03.md'), plain, 'utf8');
      await writeFile(join(source, 'managed.md'), noteWithExtra, 'utf8');

      const plan = await planImport(source);
      const plainNote = plan.notes.find(({ path }) => path === 'daily/2026-08-03.md');
      expect(plainNote?.title).toBe('2026-08-03');
      expect(plainNote?.body).toBe(plain);
      expect(plan.notes.find(({ path }) => path === 'managed.md')?.id).toBe(N2);
      expect(await readFile(join(source, 'daily/2026-08-03.md'), 'utf8')).toBe(plain);

      const target = await FileSystemVault.open(join(dir, 'target'));
      await applyImport(target, plan);
      expect((await target.readNote(plainNote!.id)).body).toBe(plain);
      expect(await readFile(join(target.root, 'daily/2026-08-03.md'), 'utf8')).toBe(plain);
    });
  });

  it('rejects an unsupported note version', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source);
      await writeFile(
        join(source, 'future.md'),
        `---\ntitle: Future\nnodus:\n  version: 2\n  id: ${N1}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\nBody\n`,
        'utf8',
      );

      expect(await storageErrorCode(() => planImport(source))).toBe('UNSUPPORTED_VERSION');
    });
  });

  it('rejects duplicate note IDs inside one import', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source);
      const text = `---\ntitle: Same\nnodus:\n  version: 1\n  id: ${N1}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\nBody\n`;
      await writeFile(join(source, 'a.md'), text, 'utf8');
      await writeFile(join(source, 'b.md'), text, 'utf8');

      expect(await storageErrorCode(() => planImport(source))).toBe('DUPLICATE_ID');
    });
  });

  it('rejects a database file whose name does not match its ID', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(join(source, 'databases'), { recursive: true });
      await writeFile(join(source, 'databases', 'wrong.json'), JSON.stringify(database), 'utf8');

      expect(await storageErrorCode(() => planImport(source))).toBe('INVALID_CONTENT');
    });
  });

  it('rejects leftover temporary files in the import source', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source);
      await writeFile(join(source, 'a.md'), noteWithExtra, 'utf8');
      await writeFile(join(source, '.nodus-tmp-abc'), 'partial', 'utf8');

      expect(await storageErrorCode(() => planImport(source))).toBe('INVALID_CONTENT');
    });
  });

  it('preserves unknown frontmatter, Unicode, and body bytes', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source);
      await writeFile(join(source, 'portable.md'), noteWithExtra, 'utf8');

      const plan = await planImport(source);
      expect(plan.entries[0]?.text).toBe(noteWithExtra);
      expect(plan.notes[0]?.extraFrontmatter).toEqual({ project: 'Research' });
    });
  });
});

describe('applyImport', () => {
  it('imports notes and databases into another vault', async () => {
    await withTempDir(async (dir) => {
      const sourceVault = await FileSystemVault.open(join(dir, 'source-vault'));
      await sourceVault.createNote(note(N1, 'notes/a.md', 'Café 日本語\n'));
      await sourceVault.createDatabase(database);
      const source = join(dir, 'export');
      await exportVault(sourceVault, source);

      const target = await FileSystemVault.open(join(dir, 'target-vault'));
      const plan = await planImport(source);
      const report = await applyImport(target, plan);

      expect(report).toEqual({ notes: 1, databases: 1 });
      expect(await target.readNote(N1)).toMatchObject({ path: 'notes/a.md', body: 'Café 日本語\n' });
      expect(await target.readDatabase(DB1)).toEqual(database);
    });
  });

  it('rejects conflicts by default and writes nothing', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source);
      await writeFile(join(source, 'a.md'), noteWithExtra, 'utf8');
      const plan = await planImport(source);

      const target = await FileSystemVault.open(join(dir, 'target'));
      await target.createNote(note(N2, 'a.md', 'Original\n'));
      const before = await readFile(join(target.root, 'a.md'), 'utf8');

      expect(await storageErrorCode(() => applyImport(target, plan))).toBe('CONFLICT');
      expect(await readFile(join(target.root, 'a.md'), 'utf8')).toBe(before);
      expect(await readdir(target.root)).toEqual(['a.md']);
    });
  });

  it('detects an ID conflict at a different path before writing', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source);
      await writeFile(join(source, 'new.md'), noteWithExtra, 'utf8');
      const plan = await planImport(source);

      const target = await FileSystemVault.open(join(dir, 'target'));
      await target.createNote(note(N2, 'existing.md', 'Original\n'));

      expect(await storageErrorCode(() => applyImport(target, plan))).toBe('CONFLICT');
      expect(await target.listNotes()).toHaveLength(1);
      expect((await target.readNote(N2)).path).toBe('existing.md');
    });
  });

  it('replaces an existing note only with explicit overwrite', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source);
      await writeFile(join(source, 'a.md'), noteWithExtra, 'utf8');
      const plan = await planImport(source);

      const target = await FileSystemVault.open(join(dir, 'target'));
      await target.createNote(note(N2, 'a.md', 'Original\n'));

      const report = await applyImport(target, plan, { overwrite: true });

      expect(report.notes).toBe(1);
      expect((await target.readNote(N2)).body).toContain('Café');
      expect((await target.readNote(N2)).extraFrontmatter).toEqual({ project: 'Research' });
    });
  });

  it('leaves unrelated files untouched', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source);
      await writeFile(join(source, 'a.md'), noteWithExtra, 'utf8');
      const plan = await planImport(source);

      const target = await FileSystemVault.open(join(dir, 'target'));
      await writeFile(join(target.root, 'user.txt'), 'keep me', 'utf8');

      await applyImport(target, plan);
      expect(await readFile(join(target.root, 'user.txt'), 'utf8')).toBe('keep me');
    });
  });

  it('detects a path that collides only by case', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source);
      await writeFile(join(source, 'A.md'), noteWithExtra, 'utf8');
      const plan = await planImport(source);

      const target = await FileSystemVault.open(join(dir, 'target'));
      await target.createNote(note(N1, 'a.md', 'Original\n'));

      expect(await storageErrorCode(() => applyImport(target, plan))).toBe('CONFLICT');
      expect((await target.readNote(N1)).path).toBe('a.md');
    });
  });

  it('rejects a case-only collision with overwrite: true when IDs differ', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source);
      await writeFile(join(source, 'A.md'), noteWithExtra, 'utf8');
      const plan = await planImport(source);

      const target = await FileSystemVault.open(join(dir, 'target'));
      await target.createNote(note(N1, 'a.md', 'Original\n'));
      const before = await readFile(join(target.root, 'a.md'), 'utf8');

      expect(await storageErrorCode(() => applyImport(target, plan, { overwrite: true }))).toBe('CONFLICT');
      expect((await target.readNote(N1)).body).toBe('Original\n');
      expect(await readFile(join(target.root, 'a.md'), 'utf8')).toBe(before);
    });
  });

  it('does not delete unrelated notes when overwriting an imported note', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source);
      await writeFile(join(source, 'new.md'), noteWithExtra, 'utf8');
      const plan = await planImport(source);

      const target = await FileSystemVault.open(join(dir, 'target'));
      await target.createNote(note(N1, 'keep.md', 'Keep me\n'));
      await target.createNote(note(N2, 'old.md', 'Old body\n'));

      await applyImport(target, plan, { overwrite: true });

      expect(await target.readNote(N1)).toMatchObject({ path: 'keep.md', body: 'Keep me\n' });
      expect((await target.readNote(N2)).path).toBe('new.md');
      expect(await storageErrorCode(() => target.readNoteAtPath('old.md'))).toBe('NOT_FOUND');
    });
  });

  it('applies one validated plan to two different vaults', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source);
      await writeFile(join(source, 'a.md'), noteWithExtra, 'utf8');
      const plan = await planImport(source);

      const first = await FileSystemVault.open(join(dir, 'one'));
      const second = await FileSystemVault.open(join(dir, 'two'));
      await applyImport(first, plan);
      await applyImport(second, plan);

      expect((await first.readNote(N2)).id).toBe(N2);
      expect((await second.readNote(N2)).id).toBe(N2);
    });
  });
});
