import { describe, expect, it } from 'vitest';
import { createNote, type Note } from '../src/domain/note.js';
import { projectRelations } from '../src/database/relations.js';
import { serializeDatabase, type DatabaseDefinition } from '../src/database/schema.js';
import { serializeNote } from '../src/format/note-format.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createBackup, restoreBackup } from '../src/storage/backup/backup.js';
import { exportVault } from '../src/storage/portable/export.js';
import { planImport } from '../src/storage/portable/import.js';
import { withTempDir } from './tmp.js';
import { join } from 'node:path';
import { mkdir, unlink, writeFile } from 'node:fs/promises';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SOURCE_DB = id(1), TARGET_DB = id(2), OTHER_DB = id(3), CHANGED_TARGET_DB = id(4);
const RELATION = id(5), SOURCE = id(10), TARGET = id(11), TARGET_TWO = id(12), OTHER_TARGET = id(13), MISSING = id(14);
const NOW = '2026-10-31T00:00:00Z';

const sourceSchema: DatabaseDefinition = {
  id: SOURCE_DB,
  name: 'Sources',
  properties: [{ id: RELATION, name: 'Targets', type: 'relation', relation: { databaseId: TARGET_DB, cardinality: 'many' } }],
};
const targetSchema: DatabaseDefinition = { id: TARGET_DB, name: 'Targets', properties: [] };
const otherSchema: DatabaseDefinition = { id: OTHER_DB, name: 'Other', properties: [] };

function record(noteId: string, title: string, path: string, databaseId: string, values: Record<string, unknown> = {}): Note {
  return {
    ...createNote({ id: noteId, title, path, body: `Body for ${title}`, now: NOW }),
    extraFrontmatter: {
      nodus_data: { format: 'nodus-note-properties', version: 1, databases: { [databaseId]: values } },
    },
  };
}

async function seed(root: string, relationIds: string[] = []) {
  const vault = await FileSystemVault.open(root);
  await vault.createDatabase(sourceSchema);
  await vault.createDatabase(targetSchema);
  await vault.createDatabase(otherSchema);
  await vault.createNote(record(SOURCE, 'Source', 'source.md', SOURCE_DB, { [RELATION]: relationIds }));
  await vault.createNote(record(TARGET, 'Target one', 'target-one.md', TARGET_DB));
  await vault.createNote(record(TARGET_TWO, 'Target two', 'target-two.md', TARGET_DB));
  await vault.createNote(record(OTHER_TARGET, 'Other target', 'other-target.md', OTHER_DB));
  return vault;
}

async function setRelation(vault: FileSystemVault, value: unknown, baseHash?: string) {
  const current = baseHash === undefined ? await vault.readNoteWithHash(SOURCE) : undefined;
  return vault.setNoteProperty(SOURCE, { databaseId: SOURCE_DB, propertyId: RELATION, value }, {
    expectedHash: baseHash ?? current!.hash,
    now: NOW,
  });
}

function expectWriteIssue(result: Awaited<ReturnType<typeof setRelation>>, code: string) {
  expect(result).toMatchObject({ ok: false, issues: [{ code }] });
}

describe('relation storage and API hardening', () => {
  it('revalidates target existence and membership at write time with precise issue codes', async () => {
    await withTempDir(async (root) => {
      const vault = await seed(root);
      const initial = await vault.readNoteWithHash(SOURCE);

      expectWriteIssue(await setRelation(vault, [MISSING], initial.hash), 'MISSING_TARGET');
      expectWriteIssue(await setRelation(vault, [OTHER_TARGET], initial.hash), 'INCOMPATIBLE_TARGET');
      expect((await vault.readNoteWithHash(SOURCE)).hash).toBe(initial.hash);

      await vault.deleteDatabase(TARGET_DB);
      expectWriteIssue(await setRelation(vault, [TARGET], initial.hash), 'INVALID_CONFIGURATION');
      // Explicit clearing is a repair operation and remains possible when a target database was deleted.
      expect((await setRelation(vault, [])).ok).toBe(true);
    });
  });

  it('rejects a target deleted after the caller read the source and keeps the source unchanged', async () => {
    await withTempDir(async (root) => {
      const vault = await seed(root);
      const sourceBefore = await vault.readNoteWithHash(SOURCE);
      const targetBefore = await vault.readNoteWithHash(TARGET);
      await vault.deleteNote(TARGET, { expectedHash: targetBefore.hash });

      expectWriteIssue(await setRelation(vault, [TARGET], sourceBefore.hash), 'MISSING_TARGET');
      expect((await vault.readNoteWithHash(SOURCE)).hash).toBe(sourceBefore.hash);
    });
  });

  it('serializes concurrent relation updates and rejects the stale writer', async () => {
    await withTempDir(async (root) => {
      const vault = await seed(root);
      const source = await vault.readNoteWithHash(SOURCE);
      const writes = await Promise.allSettled([
        setRelation(vault, [TARGET], source.hash),
        setRelation(vault, [TARGET_TWO], source.hash),
      ]);

      const successful = writes.filter((write) => write.status === 'fulfilled' && write.value.ok);
      const stale = writes.filter((write) => write.status === 'rejected' && (write.reason as { code?: string }).code === 'STALE_WRITE');
      expect(successful).toHaveLength(1);
      expect(stale).toHaveLength(1);
      const final = await vault.readNoteWithHash(SOURCE);
      const values = final.note.extraFrontmatter.nodus_data as { databases: Record<string, Record<string, unknown>> };
      expect([[TARGET], [TARGET_TWO]]).toContainEqual(values.databases[SOURCE_DB]?.[RELATION]);
    });
  });

  it('orders concurrent target deletion with relation assignment under the shared root lock', async () => {
    await withTempDir(async (root) => {
      const vault = await seed(root);
      const source = await vault.readNoteWithHash(SOURCE);
      const target = await vault.readNoteWithHash(TARGET);

      const write = setRelation(vault, [TARGET], source.hash);
      const deletion = vault.deleteNote(TARGET, { expectedHash: target.hash });
      const [writeResult] = await Promise.all([write, deletion]);
      expect(writeResult.ok).toBe(true);

      const sourceAfter = await vault.readNoteWithHash(SOURCE);
      const raw = sourceAfter.note.extraFrontmatter.nodus_data as { databases: Record<string, Record<string, unknown>> };
      expect(raw.databases[SOURCE_DB]?.[RELATION]).toEqual([TARGET]);
      const graph = projectRelations(await vault.snapshotNotes(), new Map([[SOURCE_DB, sourceSchema], [TARGET_DB, targetSchema], [OTHER_DB, otherSchema]]));
      expect(graph.rows.get(SOURCE)?.get(SOURCE_DB)?.relations[RELATION]?.[0]).toMatchObject({ id: TARGET, status: 'missing' });
    });

    await withTempDir(async (root) => {
      const vault = await seed(root);
      const source = await vault.readNoteWithHash(SOURCE);
      const target = await vault.readNoteWithHash(TARGET);
      const deletion = vault.deleteNote(TARGET, { expectedHash: target.hash });
      const write = setRelation(vault, [TARGET], source.hash);
      const [, writeResult] = await Promise.all([deletion, write]);
      expectWriteIssue(writeResult, 'MISSING_TARGET');
      expect((await vault.readNoteWithHash(SOURCE)).hash).toBe(source.hash);
    });
  });

  it('preserves references when a target loses membership or its database is deleted', async () => {
    await withTempDir(async (root) => {
      const vault = await seed(root, [TARGET]);
      const sourceBeforeMembershipMove = await vault.readNoteWithHash(SOURCE);
      const target = await vault.readNoteWithHash(TARGET);
      await vault.moveNote(TARGET, 'moved/target.md', { expectedHash: target.hash });
      let graph = projectRelations(await vault.snapshotNotes(), new Map([[SOURCE_DB, sourceSchema], [TARGET_DB, targetSchema], [OTHER_DB, otherSchema]]));
      expect(graph.rows.get(SOURCE)?.get(SOURCE_DB)?.relations[RELATION]?.[0]).toMatchObject({ id: TARGET, status: 'resolved', path: 'moved/target.md' });

      const moved = await vault.readNoteWithHash(TARGET);
      const movedMembership = {
        ...moved.note,
        extraFrontmatter: {
          nodus_data: { format: 'nodus-note-properties', version: 1, databases: { [OTHER_DB]: {} } },
        },
      };
      await vault.replaceNote(movedMembership, { expectedHash: moved.hash });
      expectWriteIssue(await setRelation(vault, [TARGET], sourceBeforeMembershipMove.hash), 'INCOMPATIBLE_TARGET');
      expect((await vault.readNoteWithHash(SOURCE)).hash).toBe(sourceBeforeMembershipMove.hash);

      const schemas = new Map([[SOURCE_DB, sourceSchema], [TARGET_DB, targetSchema], [OTHER_DB, otherSchema]]);
      graph = projectRelations(await vault.snapshotNotes(), schemas);
      expect(graph.rows.get(SOURCE)?.get(SOURCE_DB)?.values[RELATION]).toEqual([TARGET]);
      expect(graph.rows.get(SOURCE)?.get(SOURCE_DB)?.relations[RELATION]?.[0]).toMatchObject({ status: 'incompatible' });

      const sourceBeforeDatabaseDelete = await vault.readNoteWithHash(SOURCE);
      await vault.deleteDatabase(TARGET_DB);
      const sourceAfterDatabaseDelete = await vault.readNoteWithHash(SOURCE);
      expect(sourceAfterDatabaseDelete.hash).toBe(sourceBeforeDatabaseDelete.hash);
      graph = projectRelations(await vault.snapshotNotes(), new Map([[SOURCE_DB, sourceSchema], [OTHER_DB, otherSchema]]));
      expect(graph.rows.get(SOURCE)?.get(SOURCE_DB)?.values[RELATION]).toEqual([TARGET]);
      expect(graph.diagnostics.map((issue) => issue.code)).toContain('INVALID_CONFIGURATION');
    });

    await withTempDir(async (root) => {
      const vault = await seed(root);
      const source = await vault.readNoteWithHash(SOURCE);
      const deletion = vault.deleteDatabase(TARGET_DB);
      const write = setRelation(vault, [TARGET], source.hash);
      const [, result] = await Promise.all([deletion, write]);
      expectWriteIssue(result, 'INVALID_CONFIGURATION');
      expect((await vault.readNoteWithHash(SOURCE)).hash).toBe(source.hash);
    });
  });

  it('deletes a source record without cascading into its linked target', async () => {
    await withTempDir(async (root) => {
      const vault = await seed(root, [TARGET]);
      const source = await vault.readNoteWithHash(SOURCE);
      await vault.deleteNote(SOURCE, { expectedHash: source.hash });

      await expect(vault.readNoteWithHash(SOURCE)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await vault.readNoteWithHash(TARGET)).note.id).toBe(TARGET);
    });
  });

  it('allows partial import with missing targets and does not remap IDs when a target database ID changes', async () => {
    await withTempDir(async (root) => {
      const sourceVault = await seed(join(root, 'source'), [MISSING]);
      const exportPath = join(root, 'portable');
      await exportVault(sourceVault, exportPath);
      await unlink(join(exportPath, 'target-one.md'));

      const partial = await FileSystemVault.open(join(root, 'partial'));
      await partial.applyImport(await planImport(exportPath));
      const importedNotes = await partial.snapshotNotes();
      const importedSchemas = new Map((await partial.listDatabases()).map((summary) => [summary.id, summary.id]));
      const schemas = new Map(await Promise.all([...importedSchemas.keys()].map(async (databaseId) => [databaseId, await partial.readDatabase(databaseId)] as const)));
      const graph = projectRelations(importedNotes, schemas);
      expect(graph.rows.get(SOURCE)?.get(SOURCE_DB)?.values[RELATION]).toEqual([MISSING]);
      expect(graph.rows.get(SOURCE)?.get(SOURCE_DB)?.relations[RELATION]?.[0]).toMatchObject({ id: MISSING, status: 'missing' });

      const changedExport = join(root, 'changed-target-export');
      await mkdir(join(changedExport, 'databases'), { recursive: true });
      const changedDatabase: DatabaseDefinition = { ...targetSchema, id: CHANGED_TARGET_DB, name: 'Renumbered target' };
      const changedNotes = [
        record(SOURCE, 'Source', 'source.md', SOURCE_DB, { [RELATION]: [TARGET] }),
        record(TARGET, 'Target one', 'target-one.md', CHANGED_TARGET_DB),
      ];
      await writeFile(join(changedExport, `databases/${SOURCE_DB}.json`), serializeDatabase(sourceSchema));
      await writeFile(join(changedExport, `databases/${CHANGED_TARGET_DB}.json`), serializeDatabase(changedDatabase));
      await writeFile(join(changedExport, `databases/${OTHER_DB}.json`), serializeDatabase(otherSchema));
      for (const note of changedNotes) await writeFile(join(changedExport, note.path), serializeNote(note));
      const changedPlan = await planImport(changedExport);
      const changedDestination = await FileSystemVault.open(join(root, 'changed-target'));
      await changedDestination.applyImport(changedPlan);
      const storedSource = await changedDestination.readNoteWithHash(SOURCE);
      const sourceProperties = storedSource.note.extraFrontmatter.nodus_data as { databases: Record<string, Record<string, unknown>> };
      expect(sourceProperties.databases[SOURCE_DB]?.[RELATION]).toEqual([TARGET]);
      const actualSchemas = new Map(await Promise.all([SOURCE_DB, CHANGED_TARGET_DB, OTHER_DB].map(async (databaseId) => [databaseId, await changedDestination.readDatabase(databaseId)] as const)));
      const changedGraph = projectRelations(await changedDestination.snapshotNotes(), actualSchemas);
      expect(changedGraph.rows.get(SOURCE)?.get(SOURCE_DB)?.values[RELATION]).toEqual([TARGET]);
      expect(changedGraph.diagnostics.map((issue) => issue.code)).toContain('INVALID_CONFIGURATION');
    });
  });

  it('preserves dangling IDs through backup and restore', async () => {
    await withTempDir(async (root) => {
      const vault = await seed(join(root, 'source'), [MISSING]);
      const backup = join(root, 'backup');
      await createBackup(vault, backup);
      const restoredRoot = join(root, 'restored');
      await restoreBackup(backup, restoredRoot);
      const restored = await FileSystemVault.open(restoredRoot);
      const source = await restored.readNoteWithHash(SOURCE);
      const raw = source.note.extraFrontmatter.nodus_data as { databases: Record<string, Record<string, unknown>> };
      expect(raw.databases[SOURCE_DB]?.[RELATION]).toEqual([MISSING]);
      const graph = projectRelations(await restored.snapshotNotes(), new Map([[SOURCE_DB, sourceSchema], [TARGET_DB, targetSchema], [OTHER_DB, otherSchema]]));
      expect(graph.rows.get(SOURCE)?.get(SOURCE_DB)?.relations[RELATION]?.[0]).toMatchObject({ id: MISSING, status: 'missing' });
    });
  });
});
