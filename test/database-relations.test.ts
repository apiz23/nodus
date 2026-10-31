import { describe, expect, it } from 'vitest';
import { createNote, type Note } from '../src/domain/note.js';
import { parseDatabase, serializeDatabase, type DatabaseDefinition, type Property } from '../src/database/schema.js';
import { projectRelations } from '../src/database/relations.js';
import { projectIncomingRelations } from '../src/database/relations.js';
import { setNotePropertyValue } from '../src/database/note-properties.js';
import { diagnoseDatabaseView, serializeDatabaseView, parseDatabaseView } from '../src/database/database-view.js';
import { selectDatabaseRows } from '../ui/src/database-table.js';
import { kanbanColumns, calendarRows } from '../ui/src/database-view-layout.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createBackup, restoreBackup, validateBackup } from '../src/storage/backup/backup.js';
import { exportVault } from '../src/storage/portable/export.js';
import { planImport } from '../src/storage/portable/import.js';
import { withTempDir } from './tmp.js';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DB = id(1), TASKS = id(2), REL = id(3), REV = id(4), NUM = id(5), DONE = id(6);
const COUNT = id(7), SUM = id(8), CONDITIONAL = id(9), COMPLETE = id(10), PERCENT = id(11), SINGLE = id(12);
const P = id(100), T1 = id(101), T2 = id(102), MISSING = id(103);
const NOW = '2026-10-29T00:00:00Z';
const relation: Property = { id: REL, name: 'Tasks', type: 'relation', relation: { databaseId: TASKS, cardinality: 'many' } };
const rollup = (propertyId: string, operation: NonNullable<Property['rollup']>['operation'], extra = {}): Property => ({ id: propertyId, name: operation, type: 'rollup', rollup: { relationPropertyId: REL, operation, ...extra } });
const projects: DatabaseDefinition = { id: DB, name: 'Projects', properties: [relation,
  { id: SINGLE, name: 'Lead task', type: 'relation', relation: { databaseId: TASKS, cardinality: 'one' } },
  rollup(COUNT, 'count'), rollup(SUM, 'sum', { targetPropertyId: NUM }), rollup(CONDITIONAL, 'conditional-count', { condition: { propertyId: DONE, value: true } }),
  rollup(COMPLETE, 'completed-task-count', { targetPropertyId: DONE }), rollup(PERCENT, 'completion-percentage', { targetPropertyId: DONE }),
] };
const tasks: DatabaseDefinition = { id: TASKS, name: 'Tasks', properties: [
  { id: NUM, name: 'Estimate', type: 'number' }, { id: DONE, name: 'Done', type: 'checkbox' },
  { id: REV, name: 'Projects', type: 'relation', relation: { databaseId: DB, cardinality: 'many', reversePropertyId: REL } },
] };
const schemas = new Map([[DB, projects], [TASKS, tasks]]);
function note(noteId: string, databaseId: string, values: Record<string, unknown>): Note {
  return { ...createNote({ id: noteId, title: `Record ${noteId.slice(-3)}`, path: `${noteId}.md`, body: 'Portable [[wiki link]]\n', now: NOW }),
    extraFrontmatter: { custom: { preserve: true }, nodus_data: { format: 'nodus-note-properties', version: 1, databases: { [databaseId]: values } } } };
}
const fixture = () => [note(P, DB, { [REL]: [T1, T2], [SINGLE]: T1 }), note(T1, TASKS, { [NUM]: 3, [DONE]: true }), note(T2, TASKS, { [NUM]: 7, [DONE]: false })];

describe('portable database relations and rollups', () => {
  it('keeps legacy schemas at v1 and round-trips advanced schemas as v2', () => {
    expect(JSON.parse(serializeDatabase({ id: DB, name: 'Legacy', properties: [] })).version).toBe(1);
    expect(JSON.parse(serializeDatabase(projects)).version).toBe(2);
    expect(parseDatabase(serializeDatabase(projects))).toEqual(projects);
    expect(parseDatabase(serializeDatabase(tasks))).toEqual(tasks);
    expect(() => parseDatabase(serializeDatabase(projects).replace('"version": 2', '"version": 1'))).toThrow();
    expect(() => parseDatabase(serializeDatabase(projects).replace('"version": 2', '"version": 4'))).toThrow(/newer/);
  });

  it.each([
    { ...relation, relation: { databaseId: TASKS, cardinality: 'unknown' } },
    { ...relation, relation: { databaseId: 'title', cardinality: 'many' } },
    { ...relation, relation: { databaseId: TASKS, cardinality: 'one', reversePropertyId: REL } },
    { ...relation, relation: { ...relation.relation, unknown: true } },
    rollup(SUM, 'sum'), rollup(CONDITIONAL, 'conditional-count'),
    rollup(COUNT, 'count', { targetPropertyId: NUM }),
  ])('rejects malformed advanced configuration %#', (property) => {
    expect(() => serializeDatabase({ ...projects, properties: [property as Property] })).toThrow();
  });

  it('projects both cardinalities, reverse edges, all rollups, and preserves every source byte/value', () => {
    const notes = fixture(); const before = JSON.stringify(notes);
    const graph = projectRelations(notes, schemas);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.rows.get(P)?.get(DB)?.values).toMatchObject({ [REL]: [T1, T2], [SINGLE]: T1, [COUNT]: 2, [SUM]: 10, [CONDITIONAL]: 1, [COMPLETE]: 1, [PERCENT]: 50 });
    expect(graph.rows.get(T1)?.get(TASKS)?.values[REV]).toEqual([P]);
    expect(graph.rows.get(P)?.get(DB)?.relations[REL]?.[0]).toMatchObject({ id: T1, status: 'resolved' });
    expect(JSON.stringify(notes)).toBe(before);
  });

  it('follows IDs through renames/moves and preserves missing/incompatible references after deletion', () => {
    const notes = fixture(); notes[1] = { ...notes[1]!, title: '<script>Renamed</script>', path: 'moved/task.md' };
    let graph = projectRelations(notes, schemas);
    expect(graph.rows.get(P)?.get(DB)?.relations[REL]?.[0]).toMatchObject({ id: T1, title: '<script>Renamed</script>', path: 'moved/task.md' });
    notes.pop(); notes.push(note(MISSING, DB, {}));
    notes[0] = note(P, DB, { [REL]: [T1, T2, MISSING] });
    graph = projectRelations(notes, schemas);
    expect(graph.rows.get(P)?.get(DB)?.values).toMatchObject({ [REL]: [T1, T2, MISSING], [COUNT]: 1, [SUM]: 3, [PERCENT]: 100 });
    expect(graph.diagnostics.map((issue) => issue.code)).toEqual(expect.arrayContaining(['MISSING_TARGET', 'INCOMPATIBLE_TARGET']));
  });

  it('defines null/empty/missing values and never uses malformed source values for counts', () => {
    const empty = projectRelations([note(P, DB, { [REL]: null })], schemas).rows.get(P)!.get(DB)!;
    expect(empty.values).toMatchObject({ [COUNT]: 0, [SUM]: 0, [COMPLETE]: 0, [CONDITIONAL]: 0, [PERCENT]: null });
    const missingCheckbox = projectRelations([note(P, DB, { [REL]: [T1] }), note(T1, TASKS, {})], schemas).rows.get(P)!.get(DB)!;
    expect(missingCheckbox.values).toMatchObject({ [SUM]: 0, [COMPLETE]: 0, [PERCENT]: 0 });
    const invalid = projectRelations([note(P, DB, { [REL]: ['title instead of ID'] })], schemas).rows.get(P)!.get(DB)!;
    expect(invalid.values[COUNT]).toBeUndefined();
    expect(invalid.issues.some((issue) => issue.code === 'INVALID_VALUE')).toBe(true);
  });

  it('rejects duplicate IDs/cardinality violations and keeps invalid relations repairable', () => {
    for (const [propertyId, value] of [[REL, [T1, T1]], [SINGLE, [T1]], [REL, T1]]) {
      expect(setNotePropertyValue(note(P, DB, {}), schemas, { databaseId: DB, propertyId: propertyId as string, value }).ok).toBe(false);
    }
    expect(setNotePropertyValue(note(P, DB, { [REL]: ['broken'] }), schemas, { databaseId: DB, propertyId: REL, value: [] }).ok).toBe(true);
    expect(setNotePropertyValue(fixture()[0]!, schemas, { databaseId: DB, propertyId: COUNT, value: 999 }).ok).toBe(false);
    expect(setNotePropertyValue(fixture()[1]!, schemas, { databaseId: TASKS, propertyId: REV, value: [P] }).ok).toBe(false);
  });

  it('diagnoses missing configuration, invalid reverse references and cycles even with no records', () => {
    const self: DatabaseDefinition = { id: DB, name: 'Circular', properties: [
      { ...relation, relation: { databaseId: DB, cardinality: 'many' } }, rollup(SUM, 'sum', { targetPropertyId: SUM }),
    ] };
    const map = new Map([[DB, self]]);
    expect(projectRelations([], map).diagnostics[0]?.code).toBe('CIRCULAR_ROLLUP');
    const graph = projectRelations([note(P, DB, { [REL]: [P] })], map);
    expect(graph.rows.get(P)?.get(DB)?.values[SUM]).toBeUndefined();
    const invalid = new Map([[DB, { ...projects, properties: [rollup(SUM, 'sum', { targetPropertyId: NUM })] }], [TASKS, tasks]]);
    expect(projectRelations([], invalid).diagnostics.some((issue) => issue.code === 'INVALID_CONFIGURATION')).toBe(true);
  });

  it('propagates unavailable rollup dependencies and rejects overflow without blocking relation repair', () => {
    const overflowing = fixture(); overflowing[1] = note(T1, TASKS, { [NUM]: Number.MAX_VALUE }); overflowing[2] = note(T2, TASKS, { [NUM]: Number.MAX_VALUE });
    const graph = projectRelations(overflowing, schemas);
    expect(graph.rows.get(P)?.get(DB)?.values[SUM]).toBeUndefined();
    expect(graph.diagnostics.some((issue) => issue.code === 'ROLLUP_ERROR')).toBe(true);
    const invalidCondition = { ...projects, properties: [relation, rollup(CONDITIONAL, 'conditional-count', { condition: { propertyId: NUM, value: 'not numeric' } })] };
    expect(projectRelations([], new Map([[DB, invalidCondition], [TASKS, tasks]])).diagnostics.some((issue) => issue.code === 'INVALID_CONFIGURATION')).toBe(true);
    const chain: DatabaseDefinition = { ...tasks, properties: [...tasks.properties, { id: id(81), name: 'Broken rollup', type: 'rollup', rollup: { relationPropertyId: id(82), operation: 'count' } }] };
    const source: DatabaseDefinition = { ...projects, properties: [relation, rollup(SUM, 'sum', { targetPropertyId: id(81) })] };
    expect(projectRelations(fixture(), new Map([[DB, source], [TASKS, chain]])).rows.get(P)?.get(DB)?.values[SUM]).toBeUndefined();
  });

  it('distinguishes malformed target values from missing values and excludes malformed membership', () => {
    const records = [note(P, DB, { [REL]: [T1] }), note(T1, TASKS, { [NUM]: 'not numeric', [DONE]: 'not boolean' })];
    const row = projectRelations(records, schemas).rows.get(P)!.get(DB)!;
    expect(row.values[COUNT]).toBe(1);
    expect(row.values[SUM]).toBeUndefined(); expect(row.values[PERCENT]).toBeUndefined();
    expect(row.issues.some((issue) => issue.code === 'ROLLUP_ERROR')).toBe(true);
    records[1]!.extraFrontmatter.nodus_data = { format: 'nodus-note-properties', version: 1, databases: { [TASKS]: 'not a mapping' } };
    const invalid = projectRelations(records, schemas).rows.get(P)!.get(DB)!;
    expect(invalid.values[COUNT]).toBe(0);
    expect(invalid.relations[REL]?.[0]?.status).toBe('incompatible');
  });

  it('sums valid nested rollups and handles multi-select conditional counts', () => {
    const third = id(90), outgoing = id(91), subTotal = id(92), amount = id(93), tags = id(94), option = id(95);
    const child: DatabaseDefinition = { id: third, name: 'Child', properties: [{ id: amount, name: 'Amount', type: 'number' }] };
    const middle: DatabaseDefinition = { ...tasks, properties: [...tasks.properties,
      { id: outgoing, name: 'Children', type: 'relation', relation: { databaseId: third, cardinality: 'many' } },
      { id: subTotal, name: 'Child total', type: 'rollup', rollup: { relationPropertyId: outgoing, operation: 'sum', targetPropertyId: amount } },
      { id: tags, name: 'Tags', type: 'multi-select', options: [{ id: option, name: 'Selected' }] },
    ] };
    const source: DatabaseDefinition = { ...projects, properties: [relation, rollup(SUM, 'sum', { targetPropertyId: subTotal }), rollup(CONDITIONAL, 'conditional-count', { condition: { propertyId: tags, value: option } })] };
    const graph = projectRelations([note(P, DB, { [REL]: [T1] }), note(T1, TASKS, { [outgoing]: [T2], [tags]: [option] }), note(T2, third, { [amount]: 12 })], new Map([[DB, source], [TASKS, middle], [third, child]]));
    expect(graph.rows.get(P)?.get(DB)?.values).toMatchObject({ [SUM]: 12, [CONDITIONAL]: 1 });
  });

  it('supports numeric rollup and relation filters/sorts in portable Table, Kanban and Calendar views', () => {
    const graph = projectRelations(fixture(), schemas);
    const row = { ...graph.rows.get(P)!.get(DB)!, title: 'Project', updatedAt: NOW, contentHash: 'hash' };
    expect(selectDatabaseRows([row], projects.properties, [{ id: id(50), propertyId: SUM, operator: 'greater', value: 9 }], SUM, 'desc')).toHaveLength(1);
    expect(selectDatabaseRows([row], projects.properties, [{ id: id(50), propertyId: REL, operator: 'includes', value: T1 }], REL, 'asc')).toHaveLength(1);
    expect(selectDatabaseRows([row], projects.properties, [{ id: id(50), propertyId: SINGLE, operator: 'is', value: T2 }], SINGLE, 'asc')).toHaveLength(0);
    for (const type of ['table', 'kanban', 'calendar'] as const) {
      const group: Property = { id: id(70), name: 'Status', type: 'select', options: [{ id: id(71), name: 'Open' }] };
      const date: Property = { id: id(72), name: 'Date', type: 'date' };
      const view = { id: id(60), databaseId: DB, name: type, type, sort: { propertyId: SUM, direction: 'desc' as const }, filters: [{ id: id(61), propertyId: REL, operator: 'includes' as const, value: T1 }], visiblePropertyIds: [REL, SUM], settings: type === 'table' ? {} : type === 'kanban' ? { groupPropertyId: group.id } : { datePropertyId: date.id } };
      expect(diagnoseDatabaseView(parseDatabaseView(serializeDatabaseView(view)), { ...projects, properties: [...projects.properties, group, date] })).toEqual([]);
      expect(kanbanColumns([row], group).at(-1)?.rows[0]?.values[SUM]).toBe(10);
      expect(calendarRows([row], date.id).undated[0]?.values[COUNT]).toBe(2);
    }
  });

  it('validates target membership under the write lock, refuses stale writes and supports clearing deleted targets', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createDatabase(projects); await vault.createDatabase(tasks);
      for (const record of fixture()) await vault.createNote(record);
      let current = await vault.readNoteWithHash(P);
      const input = { databaseId: DB, propertyId: REL, value: [MISSING] };
      expect((await vault.setNoteProperty(P, input, { expectedHash: current.hash, now: NOW })).ok).toBe(false);
      expect((await vault.readNoteWithHash(P)).hash).toBe(current.hash);
      await vault.deleteNote(T2);
      const saved = await vault.setNoteProperty(P, { ...input, value: [T1] }, { expectedHash: current.hash, now: NOW });
      expect(saved.ok).toBe(true);
      await expect(vault.setNoteProperty(P, { ...input, value: [] }, { expectedHash: current.hash, now: NOW })).rejects.toMatchObject({ code: 'STALE_WRITE' });
      current = await vault.readNoteWithHash(P);
      expect((await vault.setNoteProperty(P, { databaseId: DB, propertyId: REL, remove: true }, { expectedHash: current.hash, now: NOW })).ok).toBe(true);
    });
  });

  it('establishes derived-only membership without persisting a reverse or rollup value', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createDatabase({ ...projects, properties: [relation] });
      await vault.createDatabase({ ...tasks, properties: [tasks.properties[2]!] });
      const target = createNote({ id: T1, title: 'Target', path: 'target.md', body: '', now: NOW });
      await vault.createNote(target);
      const current = await vault.readNoteWithHash(T1);
      const input = { databaseId: TASKS, membershipOnly: true as const, confirmCreate: false };
      expect(await vault.setNoteProperty(T1, input, { expectedHash: current.hash, now: NOW })).toEqual({ ok: false, confirmationRequired: true });
      expect((await vault.setNoteProperty(T1, { ...input, confirmCreate: true }, { expectedHash: current.hash, now: NOW })).ok).toBe(true);
      await vault.createNote(note(P, DB, { [REL]: [T1] }));
      const graph = projectRelations(await vault.snapshotNotes(), new Map([[DB, { ...projects, properties: [relation] }], [TASKS, { ...tasks, properties: [tasks.properties[2]!] }]]));
      expect(graph.rows.get(T1)?.get(TASKS)?.values[REV]).toEqual([P]);
      expect(await readFile(join(root, target.path), 'utf8')).not.toContain(REV);
    });
  });

  it('round-trips forward references and schema configuration through backup/restore and portable import/export', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(join(root, 'source'));
      await vault.createDatabase(projects); await vault.createDatabase(tasks);
      for (const record of fixture()) await vault.createNote(record);
      const backup = join(root, 'backup'); await createBackup(vault, backup);
      expect((await validateBackup(backup)).manifest.formats?.database).toBe(2);
      const restoredRoot = join(root, 'restored'); await restoreBackup(backup, restoredRoot);
      const restored = await FileSystemVault.open(restoredRoot);
      const exportRoot = join(root, 'export'); await exportVault(restored, exportRoot);
      const imported = await FileSystemVault.open(join(root, 'imported')); await imported.applyImport(await planImport(exportRoot));
      const definitions = new Map((await imported.listDatabases()).map((db) => [db.id, db.id]));
      const actualSchemas = new Map(await Promise.all([...definitions.keys()].map(async (id) => [id, await imported.readDatabase(id)] as const)));
      const importedNotes = await imported.snapshotNotes();
      const graph = projectRelations(importedNotes, actualSchemas);
      const incoming = projectIncomingRelations(importedNotes, actualSchemas);
      expect(graph.rows.get(P)?.get(DB)?.values[SUM]).toBe(10);
      expect(graph.rows.get(T1)?.get(TASKS)?.values[REV]).toEqual([P]);
      expect(incoming.get(T1)).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: P, sourceDatabaseId: DB, propertyId: REL, status: 'resolved' })]));
      expect(await readFile(join(imported.root, `${P}.md`), 'utf8')).not.toContain(COUNT);
      const manifestPath = join(backup, 'nodus-backup.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')); manifest.formats.database = 4;
      await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(validateBackup(backup)).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
    });
  });
});
