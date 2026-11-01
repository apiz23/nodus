import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { createNote, type Note } from '../src/domain/note.js';
import { parseDatabase, serializeDatabase, type DatabaseDefinition, type Property } from '../src/database/schema.js';
import { projectRelations } from '../src/database/relations.js';
import { buildFormulaSchema, FORMULA_EDITOR_SUGGESTIONS, parseFormula, validateFormula } from '../src/database/formula-engine.js';
import { analyzeFormulaDraft, formulaCompletions } from '../ui/src/database/formula-editor-model.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createBackup, restoreBackup } from '../src/storage/backup/backup.js';
import { withTempDir } from './tmp.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PROJECTS = id(1), TASKS = id(2);
const REL = id(3), SINGLE = id(4), NUM = id(5), TEXT = id(6), DATE = id(7), DONE = id(8), TASK_FORMULA = id(19);
const COUNT = id(9), SUM = id(10), AVERAGE = id(11), MIN = id(12), MAX = id(13), DATEMIN = id(14), DATEMAX = id(15), WHERE_DONE = id(16), WHERE_TEXT = id(17), SINGLE_COUNT = id(18);
const P = id(100), T1 = id(101), T2 = id(102), MISSING = id(103);
const NOW = '2026-11-02T00:00:00Z';

const formula = (propertyId: string, name: string, expression: string): Property => ({ id: propertyId, name, type: 'formula', formula: { expression } });
const projects: DatabaseDefinition = { id: PROJECTS, name: 'Projects', properties: [
  { id: REL, name: 'Tasks', type: 'relation', relation: { databaseId: TASKS, cardinality: 'many' } },
  { id: SINGLE, name: 'Lead task', type: 'relation', relation: { databaseId: TASKS, cardinality: 'one' } },
  formula(COUNT, 'Related count', `relatedCount(@{${REL}})`),
  formula(SUM, 'Related sum', `relatedSum(@{${REL}}, @{${NUM}})`),
  formula(AVERAGE, 'Related average', `relatedAverage(@{${REL}}, @{${NUM}})`),
  formula(MIN, 'Related minimum', `relatedMin(@{${REL}}, @{${NUM}})`),
  formula(MAX, 'Related maximum', `relatedMax(@{${REL}}, @{${NUM}})`),
  formula(DATEMIN, 'Earliest due', `relatedMin(@{${REL}}, @{${DATE}})`),
  formula(DATEMAX, 'Latest due', `relatedMax(@{${REL}}, @{${DATE}})`),
  formula(WHERE_DONE, 'Completed related', `relatedCountWhere(@{${REL}}, @{${DONE}}, true)`),
  formula(WHERE_TEXT, 'Alpha related', `relatedCountWhere(@{${REL}}, @{${TEXT}}, "alpha")`),
  formula(SINGLE_COUNT, 'Lead count', `relatedCount(@{${SINGLE}})`),
] };
const tasks: DatabaseDefinition = { id: TASKS, name: 'Tasks', properties: [
  { id: NUM, name: 'Estimate', type: 'number' },
  { id: TEXT, name: 'Label', type: 'text' },
  { id: DATE, name: 'Due', type: 'date' },
  { id: DONE, name: 'Done', type: 'checkbox' },
  { id: TASK_FORMULA, name: 'Task double', type: 'formula', formula: { expression: `@{${NUM}} * 2` } },
] };
const schemas = new Map([[PROJECTS, projects], [TASKS, tasks]]);
const databases = [
  { id: PROJECTS, name: 'Projects', properties: projects.properties },
  { id: TASKS, name: 'Tasks', properties: tasks.properties },
];

function note(noteId: string, databaseId: string, values: Record<string, unknown>, title = `Record ${noteId.slice(-3)}`, path = `${noteId}.md`): Note {
  return { ...createNote({ id: noteId, title, path, body: '', now: NOW }), extraFrontmatter: { nodus_data: { format: 'nodus-note-properties', version: 1, databases: { [databaseId]: values } } } };
}
const fixture = () => [
  note(P, PROJECTS, { [REL]: [T1, T2, MISSING], [SINGLE]: T1 }),
  note(T1, TASKS, { [NUM]: 3, [TEXT]: 'alpha', [DATE]: '2026-01-02', [DONE]: true }),
  note(T2, TASKS, { [NUM]: 7, [TEXT]: 'beta', [DATE]: '2026-03-04', [DONE]: false }),
];

describe('relation-aware formulas', () => {
  it('evaluates count, sum, average, minimum, maximum, date extrema, and filtering', () => {
    const row = projectRelations(fixture(), schemas).rows.get(P)!.get(PROJECTS)!;
    expect(row.values).toMatchObject({
      [COUNT]: 2, [SUM]: 10, [AVERAGE]: 5, [MIN]: 3, [MAX]: 7,
      [DATEMIN]: '2026-01-02', [DATEMAX]: '2026-03-04', [WHERE_DONE]: 1, [WHERE_TEXT]: 1, [SINGLE_COUNT]: 1,
    });
    expect(row.issues.filter((issue) => issue.code === 'FORMULA_ERROR')).toEqual([]);
  });

  it('reads numeric rollup values from related records', () => {
    const SUBTASKS = id(300), CHILDREN = id(301), AMOUNT = id(302), TOTAL = id(303), ROLLUP_SUM = id(304), S1 = id(400), S2 = id(401);
    const childSchema: DatabaseDefinition = { id: SUBTASKS, name: 'Subtasks', properties: [{ id: AMOUNT, name: 'Amount', type: 'number' }] };
    const taskSchema: DatabaseDefinition = { ...tasks, properties: [...tasks.properties,
      { id: CHILDREN, name: 'Subtasks', type: 'relation', relation: { databaseId: SUBTASKS, cardinality: 'many' } },
      { id: TOTAL, name: 'Subtask total', type: 'rollup', rollup: { relationPropertyId: CHILDREN, operation: 'sum', targetPropertyId: AMOUNT } },
    ] };
    const projectSchema: DatabaseDefinition = { ...projects, properties: [...projects.properties, formula(ROLLUP_SUM, 'Related subtask total', `relatedSum(@{${REL}}, @{${TOTAL}})`)] };
    const records = [
      note(P, PROJECTS, { [REL]: [T1, T2] }),
      note(T1, TASKS, { [CHILDREN]: [S1] }),
      note(T2, TASKS, { [CHILDREN]: [S2] }),
      note(S1, SUBTASKS, { [AMOUNT]: 4 }),
      note(S2, SUBTASKS, { [AMOUNT]: 6 }),
    ];
    const row = projectRelations(records, new Map([[PROJECTS, projectSchema], [TASKS, taskSchema], [SUBTASKS, childSchema]])).rows.get(P)!.get(PROJECTS)!;
    expect(row.values[ROLLUP_SUM]).toBe(10);
  });

  it('handles empty, missing, deleted, and single relations deterministically', () => {
    const empty = projectRelations([note(P, PROJECTS, { [REL]: null, [SINGLE]: null })], schemas).rows.get(P)!.get(PROJECTS)!;
    expect(empty.values).toMatchObject({ [COUNT]: 0, [SUM]: 0, [AVERAGE]: null, [MIN]: null, [MAX]: null, [DATEMIN]: null, [DATEMAX]: null, [WHERE_DONE]: 0, [SINGLE_COUNT]: 0 });
    const deleted = fixture().slice(0, 2);
    expect(projectRelations(deleted, schemas).rows.get(P)!.get(PROJECTS)!.values).toMatchObject({ [COUNT]: 1, [SUM]: 3, [AVERAGE]: 3, [SINGLE_COUNT]: 1 });
    const single = projectRelations(fixture(), schemas).rows.get(P)!.get(PROJECTS)!;
    expect(single.values[SINGLE_COUNT]).toBe(1);
  });

  it('recomputes after related values change and follows renames and moves by stable ID', () => {
    const changed = fixture();
    changed[1] = note(T1, TASKS, { [NUM]: 9, [TEXT]: 'alpha', [DATE]: '2026-05-05', [DONE]: true }, 'Renamed task', 'moved/task.md');
    const row = projectRelations(changed, schemas).rows.get(P)!.get(PROJECTS)!;
    expect(row.values).toMatchObject({ [COUNT]: 2, [SUM]: 16, [AVERAGE]: 8, [MIN]: 7, [MAX]: 9, [DATEMIN]: '2026-03-04', [DATEMAX]: '2026-05-05' });
    expect(row.relations[REL]?.[0]).toMatchObject({ id: T1, title: 'Renamed task', path: 'moved/task.md' });
  });

  it('validates relation arguments, target types, arity, and unknown references', () => {
    const schema = buildFormulaSchema(databases, new Map(), PROJECTS);
    const validate = (source: string) => { const parsed = parseFormula(source); if (!parsed.ok) throw new Error(parsed.diagnostics[0]?.message); return validateFormula(parsed.value, schema); };
    expect(validate(`relatedSum(@{${REL}}, @{${NUM}})`)).toEqual({ ok: true, value: 'number' });
    expect(validate(`relatedMin(@{${REL}}, @{${DATE}})`)).toEqual({ ok: true, value: 'date' });
    for (const source of [
      `relatedCount(@{${NUM}})`,
      `relatedSum(@{${NUM}}, @{${NUM}})`,
      `relatedSum(@{${REL}})`,
      `relatedSum(@{${REL}}, @{${MISSING}})`,
      `relatedSum(@{${REL}}, @{${TEXT}})`,
      `relatedAverage(@{${REL}}, @{${DATE}})`,
      `relatedSum(@{${REL}}, @{${TASK_FORMULA}})`,
      `relatedCountWhere(@{${REL}}, @{${NUM}})` ,
      `relatedCountWhere(@{${REL}}, @{${NUM}}, "text")`,
      `relatedCountWhere(@{${REL}}, @{${NUM}}, null)`,
    ]) {
      expect(validate(source).ok, source).toBe(false);
    }
  });

  it('reports direct and indirect formula cycles without recursing', () => {
    const cycleA = formula(id(200), 'Cycle A', `relatedCount(@{${REL}}) + @{${id(201)}}`);
    const cycleB = formula(id(201), 'Cycle B', `@{${id(200)}} + 1`);
    const cyclic = { ...projects, properties: [...projects.properties, cycleA, cycleB] };
    const graph = projectRelations(fixture(), new Map([[PROJECTS, cyclic], [TASKS, tasks]]));
    const row = graph.rows.get(P)!.get(PROJECTS)!;
    expect(row.values[id(200)]).toBeNull();
    expect(row.values[id(201)]).toBeNull();
    expect(graph.diagnostics.some((issue) => issue.code === 'FORMULA_ERROR' && /circular/i.test(issue.message))).toBe(true);
  });

  it('exposes relation functions and related properties to the editor model', () => {
    expect(FORMULA_EDITOR_SUGGESTIONS).toContainEqual(expect.objectContaining({ name: 'relatedSum', category: 'Relations', signature: 'relatedSum(relation, targetNumber) → number' }));
    expect(formulaCompletions('related', 'related'.length, projects.properties)?.options.some((option) => option.label === 'relatedSum')).toBe(true);
    const analysis = analyzeFormulaDraft(`relatedAverage(@{${REL}}, @{${NUM}})`, projects.properties, COUNT, undefined, databases, PROJECTS);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.resultType).toBe('number');
    const invalid = analyzeFormulaDraft(`relatedSum(@{${REL}}, @{${TEXT}})`, projects.properties, COUNT, undefined, databases, PROJECTS);
    expect(invalid.diagnostics).toContainEqual(expect.objectContaining({ code: 'TYPE_MISMATCH' }));
    const completions = formulaCompletions('relatedSum(@{', 'relatedSum(@{'.length, projects.properties, [{ property: tasks.properties[0]!, databaseName: 'Tasks' }]);
    expect(completions?.options.some((option) => option.label === 'Tasks · Estimate')).toBe(true);
  });

  it('round-trips relation formulas through schema serialization and backup/restore', async () => {
    expect(parseDatabase(serializeDatabase(projects))).toEqual(projects);
    await withTempDir(async (root) => {
      const source = await FileSystemVault.open(join(root, 'source'));
      await source.createDatabase(projects);
      await source.createDatabase(tasks);
      for (const record of fixture()) await source.createNote(record);
      const backup = join(root, 'backup');
      await createBackup(source, backup);
      const restored = join(root, 'restored');
      await restoreBackup(backup, restored);
      const vault = await FileSystemVault.open(restored);
      const restoredSchemas = new Map([[PROJECTS, await vault.readDatabase(PROJECTS)], [TASKS, await vault.readDatabase(TASKS)]]);
      const row = projectRelations(await vault.snapshotNotes(), restoredSchemas).rows.get(P)!.get(PROJECTS)!;
      expect(row.values).toMatchObject({ [COUNT]: 2, [SUM]: 10, [AVERAGE]: 5, [DATEMIN]: '2026-01-02' });
    });
  });

  it('computes relation formulas over large related sets', () => {
    const targets = Array.from({ length: 1000 }, (_, index) => note(id(1000 + index), TASKS, { [NUM]: index + 1, [TEXT]: `item-${index}`, [DATE]: `2026-${String((index % 12) + 1).padStart(2, '0')}-01`, [DONE]: index % 2 === 0 }));
    const graph = projectRelations([note(P, PROJECTS, { [REL]: targets.map((target) => target.id) }), ...targets], schemas);
    const row = graph.rows.get(P)!.get(PROJECTS)!;
    expect(row.values).toMatchObject({ [COUNT]: 1000, [SUM]: 500500, [AVERAGE]: 500.5, [MIN]: 1, [MAX]: 1000, [WHERE_DONE]: 500, [DATEMIN]: '2026-01-01', [DATEMAX]: '2026-12-01' });
  });
});
