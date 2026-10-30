import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import type { DatabaseDefinition } from '../src/database/schema.js';
import type { DatabaseView } from '../src/database/database-view.js';
import {
  PROPERTY_CATALOG_PATH,
  projectPropertyValues,
  type NotePropertyDefinition,
} from '../src/properties/catalog.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createBackup, previewRestore, restoreBackup, validateBackup } from '../src/storage/backup/backup.js';
import { exportVault } from '../src/storage/portable/export.js';
import { applyImport, planImport } from '../src/storage/portable/import.js';
import { databaseViewPath } from '../src/storage/fs/layout.js';
import { buildSearchIndex, searchIndex } from '../src/search/search-index.js';
import { validateNoteFilters } from '../src/search/note-filters.js';
import { withTempDir } from './tmp.js';
import { storageErrorCode } from './helpers.js';

const NOW = '2026-12-01T09:00:00Z';
const LATER = '2026-12-02T09:00:00Z';
const NOTE_A = '11111111-1111-4111-8111-111111111111';
const NOTE_B = '22222222-2222-4222-8222-222222222222';
const TEXT = '33333333-3333-4333-8333-333333333333';
const NUMBER = '44444444-4444-4444-8444-444444444444';
const CHECKBOX = '55555555-5555-4555-8555-555555555555';
const DATE = '66666666-6666-4666-8666-666666666666';
const SELECT = '77777777-7777-4777-8777-777777777777';
const MULTI = '88888888-8888-4888-8888-888888888888';
const URL = '99999999-9999-4999-8999-999999999999';
const OPEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DONE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOPIC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DB_PROP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DB_OPTION = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const VIEW = '12121212-1212-4212-8212-121212121212';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

const definitions: NotePropertyDefinition[] = [
  { id: TEXT, key: 'summary', name: 'Summary', type: 'text' },
  { id: NUMBER, key: 'estimate', name: 'Estimate', type: 'number' },
  { id: CHECKBOX, key: 'reviewed', name: 'Reviewed', type: 'checkbox' },
  { id: DATE, key: 'due', name: 'Due', type: 'date' },
  { id: SELECT, key: 'status', name: 'Status', type: 'select', options: [{ id: OPEN, label: 'Open' }, { id: DONE, label: 'Done' }] },
  { id: MULTI, key: 'topics', name: 'Topics', type: 'multi-select', options: [{ id: TOPIC, label: 'Research' }] },
  { id: URL, key: 'homepage', name: 'Homepage', type: 'url' },
];

const database: DatabaseDefinition = {
  id: DB,
  name: 'Reading list',
  properties: [{ id: DB_PROP, name: 'State', type: 'select', options: [{ id: DB_OPTION, name: 'Ready' }] }],
};

const view: DatabaseView = {
  id: VIEW,
  databaseId: DB,
  name: 'Ready to read',
  sort: { propertyId: DB_PROP, direction: 'asc' },
  filters: [{ id: '34343434-3434-4434-8434-343434343434', propertyId: DB_PROP, operator: 'is', value: DB_OPTION }],
  visiblePropertyIds: [DB_PROP],
};

async function createCatalog(vault: FileSystemVault, properties: NotePropertyDefinition[] = definitions): Promise<{ text: string; hash: string }> {
  let currentHash: string | null = null;
  for (const property of properties) {
    currentHash = (await vault.mutatePropertyCatalog({ type: 'create-property', property }, currentHash)).hash;
  }
  return { text: await readFile(join(vault.root, PROPERTY_CATALOG_PATH), 'utf8'), hash: currentHash! };
}

async function seedRichVault(root: string): Promise<{ vault: FileSystemVault; catalog: { text: string; hash: string }; attachmentPath: string }> {
  const vault = await FileSystemVault.open(root);
  const catalog = await createCatalog(vault);
  const attachment = await vault.createAttachment('diagram.png', PNG);
  await vault.createDatabase(database);
  await vault.createDatabaseView(view);
  const noteA = {
    ...createNote({ id: NOTE_A, title: 'Metadata note', path: 'notes/metadata.md', body: '# Body\n\nPortable metadata.\n', now: NOW, tags: ['Planning', 'Research'], aliases: ['Metadata alias'] }),
    extraFrontmatter: {
      summary: '',
      estimate: 0,
      reviewed: false,
      due: '2024-02-29',
      status: 'Open',
      topics: [],
      homepage: 'https://example.test/path',
      customField: { keep: ['unknown', { nested: true }] },
    },
  };
  const noteB = {
    ...createNote({ id: NOTE_B, title: 'Sparse note', path: 'notes/sparse.md', body: 'Only custom metadata.\n', now: LATER }),
    extraFrontmatter: { legacy: 'unregistered', other: { keep: true } },
  };
  await vault.createNote(noteA);
  await vault.createNote(noteB);
  return { vault, catalog, attachmentPath: attachment.path };
}

async function searchAfterRestore(vault: FileSystemVault): Promise<void> {
  const notes = await vault.snapshotNotes();
  const { catalog } = await vault.readPropertyCatalogWithHash();
  const index = buildSearchIndex(notes, catalog);
  expect(searchIndex(index, 'Portable metadata')).toHaveLength(1);
  expect(searchIndex(index, 'Research')[0]?.match.field).toBe('tag');
  expect(searchIndex(index, 'Homepage')[0]?.snippet).toContain('Homepage:');
  const filters = validateNoteFilters([{ type: 'property', propertyId: SELECT, operator: 'is', value: 'Open' }], catalog);
  expect(searchIndex(index, '', 50, filters).map((result) => result.id)).toEqual([NOTE_A]);
  const falseFilters = validateNoteFilters([{ type: 'property', propertyId: CHECKBOX, operator: 'is-unchecked' }], catalog);
  expect(searchIndex(index, '', 50, falseFilters).map((result) => result.id)).toEqual([NOTE_A]);
}

describe('metadata backup and restore', { timeout: 20_000 }, () => {
  it('backs up and restores the catalog, all property values, attachments, databases, and views', async () => {
    await withTempDir(async (dir) => {
      const { vault, catalog, attachmentPath } = await seedRichVault(join(dir, 'vault'));
      const backup = join(dir, 'backup');

      expect(await createBackup(vault, backup, { now: NOW })).toMatchObject({ notes: 2, databases: 1, databaseViews: 1, attachments: 1, propertyCatalog: 1 });
      const manifest = JSON.parse(await readFile(join(backup, 'nodus-backup.json'), 'utf8'));
      expect(manifest.version).toBe(4);
      expect(manifest.formats).toMatchObject({ backup: 4, propertyCatalog: 1 });
      expect(manifest.counts.propertyCatalog).toBe(1);
      expect(manifest.propertyCatalog).toMatchObject({
        path: PROPERTY_CATALOG_PATH,
        format: 'nodus-property-catalog',
        version: 1,
        properties: definitions.length,
        sha256: catalog.hash,
      });
      expect(await readFile(join(backup, PROPERTY_CATALOG_PATH), 'utf8')).toBe(catalog.text);

      const validation = await validateBackup(backup);
      expect(validation.propertyCatalog?.text).toBe(catalog.text);
      expect(validation.propertyCatalog?.catalog.properties).toHaveLength(definitions.length);
      expect(validation.entries.find((entry) => entry.kind === 'attachment')?.rawBytes).toEqual(PNG);

      const restored = await FileSystemVault.open(join(dir, 'restored'));
      const preview = await previewRestore(backup, restored);
      expect(preview.counts).toMatchObject({ notes: 2, databases: 1, databaseViews: 1, attachments: 1, propertyCatalog: 1 });
      expect(preview.propertyCatalog).toMatchObject({ version: 1, properties: definitions.length, hash: catalog.hash, conflict: false });
      expect(preview.conflicts).toEqual({ ids: [], paths: [] });

      expect(await restoreBackup(backup, restored.root)).toMatchObject({ notes: 2, databases: 1, databaseViews: 1, attachments: 1, propertyCatalog: 1 });
      expect(await readFile(join(restored.root, PROPERTY_CATALOG_PATH), 'utf8')).toBe(catalog.text);
      expect(await readFile(join(restored.root, attachmentPath))).toEqual(PNG);

      const noteA = await restored.readNote(NOTE_A);
      expect(noteA.tags).toEqual(['Planning', 'Research']);
      expect(noteA.aliases).toEqual(['Metadata alias']);
      expect(noteA.extraFrontmatter).toEqual({
        summary: '',
        estimate: 0,
        reviewed: false,
        due: '2024-02-29',
        status: 'Open',
        topics: [],
        homepage: 'https://example.test/path',
        customField: { keep: ['unknown', { nested: true }] },
      });
      expect((await restored.readNote(NOTE_B)).extraFrontmatter).toEqual({ legacy: 'unregistered', other: { keep: true } });
      expect(await restored.readDatabase(DB)).toEqual(database);
      expect((await restored.listDatabaseViews(DB))[0]?.view).toEqual(view);
      expect(await readFile(join(restored.root, databaseViewPath(DB, VIEW)), 'utf8')).toBe(await readFile(join(vault.root, databaseViewPath(DB, VIEW)), 'utf8'));

      const restoredCatalog = await restored.readPropertyCatalogWithHash();
      expect(projectPropertyValues(restoredCatalog.catalog, noteA.extraFrontmatter)).toMatchObject({
        values: {
          [TEXT]: '', [NUMBER]: 0, [CHECKBOX]: false, [DATE]: '2024-02-29',
          [SELECT]: 'Open', [MULTI]: [], [URL]: 'https://example.test/path',
        },
        issues: [],
        unregisteredKeys: ['customField'],
      });
      await searchAfterRestore(restored);
    });
  });

  it('rejects malformed and future catalogs before writing a backup', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      await mkdir(join(vault.root, 'properties'), { recursive: true });
      await writeFile(join(vault.root, PROPERTY_CATALOG_PATH), '{broken', 'utf8');
      expect(await storageErrorCode(() => createBackup(vault, join(dir, 'malformed')))).toBe('INVALID_CONTENT');
      await expect(readFile(join(dir, 'malformed', 'nodus-backup.json'))).rejects.toMatchObject({ code: 'ENOENT' });

      await writeFile(join(vault.root, PROPERTY_CATALOG_PATH), JSON.stringify({ format: 'nodus-property-catalog', version: 8, properties: [] }), 'utf8');
      expect(await storageErrorCode(() => createBackup(vault, join(dir, 'future')))).toBe('UNSUPPORTED_VERSION');
      await expect(readFile(join(dir, 'future', 'nodus-backup.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('rejects corrupted catalog bytes and leaves the restore target untouched', async () => {
    await withTempDir(async (dir) => {
      const { vault } = await seedRichVault(join(dir, 'vault'));
      const backup = join(dir, 'backup');
      await createBackup(vault, backup);
      await writeFile(join(backup, PROPERTY_CATALOG_PATH), JSON.stringify({ format: 'nodus-property-catalog', version: 1, properties: [] }), 'utf8');
      const target = join(dir, 'target');
      await mkdir(target);
      await writeFile(join(target, 'keep.txt'), 'keep');
      expect(await storageErrorCode(() => validateBackup(backup))).toBe('CORRUPT_BACKUP');
      expect(await storageErrorCode(() => restoreBackup(backup, target))).toBe('CORRUPT_BACKUP');
      expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('keep');
      await expect(readFile(join(target, PROPERTY_CATALOG_PATH))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('restores backups without a catalog without clearing an existing destination catalog', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      await source.createNote(createNote({ id: NOTE_A, title: 'Legacy note', path: 'notes/legacy.md', body: 'Legacy\n', now: NOW }));
      const backup = join(dir, 'backup');
      expect(await createBackup(source, backup)).toMatchObject({ notes: 1 });
      const validation = await validateBackup(backup);
      expect(validation.propertyCatalog).toBeUndefined();
      expect(validation.manifest.propertyCatalog).toBeUndefined();
      expect(validation.manifest.counts?.propertyCatalog).toBe(0);

      const target = await FileSystemVault.open(join(dir, 'target'));
      const targetCatalog = await createCatalog(target);
      const preview = await previewRestore(backup, target);
      expect(preview.propertyCatalog).toBeUndefined();
      expect(preview.counts.propertyCatalog).toBeUndefined();
      expect(preview.conflicts).toEqual({ ids: [], paths: [] });
      await restoreBackup(backup, target.root);
      expect(await readFile(join(target.root, PROPERTY_CATALOG_PATH), 'utf8')).toBe(targetCatalog.text);
      expect((await target.readNote(NOTE_A)).body).toBe('Legacy\n');

      const empty = await FileSystemVault.open(join(dir, 'empty'));
      await restoreBackup(backup, empty.root);
      expect((await empty.readPropertyCatalogWithHash()).hash).toBeNull();
    });
  });

  it('reports a catalog conflict in preview and requires overwrite to replace it', async () => {
    await withTempDir(async (dir) => {
      const { vault, catalog } = await seedRichVault(join(dir, 'source'));
      const backup = join(dir, 'backup');
      await createBackup(vault, backup);
      const target = await FileSystemVault.open(join(dir, 'target'));
      const targetCatalog = await createCatalog(target, [definitions[0]!]);
      const beforeNotes = await target.snapshot();

      const preview = await previewRestore(backup, target);
      expect(preview.propertyCatalog?.conflict).toBe(true);
      expect(preview.conflicts.paths).toContain(PROPERTY_CATALOG_PATH);
      expect(await readFile(join(target.root, PROPERTY_CATALOG_PATH), 'utf8')).toBe(targetCatalog.text);
      expect(await storageErrorCode(() => restoreBackup(backup, target.root))).toBe('CONFLICT');
      expect(await readFile(join(target.root, PROPERTY_CATALOG_PATH), 'utf8')).toBe(targetCatalog.text);
      expect(JSON.stringify(await target.snapshot())).toBe(JSON.stringify(beforeNotes));

      await restoreBackup(backup, target.root, { overwrite: true });
      expect(await readFile(join(target.root, PROPERTY_CATALOG_PATH), 'utf8')).toBe(catalog.text);
    });
  });
});

describe('metadata portable export and import', { timeout: 20_000 }, () => {
  it('round-trips catalog, notes, attachments, databases, and views through export/import', async () => {
    await withTempDir(async (dir) => {
      const { vault, catalog, attachmentPath } = await seedRichVault(join(dir, 'source'));
      const exportDir = join(dir, 'export');
      expect(await exportVault(vault, exportDir)).toMatchObject({ notes: 2, databases: 1, databaseViews: 1, attachments: 1, propertyCatalog: 1 });
      expect(await readFile(join(exportDir, PROPERTY_CATALOG_PATH), 'utf8')).toBe(catalog.text);

      const secondExport = join(dir, 'export-2');
      await exportVault(vault, secondExport);
      expect(await readFile(join(secondExport, PROPERTY_CATALOG_PATH), 'utf8')).toBe(catalog.text);
      expect(await readFile(join(secondExport, 'notes/metadata.md'), 'utf8')).toBe(await readFile(join(exportDir, 'notes/metadata.md'), 'utf8'));

      const plan = await planImport(exportDir);
      expect(plan.propertyCatalog?.text).toBe(catalog.text);
      expect(plan.propertyCatalog?.hash).toBe(catalog.hash);
      const target = await FileSystemVault.open(join(dir, 'target'));
      expect(await applyImport(target, plan)).toMatchObject({ notes: 2, databases: 1, databaseViews: 1, attachments: 1, propertyCatalog: 1 });
      expect(await readFile(join(target.root, PROPERTY_CATALOG_PATH), 'utf8')).toBe(catalog.text);
      expect(await readFile(join(target.root, attachmentPath))).toEqual(PNG);
      expect((await target.readNote(NOTE_A)).extraFrontmatter).toMatchObject({
        summary: '', estimate: 0, reviewed: false, due: '2024-02-29', status: 'Open', topics: [],
        homepage: 'https://example.test/path', customField: { keep: ['unknown', { nested: true }] },
      });
      expect((await target.readNote(NOTE_B)).extraFrontmatter).toEqual({ legacy: 'unregistered', other: { keep: true } });
      expect(await target.readDatabase(DB)).toEqual(database);
      expect((await target.listDatabaseViews(DB))[0]?.view).toEqual(view);
      await searchAfterRestore(target);
    });
  });

  it('preserves option aliases and invalid or unregistered values without rewriting notes', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      await createCatalog(source, [
        { id: SELECT, key: 'status', name: 'Status', type: 'select', options: [{ id: OPEN, label: 'In progress', aliases: ['Open'] }] },
        { id: CHECKBOX, key: 'reviewed', name: 'Reviewed', type: 'checkbox' },
      ]);
      const note = {
        ...createNote({ id: NOTE_A, title: 'Legacy metadata', path: 'notes/legacy.md', body: 'Body stays.\n', now: NOW }),
        extraFrontmatter: { status: 'Open', reviewed: 'not-a-boolean', legacy: { keep: true } },
      };
      await source.createNote(note);
      const catalogText = await readFile(join(source.root, PROPERTY_CATALOG_PATH), 'utf8');
      const exportDir = join(dir, 'export');
      await exportVault(source, exportDir);
      const plan = await planImport(exportDir);
      const target = await FileSystemVault.open(join(dir, 'target'));
      await applyImport(target, plan);

      expect(await readFile(join(target.root, PROPERTY_CATALOG_PATH), 'utf8')).toBe(catalogText);
      const imported = await target.readNote(NOTE_A);
      expect(imported.extraFrontmatter).toEqual({ status: 'Open', reviewed: 'not-a-boolean', legacy: { keep: true } });
      const { catalog } = await target.readPropertyCatalogWithHash();
      expect(catalog.properties.find((property) => property.id === SELECT)?.options?.[0]).toEqual({ id: OPEN, label: 'In progress', aliases: ['Open'] });
      expect(projectPropertyValues(catalog, imported.extraFrontmatter)).toMatchObject({
        values: { [SELECT]: 'Open' },
        issues: [{ key: 'reviewed', propertyId: CHECKBOX, code: 'TYPE_MISMATCH' }],
        unregisteredKeys: ['legacy'],
      });
    });
  });

  it('rejects malformed, future, and duplicate catalogs without writing a partial import', async () => {
    await withTempDir(async (dir) => {
      const cases: Array<[string, string, string]> = [
        ['malformed', '{broken', 'INVALID_CONTENT'],
        ['future', JSON.stringify({ format: 'nodus-property-catalog', version: 8, properties: [] }), 'UNSUPPORTED_VERSION'],
        ['duplicate', JSON.stringify({
          format: 'nodus-property-catalog', version: 1,
          properties: [definitions[0], definitions[0]],
        }), 'INVALID_CONTENT'],
      ];
      for (const [name, text, code] of cases) {
        const source = join(dir, name);
        await mkdir(join(source, 'properties'), { recursive: true });
        await writeFile(join(source, PROPERTY_CATALOG_PATH), text, 'utf8');
        expect(await storageErrorCode(() => planImport(source))).toBe(code);
      }
    });
  });

  it('rejects catalog conflicts and non-empty properties folders before any import write', async () => {
    await withTempDir(async (dir) => {
      const { vault, catalog } = await seedRichVault(join(dir, 'source'));
      const exportDir = join(dir, 'export');
      await exportVault(vault, exportDir);
      const plan = await planImport(exportDir);

      const target = await FileSystemVault.open(join(dir, 'target'));
      const targetCatalog = await createCatalog(target, [definitions[0]!]);
      expect(await storageErrorCode(() => applyImport(target, plan))).toBe('CONFLICT');
      expect(await readFile(join(target.root, PROPERTY_CATALOG_PATH), 'utf8')).toBe(targetCatalog.text);
      expect(await target.listNotes()).toEqual([]);

      await applyImport(target, plan, { overwrite: true });
      expect(await readFile(join(target.root, PROPERTY_CATALOG_PATH), 'utf8')).toBe(catalog.text);
      expect(await target.listNotes()).toHaveLength(2);

      const blocked = await FileSystemVault.open(join(dir, 'blocked'));
      await mkdir(join(blocked.root, 'properties'), { recursive: true });
      await writeFile(join(blocked.root, 'properties', 'user.txt'), 'keep', 'utf8');
      expect(await storageErrorCode(() => applyImport(blocked, plan))).toBe('CONFLICT');
      expect(await readFile(join(blocked.root, 'properties', 'user.txt'), 'utf8')).toBe('keep');
      await expect(readFile(join(blocked.root, PROPERTY_CATALOG_PATH))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await blocked.listNotes()).toEqual([]);
    });
  });

  it('leaves an existing destination catalog untouched when importing a legacy source without one', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      await source.createNote(createNote({ id: NOTE_A, title: 'No catalog', path: 'notes/no-catalog.md', body: 'Body\n', now: NOW }));
      const exportDir = join(dir, 'export');
      await exportVault(source, exportDir);
      const target = await FileSystemVault.open(join(dir, 'target'));
      const targetCatalog = await createCatalog(target);
      const plan = await planImport(exportDir);
      expect(plan.propertyCatalog).toBeUndefined();
      await applyImport(target, plan);
      expect(await readFile(join(target.root, PROPERTY_CATALOG_PATH), 'utf8')).toBe(targetCatalog.text);
      expect(await target.listNotes()).toHaveLength(1);
    });
  });

  it('rejects a source catalog that is a symlink', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(join(source, 'properties'), { recursive: true });
      const outside = join(dir, 'outside.json');
      await writeFile(outside, JSON.stringify({ format: 'nodus-property-catalog', version: 1, properties: [] }), 'utf8');
      try {
        await symlink(outside, join(source, PROPERTY_CATALOG_PATH));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }
      expect(await storageErrorCode(() => planImport(source))).toBe('INVALID_CONTENT');
    });
  });
});
