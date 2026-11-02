import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { serializeDatabaseView, type DatabaseView } from '../src/database/database-view.js';
import type { ImportPlan } from '../src/storage/contracts.js';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { databaseViewPath } from '../src/storage/fs/layout.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-11-02T00:00:00Z';
const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const DATABASE_ID = '22222222-2222-4222-8222-222222222222';
const VIEW_ID = '33333333-3333-4333-8333-333333333333';
const ROW_ID = '44444444-4444-4444-8444-444444444444';
const ROW_PATH = 'notes/starter-row.md';
const database = { id: DATABASE_ID, name: 'Tasks', properties: [] };
const view: DatabaseView = {
  id: VIEW_ID, databaseId: DATABASE_ID, name: 'All tasks',
  sort: { propertyId: 'title', direction: 'asc' }, filters: [], visiblePropertyIds: [],
};
const note = createNote({ id: ROW_ID, path: ROW_PATH, title: 'Starter row', body: '', now: NOW });
const plan: ImportPlan = {
  notes: [note], databases: [database], databaseViews: [view],
  entries: [{ kind: 'database-view', id: VIEW_ID, path: databaseViewPath(DATABASE_ID, VIEW_ID), text: serializeDatabaseView(view) }],
};
const options = { atomicNewFiles: true, sourceTemplateId: TEMPLATE_ID } as const;

type PublishFile = (this: FileSystemVault, staged: string, target: string, relativePath: string) => Promise<void>;
type Rollback = (this: FileSystemVault, transactionPath: string, manifest: unknown) => Promise<void>;

function publishPrototype() {
  return FileSystemVault.prototype as unknown as { publishTemplateTransactionFile: PublishFile };
}

describe('recoverable database-template application', () => {
  it('validates the complete new-file plan before creating transaction or destination files', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      const invalid: ImportPlan = { ...plan, notes: [{ ...note, path: 'notes/../escape.md' }] };
      await expect(vault.applyImport(invalid, options)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
      expect(await readdir(root)).toEqual([]);
    });
  });

  it.each([
    ['first', ROW_PATH],
    ['subsequent', databaseViewPath(DATABASE_ID, VIEW_ID)],
  ] as const)('rolls back every owned file when the %s publish fails', async (_stage, failedPath) => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      const prototype = publishPrototype();
      const original = prototype.publishTemplateTransactionFile;
      let injected = false;
      const spy = vi.spyOn(prototype, 'publishTemplateTransactionFile').mockImplementation(async function (this: FileSystemVault, staged: string, target: string, relativePath: string) {
        if (!injected && relativePath === failedPath) { injected = true; throw Object.assign(new Error('injected link failure'), { code: 'EIO' }); }
        return original.call(this, staged, target, relativePath);
      });
      try {
        await expect(vault.applyImport(plan, options)).rejects.toThrow(/injected link failure/);
        expect(injected).toBe(true);
        expect(await vault.listNotes()).toEqual([]);
        expect(await vault.listDatabases()).toEqual([]);
        expect((await vault.checkHealth()).issues).toEqual([]);
        expect((await readdir(root)).some((name) => name.startsWith('.nodus-tmp-template-apply-'))).toBe(false);
      } finally { spy.mockRestore(); }
    });
  });

  it('recovers a failed rollback on explicit retry without duplicate notes or database files', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      const prototype = publishPrototype();
      const publish = prototype.publishTemplateTransactionFile;
      const rollbackPrototype = FileSystemVault.prototype as unknown as { rollbackTemplateApplyTransaction: Rollback };
      const rollback = rollbackPrototype.rollbackTemplateApplyTransaction;
      let publishes = 0;
      const publishSpy = vi.spyOn(prototype, 'publishTemplateTransactionFile').mockImplementation(async function (this: FileSystemVault, staged: string, target: string, relativePath: string) {
        publishes += 1;
        if (publishes === 2) throw Object.assign(new Error('injected second publish failure'), { code: 'EIO' });
        return publish.call(this, staged, target, relativePath);
      });
      const rollbackSpy = vi.spyOn(rollbackPrototype, 'rollbackTemplateApplyTransaction').mockRejectedValueOnce(new Error('injected rollback failure'));
      try {
        await expect(vault.applyImport(plan, options)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
        const interrupted = (await vault.checkHealth()).issues.find((issue) => issue.code === 'INCOMPLETE_WRITE');
        expect(interrupted?.message).toMatch(/explicit database template apply.*roll back/i);
        expect(interrupted?.path).toMatch(/^\.nodus-tmp-template-apply-/);
        await expect(vault.snapshotWithPropertyCatalog()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
      } finally { publishSpy.mockRestore(); rollbackSpy.mockRestore(); }

      const report = await vault.applyImport(plan, options);
      expect(report).toMatchObject({ notes: 1, databases: 1, databaseViews: 1 });
      expect(await vault.listNotes()).toHaveLength(1);
      expect(await vault.listDatabases()).toHaveLength(1);
      expect(await vault.listDatabaseViews(DATABASE_ID)).toHaveLength(1);
      expect((await vault.checkHealth()).issues).toEqual([]);
      expect(await readFile(join(root, ROW_PATH), 'utf8')).toContain('Starter row');
    });
  });

  it('preserves existing conflicts and unrelated user files', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await mkdir(join(root, 'notes'), { recursive: true });
      await writeFile(join(root, 'notes/keep.md'), 'User file\n');
      await vault.createNote(createNote({ id: '55555555-5555-4555-8555-555555555555', path: ROW_PATH, title: 'Existing', body: 'User content', now: NOW }));
      await expect(vault.applyImport(plan, options)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await readFile(join(root, 'notes/keep.md'), 'utf8')).toBe('User file\n');
      expect((await vault.readNoteAtPath(ROW_PATH)).title).toBe('Existing');
      expect(await vault.listDatabases()).toEqual([]);
    });
  });

  it('does not replace or remove a path that appears after preflight', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      const prototype = publishPrototype();
      const original = prototype.publishTemplateTransactionFile;
      const spy = vi.spyOn(prototype, 'publishTemplateTransactionFile').mockImplementation(async function (this: FileSystemVault, staged: string, target: string, relativePath: string) {
        await mkdir(join(root, 'notes'), { recursive: true });
        await writeFile(join(root, ROW_PATH), 'External writer\n');
        return original.call(this, staged, target, relativePath);
      });
      try {
        await expect(vault.applyImport(plan, options)).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(await readFile(join(root, ROW_PATH), 'utf8')).toBe('External writer\n');
        expect(await vault.listDatabases()).toEqual([]);
        expect((await vault.checkHealth()).issues).toEqual([]);
      } finally { spy.mockRestore(); }
    });
  });

  it('preserves an in-place external edit and leaves the recovery journal for inspection', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      const prototype = publishPrototype();
      const original = prototype.publishTemplateTransactionFile;
      const spy = vi.spyOn(prototype, 'publishTemplateTransactionFile').mockImplementation(async function (this: FileSystemVault, staged: string, target: string, relativePath: string) {
        if (relativePath === databaseViewPath(DATABASE_ID, VIEW_ID)) throw Object.assign(new Error('injected later publish failure'), { code: 'EIO' });
        await original.call(this, staged, target, relativePath);
        if (relativePath === ROW_PATH) await writeFile(join(root, ROW_PATH), 'External in-place edit\n');
      });
      try {
        await expect(vault.applyImport(plan, options)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
        expect(await readFile(join(root, ROW_PATH), 'utf8')).toBe('External in-place edit\n');
        expect(await vault.listDatabases()).toEqual([]);
        expect((await vault.checkHealth()).issues.some((issue) => issue.path.startsWith('.nodus-tmp-template-apply-'))).toBe(true);
      } finally { spy.mockRestore(); }
    });
  });
});
