import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import type { DatabaseDefinition } from '../src/database/schema.js';
import type { DatabaseView } from '../src/database/database-view.js';
import type { NoteTemplate } from '../src/database/templates.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { exportVault } from '../src/storage/portable/export.js';
import { createImportPreviewSnapshot, planImport } from '../src/storage/portable/import.js';
import type { ImportConflictDecision } from '../src/storage/portable/preview-session.js';
import { withTempDir } from './tmp.js';

const NOTE_ID = '2f4a3c1d-6b8e-4c9f-9a21-3d7e5f0a1b2c';
const OTHER_ID = '5c1d2e3f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
const NOW = '2026-11-05T00:00:00Z';
const DB_ID = '7a6b5c4d-3e2f-4a19-8b7c-6d5e4f3a2b10';
const RELATION_ID = '8b7c6d5e-4f3a-4b20-9c8d-7e6f5a4b3c21';
const MISSING_DB_ID = '9c8d7e6f-5a4b-4c31-8d9e-0f1a2b3c4d5e';

const addNote = async (vault: FileSystemVault, id: string, body: string): Promise<void> => {
  await vault.createNote(createNote({ id, path: `notes/${id}.md`, title: `Imported ${id.slice(0, 4)}`, body, now: NOW }));
};

async function prepared(source: FileSystemVault, target: FileSystemVault, exportPath: string) {
  await exportVault(source, exportPath);
  const result = await createImportPreviewSnapshot(exportPath, target);
  return { result, plan: await planImport(exportPath) };
}

describe('reviewed import publication', () => {
  it('publishes explicit additions from exact staged bytes and reports skips', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      await addNote(source, NOTE_ID, 'original bytes\n');
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      const binding = result.binding;
      const decisions: ImportConflictDecision[] = [
        { kind: 'note', id: NOTE_ID, path: `notes/${NOTE_ID}.md`, choice: 'add' },
      ];

      const execution = await target.applyReviewedImport(plan, binding, decisions);

      expect(execution.state).toBe('completed');
      expect(execution.resources[0]).toMatchObject({ decision: 'add', status: 'published' });
      expect(await readFile(join(target.root, `notes/${NOTE_ID}.md`))).toEqual(await readFile(join(join(dir, 'export'), `notes/${NOTE_ID}.md`)));
      expect(await readdir(join(target.root, '.nodus-import-transactions'))).toHaveLength(1);
    });
  });

  it('preserves empty folders from a portable package', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      await mkdir(join(source.root, 'empty-parent', 'empty-child'), { recursive: true });
      await addNote(source, NOTE_ID, 'note alongside empty folders\n');
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      const decisions = result.binding.resourceBindings!.map((resource) => ({ kind: resource.kind, id: resource.id, path: resource.path, choice: 'add' as const }));

      await target.applyReviewedImport(plan, result.binding, decisions);

      expect((await target.snapshotForPortableExport()).folders).toContain('empty-parent');
      expect((await target.snapshotForPortableExport()).folders).toContain('empty-parent/empty-child');
    });
  });

  it('publishes structured resources, relationships metadata, catalogs, attachments and templates through the same plan', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      await addNote(source, NOTE_ID, 'portable note\n');
      await source.createDatabase({ id: DB_ID, name: 'Calendar records', properties: [{ id: RELATION_ID, name: 'Date', type: 'date' }] });
      const view: DatabaseView = { id: OTHER_ID, databaseId: DB_ID, name: 'Calendar', type: 'calendar', settings: { startDatePropertyId: RELATION_ID }, sort: { propertyId: 'title', direction: 'asc' }, sorts: [{ propertyId: 'title', direction: 'asc' }], filters: [], visiblePropertyIds: [RELATION_ID] };
      await source.createDatabaseView(view);
      await source.writeDatabaseViewOrder(DB_ID, [OTHER_ID], { expectedHash: null });
      await source.mutatePropertyCatalog({ type: 'create-property', property: { id: '6d5e4f3a-2b10-4a19-8b7c-6d5e4f3a2b10', key: 'phase', name: 'Phase', type: 'text' } }, null);
      const attachment = await source.createAttachment('portable.txt', Buffer.from('attachment bytes'));
      await source.writeDatabaseAutomations([], null);
      const template: NoteTemplate = { id: '0f1a2b3c-4d5e-4f60-8a1b-2c3d4e5f6071', type: 'note', name: 'Starter', title: 'Starter', body: 'Body', tags: [], aliases: [], frontmatter: {}, variables: [], createdAt: NOW, updatedAt: NOW };
      await source.writeTemplates([template], null);
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      const decisions = result.binding.resourceBindings!.map((resource) => ({ kind: resource.kind, id: resource.id, path: resource.path, choice: 'add' as const }));

      const execution = await target.applyReviewedImport(plan, result.binding, decisions);
      const snapshot = await target.snapshotForPortableExport();

      expect(execution.state).toBe('completed');
      expect(snapshot.entries.map((entry) => entry.kind)).toEqual(expect.arrayContaining(['note', 'database', 'database-view', 'attachment']));
      expect(snapshot.databaseViewOrders).toHaveLength(1);
      expect(snapshot.propertyCatalog?.catalog.properties).toHaveLength(1);
      expect(snapshot.automationFiles).toHaveLength(1);
      expect(snapshot.templateFiles).toHaveLength(1);
      expect((await target.readAttachment(attachment.path)).bytes).toEqual(Buffer.from('attachment bytes'));
      expect((await target.readDatabaseViewOrder(DB_ID)).viewIds).toEqual([OTHER_ID]);
    });
  });

  it('requires explicit replace and binds it to matching identity, path, and preview hash', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      await addNote(source, NOTE_ID, 'incoming\n');
      await addNote(target, NOTE_ID, 'existing\n');
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      const resource = result.preview.resources[0]!;
      expect(resource.status).toBe('conflict');
      expect(resource.safeChoices).toContain('replace');
      await expect(target.applyReviewedImport(plan, result.binding, [
        { kind: 'note', id: NOTE_ID, path: resource.path, choice: 'replace' },
      ])).resolves.toMatchObject({ state: 'completed' });
      expect((await target.readNote(NOTE_ID)).body).toBe('incoming\n');
    });
  });

  it('rejects duplicate or mismatched decisions without publishing', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      await addNote(source, NOTE_ID, 'incoming\n');
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      const decision = { kind: 'note', id: NOTE_ID, path: `notes/${NOTE_ID}.md`, choice: 'add' as const };

      await expect(target.applyReviewedImport(plan, result.binding, [decision, decision])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(target.readNote(NOTE_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('rejects stale destination state before publication', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      await addNote(source, NOTE_ID, 'incoming\n');
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      await addNote(target, OTHER_ID, 'changed after preview\n');

      await expect(target.applyReviewedImport(plan, result.binding, [
        { kind: 'note', id: NOTE_ID, path: `notes/${NOTE_ID}.md`, choice: 'add' },
      ])).rejects.toMatchObject({ code: 'STALE_PREVIEW' });
      await expect(target.readNote(NOTE_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('rejects execution against a different vault even when its resource fingerprint matches', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const first = await FileSystemVault.open(join(dir, 'first-target'));
      const second = await FileSystemVault.open(join(dir, 'second-target'));
      await addNote(source, NOTE_ID, 'incoming\n');
      const { result, plan } = await prepared(source, first, join(dir, 'export'));

      await expect(second.applyReviewedImport(plan, result.binding, [
        { kind: 'note', id: NOTE_ID, path: `notes/${NOTE_ID}.md`, choice: 'add' },
      ])).rejects.toMatchObject({ code: 'STALE_PREVIEW' });
      await expect(second.readNote(NOTE_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('rolls back earlier files after a later publication failure', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      await mkdir(join(source.root, 'notes'), { recursive: true });
      await addNote(source, NOTE_ID, 'first\n');
      await addNote(source, OTHER_ID, 'second\n');
      await mkdir(join(source.root, 'created-on-import', 'nested'), { recursive: true });
      await addNote(target, NOTE_ID, 'old first\n');
      await addNote(target, OTHER_ID, 'old second\n');
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      const internals = target as unknown as { writeDocument(path: string, text: string | Uint8Array, allowReserved?: boolean, beforeWrite?: () => Promise<void>): Promise<void> };
      const original = internals.writeDocument.bind(target);
      let writes = 0;
      internals.writeDocument = async (...args: Parameters<typeof internals.writeDocument>) => {
        writes += 1;
        if (writes === 2) throw new Error('injected publication fault');
        return original(...args);
      };
      const decisions = result.binding.resourceBindings!.map((resource) => ({ kind: resource.kind, id: resource.id, path: resource.path, choice: 'replace' as const }));

      await expect(target.applyReviewedImport(plan, result.binding, decisions)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
      expect((await target.readNote(NOTE_ID)).body).toBe('old first\n');
      expect((await target.readNote(OTHER_ID)).body).toBe('old second\n');
      await expect(readdir(join(target.root, 'created-on-import'))).rejects.toMatchObject({ code: 'ENOENT' });
      const transactionDirs = await readdir(join(target.root, '.nodus-import-transactions'));
      const journal = JSON.parse(await readFile(join(target.root, '.nodus-import-transactions', transactionDirs[0]!, 'journal.json'), 'utf8')) as { state: string };
      expect(journal.state).toBe('rolled-back');
    });
  });

  it('keeps an interrupted publication journal and safely rolls it back later', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      await addNote(source, NOTE_ID, 'first\n');
      await addNote(source, OTHER_ID, 'second\n');
      await addNote(target, NOTE_ID, 'old first\n');
      await addNote(target, OTHER_ID, 'old second\n');
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      const targetInternals = target as unknown as {
        writeDocument(path: string, text: string | Uint8Array, allowReserved?: boolean, beforeWrite?: () => Promise<void>): Promise<void>;
        rollbackImportJournal(directory: string, journal: unknown): Promise<unknown>;
      };
      const originalWrite = targetInternals.writeDocument.bind(target);
      const originalRollback = targetInternals.rollbackImportJournal.bind(target);
      let writes = 0;
      targetInternals.writeDocument = async (...args: Parameters<typeof targetInternals.writeDocument>) => {
        writes += 1;
        if (writes === 2) throw new Error('simulated process stop at publication boundary');
        return originalWrite(...args);
      };
      targetInternals.rollbackImportJournal = async () => { throw new Error('simulated interruption before rollback'); };
      const decisions = result.binding.resourceBindings!.map((resource) => ({ kind: resource.kind, id: resource.id, path: resource.path, choice: 'replace' as const }));
      await expect(target.applyReviewedImport(plan, result.binding, decisions)).rejects.toThrow();
      targetInternals.writeDocument = originalWrite;
      targetInternals.rollbackImportJournal = originalRollback;

      const [pending] = await target.listImportOperations();
      expect(pending?.state).toBe('publishing');
      expect((await target.checkHealth()).issues.some((issue) => issue.path.includes(pending!.operationId) && issue.code === 'INCOMPLETE_WRITE')).toBe(true);
      await expect(target.snapshotForPortableExport()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
      await expect(target.snapshotWithPropertyCatalog()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
      const recovered = await target.recoverImportOperation(pending!.operationId);
      expect(recovered.state).toBe('rolled-back');
      expect((await target.readNote(NOTE_ID)).body).toBe('old first\n');
      expect((await target.readNote(OTHER_ID)).body).toBe('old second\n');
      await expect(target.snapshotForPortableExport()).resolves.toMatchObject({ entries: expect.any(Array) });
    });
  });

  it('detects and safely recovers a durable journal interrupted before staging completed', async () => {
    await withTempDir(async (dir) => {
      const target = await FileSystemVault.open(join(dir, 'target'));
      const operationId = '11111111-1111-4111-8111-111111111111';
      const transactionDirectory = join(target.root, '.nodus-import-transactions', operationId);
      await mkdir(transactionDirectory, { recursive: true, mode: 0o700 });
      const journal = {
        format: 'nodus-import-transaction', version: 1, operationId, state: 'staging',
        sourceFingerprint: 'a'.repeat(64), destinationFingerprint: 'b'.repeat(64),
        startedAt: NOW, updatedAt: NOW,
        files: [{ kind: 'note', id: NOTE_ID, path: `notes/${NOTE_ID}.md`, decision: 'add', sourceSha256: 'c'.repeat(64), size: 42, stagedName: 'resource-000000.bin', destinationSha256: null, publication: 'staged' }],
        decisions: [{ kind: 'note', id: NOTE_ID, path: `notes/${NOTE_ID}.md`, choice: 'add' }], folders: [],
      };
      const integritySha256 = createHash('sha256').update(JSON.stringify(journal), 'utf8').digest('hex');
      await writeFile(join(transactionDirectory, 'journal.json'), `${JSON.stringify({ ...journal, integritySha256 })}\n`);

      // Opening a new adapter models the application reading its durable state after restart.
      const restarted = await FileSystemVault.open(target.root);
      expect(await restarted.listImportOperations()).toMatchObject([{ operationId, state: 'staging' }]);
      const recovered = await restarted.recoverImportOperation(operationId);

      expect(recovered).toMatchObject({ operationId, state: 'rolled-back', failure: { code: 'STAGING_INTERRUPTED' } });
      await expect(restarted.readNote(NOTE_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await restarted.listImportOperations()).toMatchObject([{ operationId, state: 'rolled-back' }]);
      await expect(restarted.snapshotForPortableExport()).resolves.toMatchObject({ entries: expect.any(Array) });
    });
  });

  it('keeps destinations unchanged and leaves staging recoverable when journal storage fails with ENOSPC', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      await addNote(source, NOTE_ID, 'incoming bytes\n');
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      const decisions = result.binding.resourceBindings!.map((resource) => ({ kind: resource.kind, id: resource.id, path: resource.path, choice: 'add' as const }));
      const internals = target as unknown as { writeImportJournal(directory: string, journal: unknown): Promise<void> };
      const original = internals.writeImportJournal.bind(target);
      let writes = 0;
      internals.writeImportJournal = async (...args: Parameters<typeof internals.writeImportJournal>) => {
        writes += 1;
        if (writes === 2) throw Object.assign(new Error('simulated disk full while finalizing staged import'), { code: 'ENOSPC' });
        return original(...args);
      };

      await expect(target.applyReviewedImport(plan, result.binding, decisions)).rejects.toThrow(/ENOSPC|disk full/i);
      internals.writeImportJournal = original;
      await expect(target.readNote(NOTE_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const [operation] = await target.listImportOperations();
      expect(operation?.state).toBe('staging');
      const recovered = await target.recoverImportOperation(operation!.operationId);
      expect(recovered).toMatchObject({ state: 'rolled-back', failure: { code: 'STAGING_INTERRUPTED' } });
      await expect(target.readNote(NOTE_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('cleans a failed staged-file write without publishing or changing the destination', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      await addNote(source, NOTE_ID, 'incoming bytes\n');
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      const decisions = result.binding.resourceBindings!.map((resource) => ({ kind: resource.kind, id: resource.id, path: resource.path, choice: 'add' as const }));
      const internals = target as unknown as { writeImportStagedFile(path: string, bytes: Uint8Array): Promise<void> };
      internals.writeImportStagedFile = async () => { throw Object.assign(new Error('simulated staging disk full'), { code: 'ENOSPC' }); };

      await expect(target.applyReviewedImport(plan, result.binding, decisions)).rejects.toThrow(/ENOSPC|disk full/i);
      await expect(target.readNote(NOTE_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(target.listImportOperations()).resolves.toEqual([]);
    });
  });

  it('rejects selected database schemas with unresolved relation targets before publication', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      const database: DatabaseDefinition = { id: DB_ID, name: 'Incoming relation schema', properties: [{ id: RELATION_ID, name: 'Missing target', type: 'relation', relation: { databaseId: MISSING_DB_ID, cardinality: 'many' } }] };
      await source.createDatabase(database);
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      const decisions = result.binding.resourceBindings!.map((resource) => ({ kind: resource.kind, id: resource.id, path: resource.path, choice: 'add' as const }));

      await expect(target.applyReviewedImport(plan, result.binding, decisions)).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      await expect(target.readDatabase(DB_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('does not overwrite a resource changed by another actor before recovery', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      await addNote(source, NOTE_ID, 'incoming one\n');
      await addNote(source, OTHER_ID, 'incoming two\n');
      await addNote(target, NOTE_ID, 'original one\n');
      await addNote(target, OTHER_ID, 'original two\n');
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      const internals = target as unknown as {
        writeDocument(path: string, text: string | Uint8Array, allowReserved?: boolean, beforeWrite?: () => Promise<void>): Promise<void>;
        rollbackImportJournal(directory: string, journal: unknown): Promise<unknown>;
      };
      const originalWrite = internals.writeDocument.bind(target);
      const originalRollback = internals.rollbackImportJournal.bind(target);
      let writes = 0;
      internals.writeDocument = async (...args: Parameters<typeof internals.writeDocument>) => {
        writes += 1;
        if (writes === 2) throw new Error('interruption');
        return originalWrite(...args);
      };
      internals.rollbackImportJournal = async () => { throw new Error('simulated process interruption'); };
      const decisions = result.binding.resourceBindings!.map((resource) => ({ kind: resource.kind, id: resource.id, path: resource.path, choice: 'replace' as const }));
      await expect(target.applyReviewedImport(plan, result.binding, decisions)).rejects.toThrow();
      internals.writeDocument = originalWrite;
      internals.rollbackImportJournal = originalRollback;

      const externalContent = 'external edit after interruption\n';
      await writeFile(join(target.root, `notes/${NOTE_ID}.md`), externalContent, 'utf8');
      const [pending] = await target.listImportOperations();
      await expect(target.recoverImportOperation(pending!.operationId)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
      expect(await readFile(join(target.root, `notes/${NOTE_ID}.md`), 'utf8')).toBe(externalContent);
      const [status] = await target.listImportOperations();
      expect(status?.state).toBe('recovery-required');
    });
  });

  it('resumes a verified partial publication idempotently from staged bytes', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      await addNote(source, NOTE_ID, 'incoming one\n');
      await addNote(source, OTHER_ID, 'incoming two\n');
      await addNote(target, NOTE_ID, 'original one\n');
      await addNote(target, OTHER_ID, 'original two\n');
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      const internals = target as unknown as {
        writeDocument(path: string, text: string | Uint8Array, allowReserved?: boolean, beforeWrite?: () => Promise<void>): Promise<void>;
        rollbackImportJournal(directory: string, journal: unknown): Promise<unknown>;
      };
      const originalWrite = internals.writeDocument.bind(target);
      const originalRollback = internals.rollbackImportJournal.bind(target);
      let writes = 0;
      internals.writeDocument = async (...args: Parameters<typeof internals.writeDocument>) => {
        writes += 1;
        if (writes === 2) throw new Error('simulated interruption');
        return originalWrite(...args);
      };
      internals.rollbackImportJournal = async () => { throw new Error('simulated interruption before rollback'); };
      const decisions = result.binding.resourceBindings!.map((resource) => ({ kind: resource.kind, id: resource.id, path: resource.path, choice: 'replace' as const }));
      await expect(target.applyReviewedImport(plan, result.binding, decisions)).rejects.toThrow();
      internals.writeDocument = originalWrite;
      internals.rollbackImportJournal = originalRollback;
      const [pending] = await target.listImportOperations();

      const retried = await target.retryImportOperation(pending!.operationId);

      expect(retried.state).toBe('completed');
      expect(retried.resources).toHaveLength(2);
      expect((await target.readNote(NOTE_ID)).body).toBe('incoming one\n');
      expect((await target.readNote(OTHER_ID)).body).toBe('incoming two\n');
      expect((await target.listImportOperations())[0]?.state).toBe('committed');
    });
  });

  it('surfaces a corrupted journal and refuses recovery mutation', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const target = await FileSystemVault.open(join(dir, 'target'));
      await addNote(source, NOTE_ID, 'incoming\n');
      const { result, plan } = await prepared(source, target, join(dir, 'export'));
      const decision = { kind: 'note', id: NOTE_ID, path: `notes/${NOTE_ID}.md`, choice: 'add' as const };
      const completed = await target.applyReviewedImport(plan, result.binding, [decision]);
      const directory = join(target.root, '.nodus-import-transactions', completed.operationId);
      await writeFile(join(directory, 'journal.json'), '{malformed');

      expect((await target.listImportOperations())[0]).toMatchObject({ state: 'corrupt', operationId: completed.operationId });
      await expect(target.snapshotForPortableExport()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
      await expect(target.recoverImportOperation(completed.operationId)).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      expect((await target.readNote(NOTE_ID)).body).toBe('incoming\n');
    });
  });
});
