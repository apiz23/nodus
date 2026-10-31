import { describe, expect, it } from 'vitest';
import { createNote, type Note } from '../src/domain/note.js';
import { parseDatabase, serializeDatabase, type DatabaseDefinition, type Property } from '../src/database/schema.js';
import { configurationIssues, projectRelations } from '../src/database/relations.js';
import { validateRelationValue, type RelationPropertyConfiguration } from '../src/database/relation-contract.js';
import { projectNoteProperties, setNotePropertyValue } from '../src/database/note-properties.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SOURCE_DB = id(1);
const TARGET_DB = id(2);
const RELATION = id(3);
const SOURCE_NOTE = id(4);
const TARGET_ONE = id(5);
const TARGET_TWO = id(6);
const MISSING_TARGET = id(7);
const NOW = '2026-10-31T00:00:00Z';

const manyConfig: RelationPropertyConfiguration = { databaseId: TARGET_DB, cardinality: 'many' };
const oneConfig: RelationPropertyConfiguration = { databaseId: TARGET_DB, cardinality: 'one' };
const sourceDatabase: DatabaseDefinition = {
  id: SOURCE_DB,
  name: 'Source',
  properties: [{ id: RELATION, name: 'Targets', type: 'relation', relation: manyConfig }],
};
const targetDatabase: DatabaseDefinition = { id: TARGET_DB, name: 'Target', properties: [] };

function note(noteId: string, title: string, path: string, databaseId: string, values: Record<string, unknown>): Note {
  return {
    ...createNote({ id: noteId, title, path, body: '', now: NOW }),
    extraFrontmatter: {
      nodus_data: {
        format: 'nodus-note-properties',
        version: 1,
        databases: { [databaseId]: values },
      },
    },
  };
}

describe('relation model contracts', () => {
  it('keeps legacy schemas readable and serializes relation configuration in database v2', () => {
    const legacy = serializeDatabase({ id: SOURCE_DB, name: 'Legacy', properties: [] });
    expect(JSON.parse(legacy).version).toBe(1);
    expect(parseDatabase(legacy)).toEqual({ id: SOURCE_DB, name: 'Legacy', properties: [] });

    const serialized = serializeDatabase(sourceDatabase);
    expect(JSON.parse(serialized).version).toBe(2);
    expect(parseDatabase(serialized)).toEqual(sourceDatabase);
    expect(() => parseDatabase(serialized.replace(TARGET_DB, 'not-a-database-id'))).toThrow();
  });

  it('accepts the cardinality-specific single and multiple target value shapes', () => {
    expect(validateRelationValue(oneConfig, TARGET_ONE)).toEqual({ ok: true, value: TARGET_ONE });
    expect(validateRelationValue(manyConfig, [TARGET_ONE, TARGET_TWO])).toEqual({ ok: true, value: [TARGET_ONE, TARGET_TWO] });
    expect(validateRelationValue(oneConfig, null)).toEqual({ ok: true, value: null });
    expect(validateRelationValue(manyConfig, [])).toEqual({ ok: true, value: [] });
    expect(validateRelationValue(manyConfig, null)).toEqual({ ok: true, value: null });
  });

  it('rejects duplicate, malformed, and cardinality-mismatched target values', () => {
    for (const value of [[TARGET_ONE, TARGET_ONE], ['title'], TARGET_ONE, 4]) {
      expect(validateRelationValue(manyConfig, value)).toMatchObject({ ok: false, code: 'INVALID_VALUE' });
    }
    for (const value of [[TARGET_ONE], [], 'title', TARGET_ONE + ' ']) {
      expect(validateRelationValue(oneConfig, value)).toMatchObject({ ok: false, code: 'INVALID_VALUE' });
    }
    const malformedSingle = note(SOURCE_NOTE, 'Source', 'source.md', SOURCE_DB, { [RELATION]: [] });
    const singleDatabase: DatabaseDefinition = {
      ...sourceDatabase,
      properties: [{ id: RELATION, name: 'Target', type: 'relation', relation: oneConfig }],
    };
    const projection = projectNoteProperties(malformedSingle, new Map([[SOURCE_DB, singleDatabase], [TARGET_DB, targetDatabase]]));
    expect(projection.rows[0]?.values[RELATION]).toBeUndefined();
    expect(projection.issues.map((issue) => issue.code)).toContain('INVALID_VALUE');
    expect((malformedSingle.extraFrontmatter.nodus_data as { databases: Record<string, Record<string, unknown>> }).databases[SOURCE_DB]?.[RELATION]).toEqual([]);
    expect(setNotePropertyValue(note(SOURCE_NOTE, 'Source', 'source.md', SOURCE_DB, {}), new Map([[SOURCE_DB, sourceDatabase], [TARGET_DB, targetDatabase]]), {
      databaseId: SOURCE_DB, propertyId: RELATION, value: [],
    }).ok).toBe(true);
  });

  it('distinguishes a missing target record from an invalid configured target database without dropping stored IDs', () => {
    const schemas = new Map([[SOURCE_DB, sourceDatabase]]);
    const source = note(SOURCE_NOTE, 'Source', 'source.md', SOURCE_DB, { [RELATION]: [MISSING_TARGET] });

    const missingDatabase = projectRelations([source], schemas);
    expect(missingDatabase.rows.get(SOURCE_NOTE)?.get(SOURCE_DB)?.values[RELATION]).toEqual([MISSING_TARGET]);
    expect(missingDatabase.diagnostics.map((issue) => issue.code)).toContain('INVALID_CONFIGURATION');
    expect(configurationIssues(schemas).issues.get(`${SOURCE_DB}:${RELATION}`)).toContain('target database is missing');

    const missingRecord = projectRelations([source], new Map([[SOURCE_DB, sourceDatabase], [TARGET_DB, targetDatabase]]));
    expect(missingRecord.rows.get(SOURCE_NOTE)?.get(SOURCE_DB)?.relations[RELATION]).toEqual([
      { id: MISSING_TARGET, status: 'missing' },
    ]);
    expect(missingRecord.diagnostics.map((issue) => issue.code)).toContain('MISSING_TARGET');
    expect(missingRecord.rows.get(SOURCE_NOTE)?.get(SOURCE_DB)?.values[RELATION]).toEqual([MISSING_TARGET]);
  });

  it('keeps a stored relation value when its property is removed from the schema', () => {
    const source = note(SOURCE_NOTE, 'Source', 'source.md', SOURCE_DB, { [RELATION]: [TARGET_ONE] });
    const withoutRelation = { ...sourceDatabase, properties: [] };
    const projection = projectNoteProperties(source, new Map([[SOURCE_DB, withoutRelation], [TARGET_DB, targetDatabase]]));

    expect(projection.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_PROPERTY', propertyId: RELATION }));
    expect((source.extraFrontmatter.nodus_data as { databases: Record<string, Record<string, unknown>> }).databases[SOURCE_DB]?.[RELATION]).toEqual([TARGET_ONE]);
  });

  it('keeps references stable across title and path changes', () => {
    const source = note(SOURCE_NOTE, 'Source', 'source.md', SOURCE_DB, { [RELATION]: [TARGET_ONE] });
    const renamedTarget = note(TARGET_ONE, 'Renamed target', 'moved/target.md', TARGET_DB, {});
    const graph = projectRelations([source, renamedTarget], new Map([[SOURCE_DB, sourceDatabase], [TARGET_DB, targetDatabase]]));
    const row = graph.rows.get(SOURCE_NOTE)?.get(SOURCE_DB);

    expect(row?.values[RELATION]).toEqual([TARGET_ONE]);
    expect(row?.relations[RELATION]).toEqual([{ id: TARGET_ONE, title: 'Renamed target', path: 'moved/target.md', status: 'resolved' }]);
  });

  it('allows self-references and circular relation edges without recursive traversal', () => {
    const sameDatabase: DatabaseDefinition = {
      id: SOURCE_DB,
      name: 'Self linked',
      properties: [{ id: RELATION, name: 'Related', type: 'relation', relation: { databaseId: SOURCE_DB, cardinality: 'many' } }],
    };
    const first = note(SOURCE_NOTE, 'First', 'first.md', SOURCE_DB, { [RELATION]: [SOURCE_NOTE, TARGET_ONE] });
    const second = note(TARGET_ONE, 'Second', 'second.md', SOURCE_DB, { [RELATION]: [SOURCE_NOTE] });
    const graph = projectRelations([first, second], new Map([[SOURCE_DB, sameDatabase]]));

    expect(graph.diagnostics).toEqual([]);
    expect(graph.rows.get(SOURCE_NOTE)?.get(SOURCE_DB)?.relations[RELATION]?.map(({ id: targetId, status }) => [targetId, status])).toEqual([
      [SOURCE_NOTE, 'resolved'], [TARGET_ONE, 'resolved'],
    ]);
    expect(graph.rows.get(TARGET_ONE)?.get(SOURCE_DB)?.values[RELATION]).toEqual([SOURCE_NOTE]);
  });
});
