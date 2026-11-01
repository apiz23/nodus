import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeDatabaseViewOrder } from '../src/database/database-view-order.js';
import type { DatabaseDefinition } from '../src/database/schema.js';
import { createBackup, previewRestore, restoreBackup, validateBackup } from '../src/storage/backup/backup.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { BACKUP_MANIFEST, databaseViewOrderPath } from '../src/storage/fs/layout.js';
import { exportVault } from '../src/storage/portable/export.js';
import { applyImport, planImport } from '../src/storage/portable/import.js';
import { withTempDir } from './tmp.js';

const DB = '9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73';
const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';

const db: DatabaseDefinition = { id: DB, name: 'Reading', properties: [] };

function view(id: string) {
  return {
    id, databaseId: DB, name: `View ${id.slice(0, 4)}`, type: 'gallery' as const, settings: {},
    sort: { propertyId: 'title', direction: 'asc' as const },
    sorts: [{ propertyId: 'title', direction: 'asc' as const }],
    filters: [], visiblePropertyIds: [],
  };
}

async function seedVault(root: string, order: boolean) {
  const vault = await FileSystemVault.open(root);
  await vault.createDatabase(db);
  await vault.createDatabaseView(view(V1));
  await vault.createDatabaseView(view(V2));
  if (order) {
    await vault.writeDatabaseViewOrder(DB, [V2, V1], { expectedHash: null });
  }
  return vault;
}

describe('saved-view ordering portability', () => {
  it('exports and imports ordering manifests alongside saved views', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'), true);
      const exportDir = join(dir, 'export');
      const report = await exportVault(source, exportDir);
      expect(report).toMatchObject({ databases: 1, databaseViews: 2, databaseViewOrders: 1 });

      const orderPath = databaseViewOrderPath(DB);
      const sourceFile = await readFile(join(source.root, orderPath));
      expect(await readFile(join(exportDir, orderPath))).toEqual(sourceFile);

      const plan = await planImport(exportDir);
      expect(plan.databaseViewOrders).toHaveLength(1);
      expect(plan.databaseViewOrders?.[0]).toMatchObject({ databaseId: DB, revision: 1, viewIds: [V2, V1] });

      const imported = await FileSystemVault.open(join(dir, 'imported'));
      expect(await applyImport(imported, plan)).toMatchObject({ databases: 1, databaseViews: 2, databaseViewOrders: 1 });
      expect(await imported.readDatabaseViewOrder(DB)).toMatchObject({ revision: 1, viewIds: [V2, V1] });
      expect((await imported.listDatabaseViews(DB)).map((item) => item.view.id)).toEqual([V1, V2]);
    });
  });

  it('backs up, validates, previews, and restores ordering manifests', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'), true);
      const backup = join(dir, 'backup');
      expect(await createBackup(source, backup)).toMatchObject({ databases: 1, databaseViews: 2, databaseViewOrders: 1 });

      const manifest = JSON.parse(await readFile(join(backup, BACKUP_MANIFEST), 'utf8'));
      expect(manifest.version).toBe(5);
      expect(manifest.formats.databaseViewOrder).toBe(1);
      expect(manifest.counts.databaseViewOrders).toBe(1);
      expect(manifest.files.filter((file: { kind: string }) => file.kind === 'database-view-order')).toMatchObject([
        { kind: 'database-view-order', id: DB, path: databaseViewOrderPath(DB) },
      ]);

      const validation = await validateBackup(backup);
      expect(validation.databaseViewOrders).toHaveLength(1);
      expect(validation.databaseViewOrders?.[0]).toMatchObject({ databaseId: DB, revision: 1, viewIds: [V2, V1] });

      const preview = await previewRestore(backup, await FileSystemVault.open(join(dir, 'live')));
      expect(preview.counts).toMatchObject({ databaseViews: 2, databaseViewOrders: 1 });
      expect(preview.conflicts).toEqual({ ids: [], paths: [] });

      const restoredRoot = join(dir, 'restored');
      expect(await restoreBackup(backup, restoredRoot)).toMatchObject({ databaseViews: 2, databaseViewOrders: 1 });
      const restored = await FileSystemVault.open(restoredRoot);
      expect(await restored.readDatabaseViewOrder(DB)).toMatchObject({ revision: 1, viewIds: [V2, V1] });
      expect((await restored.listDatabaseViews(DB)).map((item) => item.view.id)).toEqual([V1, V2]);
    });
  });

  it('restores older backups without ordering manifests using deterministic default order', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'), false);
      const backup = join(dir, 'backup');
      const report = await createBackup(source, backup);
      expect(report).not.toHaveProperty('databaseViewOrders');
      const manifest = JSON.parse(await readFile(join(backup, BACKUP_MANIFEST), 'utf8'));
      expect(manifest.counts.databaseViewOrders).toBe(0);
      expect(manifest.files.some((file: { kind: string }) => file.kind === 'database-view-order')).toBe(false);

      const restored = join(dir, 'restored');
      expect(await restoreBackup(backup, restored)).not.toHaveProperty('databaseViewOrders');
      const vault = await FileSystemVault.open(restored);
      expect(await vault.readDatabaseViewOrder(DB)).toMatchObject({ revision: 0, hash: null, viewIds: [V1, V2] });
    });
  });

  it('rejects invalid ordering manifests before writing anything', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'), true);
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const orderPath = join(backup, databaseViewOrderPath(DB));
      await writeFile(orderPath, '{broken', 'utf8');

      const targetRoot = join(dir, 'target');
      const target = await FileSystemVault.open(targetRoot);
      await target.createDatabase({ ...db, id: '0c7d5e2b-1a3f-4b6c-8d9e-2f4a6c8e0b13', name: 'Sentinel', properties: [] });
      const before = await target.snapshot();

      await expect(restoreBackup(backup, targetRoot)).rejects.toMatchObject({ code: 'CORRUPT_BACKUP' });
      expect(await target.snapshot()).toEqual(before);
      expect(await target.listDatabaseViews(DB)).toEqual([]);
    });
  });

  it('rejects tampered ordering bytes and unlisted ordering files', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'), true);
      const backup = join(dir, 'backup');
      await createBackup(source, backup);
      const orderPath = join(backup, databaseViewOrderPath(DB));
      const original = await readFile(orderPath);
      await writeFile(orderPath, serializeDatabaseViewOrder({ databaseId: DB, revision: 2, viewIds: [V1, V2] }), 'utf8');
      await expect(validateBackup(backup)).rejects.toMatchObject({ code: 'CORRUPT_BACKUP' });

      await writeFile(orderPath, original);
      const extra = join(backup, databaseViewOrderPath('0c7d5e2b-1a3f-4b6c-8d9e-2f4a6c8e0b13'));
      await writeFile(extra, serializeDatabaseViewOrder({ databaseId: '0c7d5e2b-1a3f-4b6c-8d9e-2f4a6c8e0b13', revision: 1, viewIds: [] }), 'utf8');
      await expect(validateBackup(backup)).rejects.toMatchObject({ code: 'CORRUPT_BACKUP' });
    });
  });

  it('reports ordering conflicts in restore preview and requires overwrite', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'), true);
      const backup = join(dir, 'backup');
      await createBackup(source, backup);

      const targetRoot = join(dir, 'target');
      const target = await seedVault(targetRoot, false);
      await target.writeDatabaseViewOrder(DB, [V1, V2], { expectedHash: null });
      const preview = await previewRestore(backup, target);
      expect(preview.conflicts.paths).toContain(databaseViewOrderPath(DB));

      await expect(restoreBackup(backup, targetRoot)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await target.readDatabaseViewOrder(DB)).viewIds).toEqual([V1, V2]);

      expect(await restoreBackup(backup, targetRoot, { overwrite: true })).toMatchObject({ databaseViewOrders: 1 });
      expect((await target.readDatabaseViewOrder(DB)).viewIds).toEqual([V2, V1]);
    });
  });

  it('rejects ordering manifests whose path does not match their database ID', async () => {
    await withTempDir(async (dir) => {
      const source = await seedVault(join(dir, 'source'), true);
      const exportDir = join(dir, 'export');
      await exportVault(source, exportDir);
      const manifestPath = join(exportDir, databaseViewOrderPath(DB));
      const bytes = await readFile(manifestPath, 'utf8');
      const other = '0c7d5e2b-1a3f-4b6c-8d9e-2f4a6c8e0b13';
      await rm(manifestPath);
      await writeFile(join(exportDir, databaseViewOrderPath(other)), bytes, 'utf8');
      await expect(planImport(exportDir)).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
    });
  });
});
