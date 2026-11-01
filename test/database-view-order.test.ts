import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DATABASE_VIEW_ORDER_FORMAT,
  DATABASE_VIEW_ORDER_VERSION,
  parseDatabaseViewOrder,
  resolveDatabaseViewOrder,
  serializeDatabaseViewOrder,
} from '../src/database/database-view-order.js';
import type { DatabaseDefinition } from '../src/database/schema.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { databaseViewOrderPath } from '../src/storage/fs/layout.js';
import { withTempDir } from './tmp.js';

const DB = '9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73';
const DB2 = '0c7d5e2b-1a3f-4b6c-8d9e-2f4a6c8e0b13';
const VIEW_A = '11111111-1111-4111-8111-111111111111';
const VIEW_B = '22222222-2222-4222-8222-222222222222';
const VIEW_C = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';

const db: DatabaseDefinition = { id: DB, name: 'Reading', properties: [] };

function view(id: string, databaseId = DB) {
  return {
    id,
    databaseId,
    name: `View ${id.slice(0, 4)}`,
    type: 'gallery' as const,
    settings: {},
    sort: { propertyId: 'title', direction: 'asc' as const },
    sorts: [{ propertyId: 'title', direction: 'asc' as const }],
    filters: [],
    visiblePropertyIds: [],
  };
}

async function seed(dir: string) {
  const vault = await FileSystemVault.open(join(dir, 'vault'));
  await vault.createDatabase(db);
  await vault.createDatabase({ ...db, id: DB2, name: 'Other' });
  for (const id of [VIEW_C, VIEW_A, VIEW_B]) await vault.createDatabaseView(view(id));
  return vault;
}

describe('saved-view order format', () => {
  it('round-trips a strict versioned manifest', () => {
    const order = { databaseId: DB, revision: 3, viewIds: [VIEW_B, VIEW_A] };
    const encoded = serializeDatabaseViewOrder(order);
    expect(JSON.parse(encoded)).toEqual({ format: DATABASE_VIEW_ORDER_FORMAT, version: DATABASE_VIEW_ORDER_VERSION, ...order });
    expect(parseDatabaseViewOrder(encoded)).toEqual(order);
  });

  it('rejects duplicate, unknown, malformed, and future manifest data', () => {
    const encoded = serializeDatabaseViewOrder({ databaseId: DB, revision: 1, viewIds: [VIEW_A] });
    expect(() => parseDatabaseViewOrder(JSON.stringify({ ...JSON.parse(encoded), viewIds: [VIEW_A, VIEW_A] }))).toThrow(/Duplicate/);
    expect(() => parseDatabaseViewOrder(JSON.stringify({ ...JSON.parse(encoded), viewIds: [UNKNOWN] }))).not.toThrow();
    expect(() => parseDatabaseViewOrder(JSON.stringify({ ...JSON.parse(encoded), viewIds: ['nope'] }))).toThrow(/UUID/);
    expect(() => parseDatabaseViewOrder(JSON.stringify({ ...JSON.parse(encoded), revision: 0 }))).toThrow(/revision/);
    expect(() => parseDatabaseViewOrder(JSON.stringify({ ...JSON.parse(encoded), version: 2 }))).toThrow(/newer than supported/);
    expect(() => parseDatabaseViewOrder(JSON.stringify({ ...JSON.parse(encoded), future: true }))).toThrow(/Unknown key/);
    expect(() => parseDatabaseViewOrder('{broken')).toThrow(/valid JSON/);
  });

  it('resolves deleted, duplicate, unknown, and missing IDs deterministically', () => {
    expect(resolveDatabaseViewOrder([VIEW_A, VIEW_B, VIEW_C], [VIEW_C, UNKNOWN, VIEW_C, VIEW_A])).toEqual([VIEW_C, VIEW_A, VIEW_B]);
    expect(resolveDatabaseViewOrder([VIEW_A, VIEW_B], [])).toEqual([VIEW_A, VIEW_B]);
    expect(resolveDatabaseViewOrder([], [VIEW_A])).toEqual([]);
  });
});

describe('saved-view order storage', () => {
  it('defaults legacy databases to the deterministic path order without writing a manifest', async () => {
    await withTempDir(async (dir) => {
      const vault = await seed(dir);
      const order = await vault.readDatabaseViewOrder(DB);
      expect(order).toMatchObject({ databaseId: DB, revision: 0, hash: null, viewIds: [VIEW_A, VIEW_B, VIEW_C] });
      expect(order.path).toBe(databaseViewOrderPath(DB));
      await expect(readFile(join(vault.root, order.path))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('persists reordering atomically across reload and restart', async () => {
    await withTempDir(async (dir) => {
      const vault = await seed(dir);
      const initial = await vault.readDatabaseViewOrder(DB);
      const written = await vault.writeDatabaseViewOrder(DB, [VIEW_B, VIEW_C, VIEW_A], { expectedHash: initial.hash });
      expect(written).toMatchObject({ revision: 1, viewIds: [VIEW_B, VIEW_C, VIEW_A] });
      expect(written.hash).toMatch(/^[0-9a-f]{64}$/);

      const reopened = await FileSystemVault.open(vault.root);
      expect(await reopened.readDatabaseViewOrder(DB)).toMatchObject({ revision: 1, viewIds: [VIEW_B, VIEW_C, VIEW_A], hash: written.hash });
      expect((await reopened.listDatabaseViews(DB)).map((item) => item.view.id)).toEqual([VIEW_A, VIEW_B, VIEW_C]);
      expect(JSON.parse(await readFile(join(vault.root, written.path), 'utf8'))).toMatchObject({
        format: DATABASE_VIEW_ORDER_FORMAT, version: DATABASE_VIEW_ORDER_VERSION, databaseId: DB, revision: 1, viewIds: [VIEW_B, VIEW_C, VIEW_A],
      });
    });
  });

  it('keeps ordering isolated per database', async () => {
    await withTempDir(async (dir) => {
      const vault = await seed(dir);
      const otherView = '44444444-4444-4444-8444-444444444444';
      await vault.createDatabaseView(view(otherView, DB2));
      const first = await vault.readDatabaseViewOrder(DB);
      await vault.writeDatabaseViewOrder(DB, [VIEW_C, VIEW_A, VIEW_B], { expectedHash: first.hash });
      const other = await vault.readDatabaseViewOrder(DB2);
      expect(other).toMatchObject({ revision: 0, hash: null, viewIds: [otherView] });
    });
  });

  it('serializes concurrent reorders and rejects the stale writer', async () => {
    await withTempDir(async (dir) => {
      const vault = await seed(dir);
      const initial = await vault.readDatabaseViewOrder(DB);
      const outcomes = await Promise.allSettled([
        vault.writeDatabaseViewOrder(DB, [VIEW_A, VIEW_B, VIEW_C], { expectedHash: initial.hash }),
        vault.writeDatabaseViewOrder(DB, [VIEW_C, VIEW_B, VIEW_A], { expectedHash: initial.hash }),
      ]);
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((result) => result.status === 'rejected')).toMatchObject([{ reason: { code: 'STALE_WRITE' } }]);
      const stored = await vault.readDatabaseViewOrder(DB);
      expect(stored.revision).toBe(1);
      expect([VIEW_A, VIEW_C]).toContain(stored.viewIds[0]);
    });
  });

  it('rejects duplicate, unknown, and omitted IDs before writing', async () => {
    await withTempDir(async (dir) => {
      const vault = await seed(dir);
      const initial = await vault.readDatabaseViewOrder(DB);
      await expect(vault.writeDatabaseViewOrder(DB, [VIEW_A, VIEW_A, VIEW_B, VIEW_C], { expectedHash: initial.hash })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(vault.writeDatabaseViewOrder(DB, [VIEW_A, VIEW_B, VIEW_C, UNKNOWN], { expectedHash: initial.hash })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(vault.writeDatabaseViewOrder(DB, [VIEW_A, VIEW_B], { expectedHash: initial.hash })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(vault.writeDatabaseViewOrder(DB2, [VIEW_A], { expectedHash: null })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(vault.writeDatabaseViewOrder(DB, [VIEW_A, VIEW_B, VIEW_C], { expectedHash: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'STALE_WRITE' });
      expect(await vault.readDatabaseViewOrder(DB)).toMatchObject({ revision: 0, hash: null, viewIds: [VIEW_A, VIEW_B, VIEW_C] });
    });
  });

  it('requires the manifest to exist or not exist exactly as the caller observed', async () => {
    await withTempDir(async (dir) => {
      const vault = await seed(dir);
      await vault.writeDatabaseViewOrder(DB, [VIEW_C, VIEW_B, VIEW_A], { expectedHash: null });
      await expect(vault.writeDatabaseViewOrder(DB, [VIEW_A, VIEW_B, VIEW_C], { expectedHash: null })).rejects.toMatchObject({ code: 'STALE_WRITE' });
      const current = await vault.readDatabaseViewOrder(DB);
      await expect(vault.writeDatabaseViewOrder(DB, [VIEW_A, VIEW_B, VIEW_C], { expectedHash: current.hash })).resolves.toMatchObject({ revision: 2 });
    });
  });

  it('ignores deleted views on read and keeps the manifest file untouched', async () => {
    await withTempDir(async (dir) => {
      const vault = await seed(dir);
      const initial = await vault.readDatabaseViewOrder(DB);
      const written = await vault.writeDatabaseViewOrder(DB, [VIEW_C, VIEW_B, VIEW_A], { expectedHash: initial.hash });
      const before = await readFile(join(vault.root, written.path));
      await vault.deleteDatabaseView(DB, VIEW_B);
      const after = await vault.readDatabaseViewOrder(DB);
      expect(after).toMatchObject({ revision: 1, viewIds: [VIEW_C, VIEW_A], hash: written.hash });
      expect(await readFile(join(vault.root, written.path))).toEqual(before);
      const listed = await vault.listDatabaseViews(DB);
      expect(listed.map((item) => item.view.id)).toEqual([VIEW_A, VIEW_C]);
    });
  });

  it('appends views created after the manifest was written', async () => {
    await withTempDir(async (dir) => {
      const vault = await seed(dir);
      const initial = await vault.readDatabaseViewOrder(DB);
      await vault.writeDatabaseViewOrder(DB, [VIEW_C, VIEW_B, VIEW_A], { expectedHash: initial.hash });
      const created = '44444444-4444-4444-8444-444444444444';
      await vault.createDatabaseView(view(created));
      expect((await vault.readDatabaseViewOrder(DB)).viewIds).toEqual([VIEW_C, VIEW_B, VIEW_A, created]);
    });
  });

  it('fails safely when the manifest path is unusable and recovers afterwards', async () => {
    await withTempDir(async (dir) => {
      const vault = await seed(dir);
      const initial = await vault.readDatabaseViewOrder(DB);
      const absolute = join(vault.root, databaseViewOrderPath(DB));
      await mkdir(absolute, { recursive: true });
      await expect(vault.writeDatabaseViewOrder(DB, [VIEW_C, VIEW_B, VIEW_A], { expectedHash: initial.hash })).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
      await expect(vault.readDatabaseViewOrder(DB)).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
      await rm(absolute, { recursive: true, force: true });
      await expect(vault.writeDatabaseViewOrder(DB, [VIEW_C, VIEW_B, VIEW_A], { expectedHash: null })).resolves.toMatchObject({ revision: 1 });
      expect((await vault.readDatabaseViewOrder(DB)).viewIds).toEqual([VIEW_C, VIEW_B, VIEW_A]);
    });
  });

  it('rejects corrupt or foreign manifests instead of silently resetting ordering', async () => {
    await withTempDir(async (dir) => {
      const vault = await seed(dir);
      const absolute = join(vault.root, databaseViewOrderPath(DB));
      await mkdir(join(vault.root, '.nodus-orders', 'database-views'), { recursive: true });
      await writeFile(absolute, '{broken', 'utf8');
      await expect(vault.readDatabaseViewOrder(DB)).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      await expect(vault.writeDatabaseViewOrder(DB, [VIEW_A, VIEW_B, VIEW_C], { expectedHash: null })).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      await writeFile(absolute, serializeDatabaseViewOrder({ databaseId: DB2, revision: 1, viewIds: [] }), 'utf8');
      await expect(vault.readDatabaseViewOrder(DB)).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
    });
  });
});
