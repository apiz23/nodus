import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TEMPLATE_CATALOG_DIR, TEMPLATE_CATALOG_PATH } from '../src/storage/fs/layout.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { serializeTemplates, type DatabaseTemplate, type NoteTemplate, TEMPLATE_FORMAT } from '../src/database/templates.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-11-02T00:00:00.000Z';
const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const DB_TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const DATABASE_ID = '33333333-3333-4333-8333-333333333333';
const VIEW_ID = '77777777-7777-4777-8777-777777777777';
const NOTE_TEMPLATE: NoteTemplate = {
  id: NOTE_ID, type: 'note', name: 'Daily', title: 'Daily', body: '# Notes', tags: [], aliases: [],
  frontmatter: {}, variables: [], createdAt: NOW, updatedAt: NOW,
};
const DATABASE_TEMPLATE: DatabaseTemplate = {
  id: DB_TEMPLATE_ID, type: 'database', name: 'Tasks', database: { id: DATABASE_ID, name: 'Tasks', properties: [] },
  views: [{ id: VIEW_ID, databaseId: DATABASE_ID, name: 'All tasks', sort: { propertyId: 'title', direction: 'asc' }, filters: [], visiblePropertyIds: [] }], starterRows: [], createdAt: NOW, updatedAt: NOW,
};

async function writeCatalog(root: string, text: string) {
  await mkdir(join(root, TEMPLATE_CATALOG_DIR), { recursive: true });
  await writeFile(join(root, TEMPLATE_CATALOG_PATH), text, 'utf8');
}

describe('template storage health diagnostics', () => {
  it('accepts valid note and database templates and treats absent or empty storage as optional', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      expect((await vault.checkHealth()).issues).toEqual([]);
      await mkdir(join(root, TEMPLATE_CATALOG_DIR));
      expect((await vault.checkHealth()).issues).toEqual([]);
      await vault.writeTemplates([NOTE_TEMPLATE, DATABASE_TEMPLATE], null);
      expect((await vault.checkHealth()).issues).toEqual([]);
    });
  });

  it.each([
    ['malformed JSON', '{bad', 'INVALID_CONTENT'],
    ['unsupported catalog version', JSON.stringify({ format: TEMPLATE_FORMAT, version: 8, templates: [] }), 'UNSUPPORTED_VERSION'],
    ['invalid template metadata', JSON.stringify({ format: TEMPLATE_FORMAT, version: 1, templates: [{ ...NOTE_TEMPLATE, name: '' }] }), 'INVALID_CONTENT'],
    ['duplicate template IDs', JSON.stringify({ format: TEMPLATE_FORMAT, version: 1, templates: [NOTE_TEMPLATE, { ...NOTE_TEMPLATE, type: 'note', name: 'Copy' }] }), 'DUPLICATE_ID'],
    ['invalid saved-view metadata', JSON.stringify({ format: TEMPLATE_FORMAT, version: 1, templates: [{ ...DATABASE_TEMPLATE, views: [{ ...DATABASE_TEMPLATE.views[0], unexpected: true }] }] }), 'INVALID_CONTENT'],
    ['invalid saved-view references', JSON.stringify({ format: TEMPLATE_FORMAT, version: 1, templates: [{ ...DATABASE_TEMPLATE, views: [{ id: '55555555-5555-4555-8555-555555555555', databaseId: DATABASE_ID, name: 'Broken view', sort: { propertyId: '66666666-6666-4666-8666-666666666666', direction: 'asc' }, filters: [], visiblePropertyIds: [] }] }] }), 'INVALID_CONTENT'],
  ] as const)('reports %s with a stable path and actionable recovery guidance', async (_label, text, code) => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await writeCatalog(root, text);
      const before = await readFile(join(root, TEMPLATE_CATALOG_PATH));
      const issues = (await vault.checkHealth()).issues;
      expect(issues).toEqual([expect.objectContaining({ code, path: TEMPLATE_CATALOG_PATH })]);
      expect(issues[0]?.message).toMatch(/restore|unique|supports|permissions|preserve/i);
      expect(await readFile(join(root, TEMPLATE_CATALOG_PATH))).toEqual(before);
    });
  });

  it('reports an unreadable catalog as a scoped issue without changing it', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.writeTemplates([NOTE_TEMPLATE], null);
      const before = await readFile(join(root, TEMPLATE_CATALOG_PATH));
      const prototype = FileSystemVault.prototype as unknown as {
        readBytesAt(this: FileSystemVault, absolute: string, path: string): Promise<Buffer>;
      };
      const original = prototype.readBytesAt;
      const spy = vi.spyOn(prototype, 'readBytesAt').mockImplementation(async function (this: FileSystemVault, absolute: string, path: string) {
        if (path === TEMPLATE_CATALOG_PATH) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
        return original.call(this, absolute, path);
      });
      try {
        const issue = (await vault.checkHealth()).issues.find((item) => item.path === TEMPLATE_CATALOG_PATH);
        expect(issue).toMatchObject({ code: 'INVALID_CONTENT' });
        expect(issue?.message).toMatch(/permission denied/i);
        expect(issue?.message).toMatch(/no files were changed/i);
        expect(await readFile(join(root, TEMPLATE_CATALOG_PATH))).toEqual(before);
      } finally { spy.mockRestore(); }
    });
  });

  it('converts template-directory I/O failures into read-only health issues', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await mkdir(join(root, TEMPLATE_CATALOG_DIR));
      const prototype = FileSystemVault.prototype as unknown as {
        readTemplateStorageChildren(this: FileSystemVault, directory: string): Promise<unknown[]>;
      };
      const spy = vi.spyOn(prototype, 'readTemplateStorageChildren').mockRejectedValue(Object.assign(new Error('device I/O failed'), { code: 'EIO' }));
      try {
        const issue = (await vault.checkHealth()).issues.find((item) => item.path === TEMPLATE_CATALOG_DIR);
        expect(issue).toMatchObject({ code: 'INVALID_CONTENT' });
        expect(issue?.message).toMatch(/device I\/O failed/i);
        expect(issue?.message).toMatch(/no files were changed/i);
        expect(await readdir(join(root, TEMPLATE_CATALOG_DIR))).toEqual([]);
      } finally { spy.mockRestore(); }
    });
  });

  it('reports non-regular catalog storage and unexpected entries without following or removing them', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      const catalogDirectory = join(root, TEMPLATE_CATALOG_DIR);
      await mkdir(catalogDirectory);
      await mkdir(join(catalogDirectory, 'templates.json'));
      await writeFile(join(catalogDirectory, 'keep.txt'), 'user data');
      const before = await readdir(catalogDirectory);
      expect((await vault.checkHealth()).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'UNSAFE_PATH', path: TEMPLATE_CATALOG_PATH }),
        expect.objectContaining({ code: 'INVALID_CONTENT', path: `${TEMPLATE_CATALOG_DIR}/keep.txt` }),
      ]));
      expect(await readdir(catalogDirectory)).toEqual(before);
      expect(await readdir(join(catalogDirectory, 'templates.json'))).toEqual([]);
    });
  });

  it('keeps diagnostics scoped to the vault and preserves existing note-health findings', async () => {
    await withTempDir(async (parent) => {
      const damagedRoot = join(parent, 'damaged');
      const cleanRoot = join(parent, 'clean');
      const damaged = await FileSystemVault.open(damagedRoot);
      const clean = await FileSystemVault.open(cleanRoot);
      await mkdir(join(damagedRoot, 'notes'));
      await writeFile(join(damagedRoot, 'notes/broken.md'), '---\ntitle: [broken\nnodus:\n  version: 1\n---\nBody\n');
      await writeCatalog(damagedRoot, '{bad');

      const damagedIssues = (await damaged.checkHealth()).issues;
      expect(damagedIssues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'notes/broken.md' }),
        expect.objectContaining({ path: TEMPLATE_CATALOG_PATH, code: 'INVALID_CONTENT' }),
      ]));
      expect((await clean.checkHealth()).issues).toEqual([]);
      expect(damagedIssues.some((issue) => issue.path.includes('clean'))).toBe(false);
    });
  });
});
