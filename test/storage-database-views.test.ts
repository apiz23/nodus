import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDatabaseView, serializeDatabaseView, diagnoseDatabaseView, type DatabaseView } from '../src/database/database-view.js';
import type { DatabaseDefinition } from '../src/database/schema.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { exportVault } from '../src/storage/portable/export.js';
import { applyImport, planImport } from '../src/storage/portable/import.js';
import { createBackup, restoreBackup, validateBackup } from '../src/storage/backup/backup.js';
import { databaseViewPath } from '../src/storage/fs/layout.js';
import { withTempDir } from './tmp.js';

const DB = '9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73';
const PROP = '1f0c7d2a-0b1e-4c3d-9a8f-5e6d7c8b9a01';
const OPTION = '58decd03-02bd-4c70-b14f-76d04e4e99d8';
const VIEW = '665f1175-2b7a-4a21-9b2d-657bb79fa9a1';
const VIEW2 = 'a21215fb-6d5c-49a8-9ceb-7e389695bc4e';
const db: DatabaseDefinition = { id: DB, name: 'Reading', properties: [
  { id: PROP, name: 'Status', type: 'select', options: [{ id: OPTION, name: 'Ready' }] },
] };
const view: DatabaseView = { id: VIEW, databaseId: DB, name: 'Ready to read', sort: { propertyId: PROP, direction: 'asc' }, filters: [{ id: 'f12000f2-065d-4ccb-8b5a-37a22b724dc8', propertyId: PROP, operator: 'is', value: OPTION }], visiblePropertyIds: [PROP] };

describe('database view format', () => {
  it('round-trips stable IDs and strictly rejects unknown and future fields', () => {
    expect(parseDatabaseView(serializeDatabaseView(view))).toEqual(view);
    const raw = JSON.parse(serializeDatabaseView(view)) as Record<string, unknown>;
    expect(() => parseDatabaseView(JSON.stringify({ ...raw, future: true }))).toThrow(/Unknown key/);
    expect(() => parseDatabaseView(JSON.stringify({ ...raw, version: 3 }))).toThrow(/newer than supported/);
    expect(() => parseDatabaseView(JSON.stringify({ ...raw, sort: { propertyId: 'title', direction: 'asc', label: 'Title' } }))).toThrow(/Unknown key/);
    expect(() => parseDatabaseView(JSON.stringify({ ...raw, filters: [{ ...view.filters[0], value: {} }] }))).toThrow(/value must be/);
  });

  it('reads legacy v1 without rewriting and strictly validates typed v2 settings and references', () => {
    expect(JSON.parse(serializeDatabaseView(view)).version).toBe(1);
    const board: DatabaseView = { ...view, type: 'kanban', settings: { groupPropertyId: PROP } };
    expect(JSON.parse(serializeDatabaseView(board)).version).toBe(2);
    expect(parseDatabaseView(serializeDatabaseView(board))).toEqual(board);
    expect(diagnoseDatabaseView(board, db)).toEqual([]);
    const raw = JSON.parse(serializeDatabaseView(board));
    for (const settings of [{}, { groupPropertyId: 'Status' }, { groupPropertyId: PROP, extra: true }]) {
      expect(() => parseDatabaseView(JSON.stringify({ ...raw, settings }))).toThrow();
    }
    expect(() => parseDatabaseView(JSON.stringify({ ...raw, type: 'timeline' }))).toThrow();
    expect(diagnoseDatabaseView({ ...board, type: 'calendar', settings: { datePropertyId: PROP } }, db)).toMatchObject([{ code: 'INVALID_REFERENCE' }]);
    expect(diagnoseDatabaseView({ ...board, settings: { groupPropertyId: VIEW2 } }, db)).toMatchObject([{ code: 'MISSING_PROPERTY' }]);
  });

  it('diagnoses missing database, property, and option references without mutating view data', () => {
    expect(diagnoseDatabaseView(view)).toMatchObject([{ code: 'MISSING_DATABASE' }]);
    const missingProperty = { ...view, visiblePropertyIds: [VIEW2] };
    expect(diagnoseDatabaseView(missingProperty, db)).toMatchObject([{ code: 'MISSING_PROPERTY' }]);
    const missingOption = { ...view, filters: [{ ...view.filters[0]!, value: VIEW2 }] };
    expect(diagnoseDatabaseView(missingOption, db)).toMatchObject([{ code: 'MISSING_OPTION' }]);
    expect(parseDatabaseView(serializeDatabaseView(missingOption))).toEqual(missingOption);
  });
});

describe('saved-view storage and portability', () => {
  it('uses atomic conditional updates and rejects stale concurrent writers', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      await vault.createDatabase(db);
      await vault.createDatabaseView(view);
      const first = (await vault.listDatabaseViews(DB))[0]!;
      const second: DatabaseView = { ...view, name: 'Another name' };
      const outcomes = await Promise.allSettled([
        vault.replaceDatabaseView({ ...view, name: 'Winner A' }, { expectedHash: first.hash }),
        vault.replaceDatabaseView(second, { expectedHash: first.hash }),
      ]);
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((result) => result.status === 'rejected')).toMatchObject([{ reason: { code: 'STALE_WRITE' } }]);
      expect((await vault.listDatabaseViews(DB))[0]?.view.name).not.toBe('Ready to read');
    });
  });

  it('keeps views when a database is deleted and exposes orphan diagnostics', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      await vault.createDatabase(db);
      await vault.createDatabaseView(view);
      await vault.deleteDatabase(DB);
      expect(await vault.listDatabaseViews(DB)).toHaveLength(1);
      expect(diagnoseDatabaseView(view)).toMatchObject([{ code: 'MISSING_DATABASE' }]);
      expect((await vault.snapshot()).map((entry) => entry.path)).toContain(databaseViewPath(DB, VIEW));
    });
  });

  it('round-trips through export/import and backup/restore as JSON view files', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      await source.createDatabase(db);
      await source.createDatabaseView(view);
      const path = databaseViewPath(DB, VIEW);
      const original = await readFile(join(source.root, path));
      const exportDir = join(dir, 'export');
      expect(await exportVault(source, exportDir)).toMatchObject({ databases: 1, databaseViews: 1 });
      expect(await readFile(join(exportDir, path))).toEqual(original);
      const imported = await FileSystemVault.open(join(dir, 'imported'));
      const plan = await planImport(exportDir);
      expect(plan.databaseViews).toEqual([view]);
      expect(await applyImport(imported, plan)).toEqual({ notes: 0, databases: 1, databaseViews: 1 });
      expect(await readFile(join(imported.root, path))).toEqual(original);

      const backupDir = join(dir, 'backup');
      expect(await createBackup(source, backupDir)).toMatchObject({ databaseViews: 1 });
      const validated = await validateBackup(backupDir);
      expect(validated.manifest.version).toBe(4);
      expect(validated.databaseViews).toEqual([view]);
      const restored = await FileSystemVault.open(join(dir, 'restored'));
      expect(await restoreBackup(backupDir, restored.root)).toEqual({ notes: 0, databases: 1, databaseViews: 1 });
      expect(await readFile(join(restored.root, path))).toEqual(original);
    });
  });

  it('rejects malformed and unsupported on-disk views rather than skipping them', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      const path = databaseViewPath(DB, VIEW);
      await mkdir(join(vault.root, 'database-views', DB), { recursive: true });
      await writeFile(join(vault.root, path), '{broken', 'utf8');
      await expect(vault.snapshot()).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      await writeFile(join(vault.root, path), serializeDatabaseView({ ...view, id: VIEW } ).replace('"version": 1', '"version": 99'));
      await expect(vault.snapshot()).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
    });
  });

  it('rejects saved-view data omitted from v1 or v2 backup manifests before restore', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      await source.createDatabase(db);
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const path = databaseViewPath(DB, VIEW);
      await mkdir(join(backup, 'database-views', DB), { recursive: true });
      await writeFile(join(backup, path), serializeDatabaseView(view));
      await expect(restoreBackup(backup, join(dir, 'target'))).rejects.toMatchObject({ code: 'CORRUPT_BACKUP' });
      const manifestPath = join(backup, 'nodus-backup.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      await writeFile(manifestPath, JSON.stringify({ format: manifest.format, version: 1, createdAt: manifest.createdAt, files: manifest.files.map(({ bytes: _bytes, ...file }: { bytes: number }) => file) }));
      await expect(restoreBackup(backup, join(dir, 'target'))).rejects.toMatchObject({ code: 'CORRUPT_BACKUP' });
      await expect(readFile(join(dir, 'target', path))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('rejects symlinked saved-view directories and traversal entries before target mutation', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      const outside = join(dir, 'outside');
      await mkdir(outside);
      await mkdir(join(vault.root, 'database-views'), { recursive: true });
      await symlink(outside, join(vault.root, 'database-views', DB));
      await expect(vault.snapshot()).rejects.toMatchObject({ code: 'INVALID_CONTENT' });

      const clean = await FileSystemVault.open(join(dir, 'clean-vault'));
      const invalidPlan = {
        notes: [], databases: [], databaseViews: [view],
        entries: [{ kind: 'database-view' as const, id: VIEW, path: 'database-views/../escape.json', text: serializeDatabaseView(view) }],
      };
      await expect(clean.applyImport(invalidPlan)).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      await expect(readFile(join(clean.root, databaseViewPath(DB, VIEW)))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('refuses import collisions unless overwrite is explicit', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      await source.createDatabase(db); await source.createDatabaseView(view);
      const target = await FileSystemVault.open(join(dir, 'target'));
      await target.createDatabase(db); await target.createDatabaseView(view);
      const plan = await planImport(join(dir, 'source'));
      const viewOnly = { ...plan, databases: [], entries: plan.entries.filter((entry) => entry.kind === 'database-view') };
      await expect(applyImport(target, viewOnly)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await applyImport(target, viewOnly, { overwrite: true })).toEqual({ notes: 0, databases: 0, databaseViews: 1 });
    });
  });

  it('duplicates a revision under the root lock and preserves every view type through portability', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const dateId = 'ef8a57e5-6f23-4026-b612-f9947c292c28';
      await source.createDatabase({ ...db, properties: [...db.properties, { id: dateId, name: 'Due', type: 'date' }] });
      await source.createDatabaseView({ ...view, type: 'kanban', settings: { groupPropertyId: PROP } });
      const original = await source.readDatabaseView(DB, VIEW);
      await source.duplicateDatabaseView(DB, VIEW, VIEW2, 'Board copy', { expectedHash: original.hash });
      const copy = await source.readDatabaseView(DB, VIEW2);
      expect(copy.view).toEqual({ ...original.view, id: VIEW2, name: 'Board copy' });
      await expect(source.duplicateDatabaseView(DB, VIEW, VIEW2, 'Duplicate collision', { expectedHash: original.hash })).rejects.toMatchObject({ code: 'CONFLICT' });
      await source.replaceDatabaseView({ ...original.view, name: 'Changed' }, { expectedHash: original.hash });
      await expect(source.duplicateDatabaseView(DB, VIEW, '1aabeb6a-37f7-4b98-9f62-232336f920da', 'Stale copy', { expectedHash: original.hash })).rejects.toMatchObject({ code: 'STALE_WRITE' });
      await source.createDatabaseView({ ...view, id: '1aabeb6a-37f7-4b98-9f62-232336f920da', type: 'calendar', settings: { datePropertyId: dateId } });
      await source.createDatabaseView({ ...view, id: 'a01cbb23-fd69-497e-bd74-8e13c5dc4d39', type: 'table', settings: {} });
      await exportVault(source, join(dir, 'export'));
      const imported = await FileSystemVault.open(join(dir, 'import'));
      await imported.applyImport(await planImport(join(dir, 'export')));
      await createBackup(source, join(dir, 'backup'));
      await restoreBackup(join(dir, 'backup'), join(dir, 'restore'));
      const restored = await FileSystemVault.open(join(dir, 'restore'));
      const expected = (await source.snapshot()).filter((entry) => entry.kind === 'database-view');
      for (const vault of [imported, restored]) for (const entry of expected) {
        expect(await readFile(join(vault.root, entry.path))).toEqual(entry.rawBytes);
      }
      expect((await validateBackup(join(dir, 'backup'))).manifest.formats?.databaseView).toBe(2);
    });
  });
});
