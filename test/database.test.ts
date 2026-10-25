import { describe, expect, it } from 'vitest';
import { parseDatabase, serializeDatabase } from '../src/database/schema.js';
import validDatabase from './fixtures/database-valid.json?raw';
import badOptionsDatabase from './fixtures/database-bad-options.json?raw';
import futureVersionDatabase from './fixtures/database-future-version.json?raw';
import { errorCode } from './helpers.js';

const DB_ID = '9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73';
const PROP_ID = '1f0c7d2a-0b1e-4c3d-9a8f-5e6d7c8b9a01';
const OPTION_ID = '5d40b16e-4f5c-4a7b-9e2d-9c0a1b2f3e45';

function database(properties: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: 'nodus-database', version: 1, id: DB_ID, name: 'Test', properties, ...extra });
}

function textProperty(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: PROP_ID, name: 'Title', type: 'text', ...overrides };
}

describe('parseDatabase', () => {
  it('parses the valid fixture, covering every supported property type', () => {
    const db = parseDatabase(validDatabase);
    expect(db.name).toBe('Reading list');
    expect(db.properties.map((property) => property.type)).toEqual([
      'text',
      'number',
      'checkbox',
      'date',
      'select',
      'multi-select',
    ]);
    expect(db.properties[4]?.options?.map((option) => option.name)).toEqual(['To read', 'Reading', 'Done']);
  });

  it('accepts a database with no properties', () => {
    expect(parseDatabase(database([])).properties).toEqual([]);
  });

  it('rejects invalid JSON', () => {
    expect(errorCode(() => parseDatabase('{ nope'))).toBe('INVALID_DATABASE');
  });

  it('rejects a non-object document', () => {
    expect(errorCode(() => parseDatabase('[]'))).toBe('INVALID_DATABASE');
  });

  it('rejects a wrong format value', () => {
    expect(errorCode(() => parseDatabase(database([]).replace('nodus-database', 'other')))).toBe('INVALID_DATABASE');
  });

  it('reports a future version as unsupported without parsing the rest', () => {
    expect(errorCode(() => parseDatabase(futureVersionDatabase))).toBe('UNSUPPORTED_VERSION');
  });

  it('rejects a missing or non-integer version', () => {
    expect(errorCode(() => parseDatabase(JSON.stringify({ format: 'nodus-database', id: DB_ID, name: 'x', properties: [] })))).toBe(
      'INVALID_FIELD',
    );
    expect(errorCode(() => parseDatabase(database([], { version: '1' })))).toBe('INVALID_FIELD');
    expect(errorCode(() => parseDatabase(database([], { version: 0 })))).toBe('INVALID_FIELD');
  });

  it('rejects unknown top-level keys, such as view configuration', () => {
    expect(errorCode(() => parseDatabase(database([], { views: [] })))).toBe('INVALID_DATABASE');
  });

  it('rejects a non-UUID database id', () => {
    expect(errorCode(() => parseDatabase(database([], { id: 'db' })))).toBe('INVALID_DATABASE');
  });

  it('rejects a blank database name', () => {
    expect(errorCode(() => parseDatabase(database([], { name: '  ' })))).toBe('INVALID_DATABASE');
  });

  it('rejects an unsupported property type such as relation', () => {
    expect(errorCode(() => parseDatabase(database([textProperty({ type: 'relation' })])))).toBe('INVALID_DATABASE');
  });

  it('rejects unknown keys on a property', () => {
    expect(errorCode(() => parseDatabase(database([textProperty({ formula: '1+1' })])))).toBe('INVALID_DATABASE');
  });

  it('rejects a property with a non-UUID id', () => {
    expect(errorCode(() => parseDatabase(database([textProperty({ id: 'p1' })])))).toBe('INVALID_DATABASE');
  });

  it('rejects duplicate property ids', () => {
    expect(errorCode(() => parseDatabase(database([textProperty(), textProperty({ name: 'Other' })])))).toBe(
      'INVALID_DATABASE',
    );
  });

  it('rejects duplicate property names', () => {
    const second = textProperty({ id: '2a1d8e3b-1c2f-4d4e-8b9a-6f7e8d9c0b12' });
    expect(errorCode(() => parseDatabase(database([textProperty(), second])))).toBe('INVALID_DATABASE');
  });

  it('rejects duplicate property names regardless of case', () => {
    const second = textProperty({ id: '2a1d8e3b-1c2f-4d4e-8b9a-6f7e8d9c0b12', name: 'title' });
    expect(errorCode(() => parseDatabase(database([textProperty(), second])))).toBe('INVALID_DATABASE');
  });

  it('rejects option names that are the same after NFC normalization', () => {
    const options = [
      { id: OPTION_ID, name: 'Café' },
      { id: '6e51c27f-5a6d-4b8c-8f3e-0d1b2c3a4f56', name: 'Cafe\u0301' },
    ];
    expect(errorCode(() => parseDatabase(database([textProperty({ type: 'select', options })])))).toBe(
      'INVALID_DATABASE',
    );
  });

  it('rejects a select property without options', () => {
    expect(errorCode(() => parseDatabase(database([textProperty({ type: 'select' })])))).toBe('INVALID_DATABASE');
  });

  it('rejects options on a text property', () => {
    const options = [{ id: OPTION_ID, name: 'A' }];
    expect(errorCode(() => parseDatabase(database([textProperty({ options })])))).toBe('INVALID_DATABASE');
  });

  it('rejects duplicate option names', () => {
    const options = [
      { id: OPTION_ID, name: 'Done' },
      { id: '6e51c27f-5a6d-4b8c-8f3e-0d1b2c3a4f56', name: 'Done' },
    ];
    expect(errorCode(() => parseDatabase(database([textProperty({ type: 'multi-select', options })])))).toBe(
      'INVALID_DATABASE',
    );
  });

  it('allows option names that differ only by case', () => {
    const options = [
      { id: OPTION_ID, name: 'Open' },
      { id: '6e51c27f-5a6d-4b8c-8f3e-0d1b2c3a4f56', name: 'open' },
    ];
    const db = parseDatabase(database([textProperty({ type: 'select', options })]));
    expect(db.properties[0]?.options?.map((option) => option.name)).toEqual(['Open', 'open']);
  });

  it('rejects duplicate option ids within one property', () => {
    const options = [
      { id: OPTION_ID, name: 'A' },
      { id: OPTION_ID, name: 'B' },
    ];
    expect(errorCode(() => parseDatabase(database([textProperty({ type: 'select', options })])))).toBe(
      'INVALID_DATABASE',
    );
  });

  it('rejects an option with a blank name', () => {
    const options = [{ id: OPTION_ID, name: '' }];
    expect(errorCode(() => parseDatabase(database([textProperty({ type: 'select', options })])))).toBe(
      'INVALID_DATABASE',
    );
  });

  it('rejects the bad-options fixture', () => {
    expect(errorCode(() => parseDatabase(badOptionsDatabase))).toBe('INVALID_DATABASE');
  });
});

describe('serializeDatabase', () => {
  it('writes the valid fixture back byte-for-byte', () => {
    expect(serializeDatabase(parseDatabase(validDatabase))).toBe(validDatabase);
  });

  it('round-trips a definition with equal fields', () => {
    const db = parseDatabase(validDatabase);
    expect(parseDatabase(serializeDatabase(db))).toEqual(db);
  });

  it('rejects an invalid definition instead of writing it', () => {
    const invalid = {
      id: DB_ID,
      name: 'Bad',
      properties: [{ id: PROP_ID, name: 'Title', type: 'text', options: [] }],
    } as unknown as Parameters<typeof serializeDatabase>[0];
    expect(errorCode(() => serializeDatabase(invalid))).toBe('INVALID_DATABASE');
  });
});
