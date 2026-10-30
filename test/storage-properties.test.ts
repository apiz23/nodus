import { createHash } from 'node:crypto';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
import {
  PROPERTY_CATALOG_PATH,
  createPropertyCatalog,
  type NotePropertyDefinition,
  type PropertyCatalogMutation,
} from '../src/properties/catalog.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { withTempDir } from './tmp.js';

const atomicFailure = vi.hoisted(() => ({ next: false }));
vi.mock('../src/storage/fs/atomic.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/storage/fs/atomic.js')>();
  return {
    ...actual,
    writeFileAtomic: async (...args: Parameters<typeof actual.writeFileAtomic>) => {
      if (atomicFailure.next) {
        atomicFailure.next = false;
        throw new Error('injected atomic failure');
      }
      return actual.writeFileAtomic(...args);
    },
  };
});

const NOW = '2026-10-25T12:00:00Z';
const LATER = '2026-10-26T12:00:00Z';
const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const TEXT_ID = '22222222-2222-4222-8222-222222222222';
const NUMBER_ID = '33333333-3333-4333-8333-333333333333';
const CHECKBOX_ID = '44444444-4444-4444-8444-444444444444';
const DATE_ID = '55555555-5555-4555-8555-555555555555';
const SELECT_ID = '66666666-6666-4666-8666-666666666666';
const MULTI_ID = '77777777-7777-4777-8777-777777777777';
const URL_ID = '88888888-8888-4888-8888-888888888888';
const OPTION_A = '99999999-9999-4999-8999-999999999999';
const OPTION_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OPTION_C = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const definitions: NotePropertyDefinition[] = [
  { id: TEXT_ID, key: 'summary', name: 'Summary', type: 'text' },
  { id: NUMBER_ID, key: 'estimate', name: 'Estimate', type: 'number' },
  { id: CHECKBOX_ID, key: 'reviewed', name: 'Reviewed', type: 'checkbox' },
  { id: DATE_ID, key: 'due', name: 'Due', type: 'date' },
  { id: SELECT_ID, key: 'status', name: 'Status', type: 'select', options: [{ id: OPTION_A, label: 'Open' }, { id: OPTION_B, label: 'Done' }] },
  { id: MULTI_ID, key: 'topics', name: 'Topics', type: 'multi-select', options: [{ id: OPTION_C, label: 'Research' }] },
  { id: URL_ID, key: 'homepage', name: 'Homepage', type: 'url' },
];

function addProperty(property: NotePropertyDefinition): PropertyCatalogMutation {
  return { type: 'create-property', property };
}

async function rawHash(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

describe('property catalog storage', () => {
  it('returns an empty catalog without creating a file on reads', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      expect(await vault.readPropertyCatalogWithHash()).toEqual({ catalog: { properties: [] }, hash: null });
      await expect(readFile(join(dir, PROPERTY_CATALOG_PATH))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('persists validated definitions atomically and returns the raw-byte revision', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const saved = await vault.mutatePropertyCatalog(addProperty(definitions[0]!), null);
      expect(saved.catalog.properties).toEqual([definitions[0]]);
      expect(saved.hash).toBe(await rawHash(join(dir, PROPERTY_CATALOG_PATH)));
      expect(await vault.readPropertyCatalogWithHash()).toEqual(saved);
    });
  });

  it('rejects malformed and future catalogs without replacing their bytes', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const path = join(dir, PROPERTY_CATALOG_PATH);
      await mkdir(join(dir, 'properties'));
      for (const [text, expectedCode] of [['{bad', 'INVALID_CONTENT'], [JSON.stringify({ format: 'nodus-property-catalog', version: 8, properties: [] }), 'UNSUPPORTED_VERSION']] as const) {
        await writeFile(path, text, 'utf8');
        const before = await readFile(path, 'utf8');
        await expect(vault.readPropertyCatalogWithHash()).rejects.toMatchObject({ code: expectedCode });
        await expect(vault.mutatePropertyCatalog(addProperty(definitions[0]!), await rawHash(path))).rejects.toMatchObject({ code: expectedCode });
        expect(await readFile(path, 'utf8')).toBe(before);
      }
    });
  });

  it('rejects symlinked catalog directories and catalog files', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      const outside = join(dir, 'outside');
      await mkdir(outside);
      await symlink(outside, join(vault.root, 'properties'));
      await expect(vault.readPropertyCatalogWithHash()).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    });
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await mkdir(join(dir, 'properties'));
      const outside = join(dir, 'outside.json');
      await writeFile(outside, '{}', 'utf8');
      await symlink(outside, join(dir, PROPERTY_CATALOG_PATH));
      await expect(vault.readPropertyCatalogWithHash()).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    });
  });

  it('refuses to place catalog data in a pre-existing user properties folder', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await mkdir(join(dir, 'properties'));
      await writeFile(join(dir, 'properties', 'keep.txt'), 'user data', 'utf8');
      await expect(vault.mutatePropertyCatalog(addProperty(definitions[0]!), null)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await readFile(join(dir, 'properties', 'keep.txt'), 'utf8')).toBe('user data');
    });
  });

  it('rejects stale and concurrent catalog updates instead of overwriting the winner', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const base = await vault.readPropertyCatalogWithHash();
      const outcomes = await Promise.allSettled([
        vault.mutatePropertyCatalog(addProperty(definitions[0]!), base.hash),
        vault.mutatePropertyCatalog(addProperty(definitions[1]!), base.hash),
      ]);
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const rejected = outcomes.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: 'STALE_WRITE' });
      const final = await vault.readPropertyCatalogWithHash();
      expect(final.hash).not.toBeNull();
      await expect(vault.mutatePropertyCatalog(addProperty(definitions[2]!), base.hash)).rejects.toMatchObject({ code: 'STALE_WRITE' });
      expect((await vault.readPropertyCatalogWithHash()).hash).toBe(final.hash);
    });
  });

  it('leaves the previous catalog intact when an atomic write fails', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const first = await vault.mutatePropertyCatalog(addProperty(definitions[0]!), null);
      const path = join(dir, PROPERTY_CATALOG_PATH);
      const before = await readFile(path);
      atomicFailure.next = true;
      await expect(vault.mutatePropertyCatalog({ type: 'rename-property', propertyId: TEXT_ID, name: 'Short summary' }, first.hash)).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
      expect(await readFile(path)).toEqual(before);
    });
  });
});

describe('conditional general note property writes', () => {
  async function setup(dir: string) {
    const vault = await FileSystemVault.open(dir);
    let catalogHash: string | null = null;
    for (const property of definitions) catalogHash = (await vault.mutatePropertyCatalog(addProperty(property), catalogHash)).hash;
    const note = {
      ...createNote({ id: NOTE_ID, title: 'Preserve me', path: 'notes/preserve.md', body: 'Markdown body stays exactly.\n', now: NOW, tags: ['planning'], aliases: ['Old name'] }),
      extraFrontmatter: {
        icon: '📘', project: { owner: 'Nodus' }, nodus_data: { format: 'nodus-note-properties', version: 1, databases: {} },
      },
    };
    await vault.createNote(note);
    return { vault, note };
  }

  it('writes valid values for all types, keeps explicit false and empty values, and preserves unrelated note data', async () => {
    await withTempDir(async (dir) => {
      const { vault, note } = await setup(dir);
      const values: Array<[string, unknown]> = [
        [TEXT_ID, ''], [NUMBER_ID, 0], [CHECKBOX_ID, false], [DATE_ID, '2024-02-29'],
        [SELECT_ID, 'Open'], [MULTI_ID, []], [URL_ID, 'https://example.test/path'],
      ];
      let hash = (await vault.readNoteWithHash(NOTE_ID)).hash;
      for (const [propertyId, value] of values) {
        const updated = await vault.setGeneralNoteProperty(NOTE_ID, { propertyId, value: value as string | number | boolean | string[] }, { expectedHash: hash, now: LATER });
        hash = updated.hash;
        expect(updated.value).toEqual(value);
        expect(updated.note.updatedAt).toBe(LATER);
      }
      const stored = await vault.readNoteWithHash(NOTE_ID);
      expect(stored.hash).toBe(hash);
      expect(stored.note).toMatchObject({ id: NOTE_ID, title: note.title, body: note.body, tags: ['planning'], aliases: ['Old name'], createdAt: NOW, updatedAt: LATER });
      expect(stored.note.extraFrontmatter).toEqual({
        icon: '📘', project: { owner: 'Nodus' }, nodus_data: { format: 'nodus-note-properties', version: 1, databases: {} },
        summary: '', estimate: 0, reviewed: false, due: '2024-02-29', status: 'Open', topics: [], homepage: 'https://example.test/path',
      });
    });
  });

  it('unsets a value explicitly and treats an already-missing value as a no-op', async () => {
    await withTempDir(async (dir) => {
      const { vault } = await setup(dir);
      const initial = await vault.readNoteWithHash(NOTE_ID);
      const set = await vault.setGeneralNoteProperty(NOTE_ID, { propertyId: CHECKBOX_ID, value: false }, { expectedHash: initial.hash, now: LATER });
      const cleared = await vault.setGeneralNoteProperty(NOTE_ID, { propertyId: CHECKBOX_ID, unset: true }, { expectedHash: set.hash, now: NOW });
      expect(Object.hasOwn(cleared.note.extraFrontmatter, 'reviewed')).toBe(false);
      expect(cleared.note.updatedAt).toBe(NOW);
      const noOp = await vault.setGeneralNoteProperty(NOTE_ID, { propertyId: CHECKBOX_ID, unset: true }, { expectedHash: cleared.hash, now: LATER });
      expect(noOp.hash).toBe(cleared.hash);
      expect(noOp.note.updatedAt).toBe(NOW);
    });
  });

  it('rejects null, invalid types, unknown properties, missing notes, and stale revisions without writing', async () => {
    await withTempDir(async (dir) => {
      const { vault, note } = await setup(dir);
      const loaded = await vault.readNoteWithHash(NOTE_ID);
      const path = join(dir, note.path);
      const before = await readFile(path);
      await expect(vault.setGeneralNoteProperty(NOTE_ID, { propertyId: TEXT_ID, value: null as never }, { expectedHash: loaded.hash, now: LATER })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(vault.setGeneralNoteProperty(NOTE_ID, { propertyId: NUMBER_ID, value: '3' as never }, { expectedHash: loaded.hash, now: LATER })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(vault.setGeneralNoteProperty(NOTE_ID, { propertyId: OPTION_A, value: 'x' }, { expectedHash: loaded.hash, now: LATER })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(vault.setGeneralNoteProperty('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { propertyId: TEXT_ID, value: 'x' }, { expectedHash: loaded.hash, now: LATER })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await writeFile(path, Buffer.concat([before, Buffer.from('\nExternal edit') ]));
      await expect(vault.setGeneralNoteProperty(NOTE_ID, { propertyId: TEXT_ID, value: 'x' }, { expectedHash: loaded.hash, now: LATER })).rejects.toMatchObject({ code: 'STALE_WRITE' });
      expect(await readFile(path)).toEqual(Buffer.concat([before, Buffer.from('\nExternal edit') ]));
    });
  });

  it('allows only one competing update from a shared note revision', async () => {
    await withTempDir(async (dir) => {
      const { vault } = await setup(dir);
      const base = await vault.readNoteWithHash(NOTE_ID);
      const outcomes = await Promise.allSettled([
        vault.setGeneralNoteProperty(NOTE_ID, { propertyId: TEXT_ID, value: 'One' }, { expectedHash: base.hash, now: LATER }),
        vault.setGeneralNoteProperty(NOTE_ID, { propertyId: NUMBER_ID, value: 1 }, { expectedHash: base.hash, now: LATER }),
      ]);
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: 'STALE_WRITE' });
    });
  });
});
