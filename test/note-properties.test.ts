import { describe, expect, it } from 'vitest';
import { createNote, type Note } from '../src/domain/note.js';
import { parseNote, serializeNote } from '../src/format/note-format.js';
import {
  NOTE_PROPERTIES_FORMAT,
  projectNoteProperties,
  setNotePropertyValue,
  type StructuredDataIssueCode,
} from '../src/database/note-properties.js';
import type { DatabaseDefinition } from '../src/database/schema.js';

const NOTE_ID = '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';
const DB_ID = '9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73';
const MISSING_DB_ID = 'a0d3c1f2-8e4b-4f6a-9c2d-7b1e5f3a9d88';
const TEXT_ID = '1f0c7d2a-0b1e-4c3d-9a8f-5e6d7c8b9a01';
const NUMBER_ID = '4c3fa05d-3e4b-4f6a-8d1c-8b9a0f1e2d34';
const CHECKBOX_ID = '5d40b16e-4f5c-4a7b-9e2d-9c0a1b2f3e45';
const DATE_ID = '7a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d';
const SELECT_ID = '8b9a0f1e-2d34-4c3f-a05d-3e4b4f6a8d1c';
const MULTI_ID = '0c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const OPTION_A = '11111111-1111-4111-8111-111111111111';
const OPTION_B = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-10-25T09:00:00Z';

const schema: DatabaseDefinition = {
  id: DB_ID,
  name: 'Reading list',
  properties: [
    { id: TEXT_ID, name: 'Title', type: 'text' },
    { id: NUMBER_ID, name: 'Rating', type: 'number' },
    { id: CHECKBOX_ID, name: 'Read', type: 'checkbox' },
    { id: DATE_ID, name: 'Due date', type: 'date' },
    {
      id: SELECT_ID,
      name: 'Status',
      type: 'select',
      options: [
        { id: OPTION_A, name: 'To read' },
        { id: OPTION_B, name: 'Reading' },
      ],
    },
    {
      id: MULTI_ID,
      name: 'Topics',
      type: 'multi-select',
      options: [
        { id: OPTION_A, name: 'Work' },
        { id: OPTION_B, name: 'Research' },
      ],
    },
  ],
};

const schemas = new Map([[schema.id, schema]]);

function note(extraFrontmatter: Record<string, unknown> = {}): Note {
  return {
    ...createNote({
      id: NOTE_ID,
      title: 'Research note',
      path: 'notes/research.md',
      body: 'Body stays exactly as written.\r\n',
      now: NOW,
    }),
    extraFrontmatter,
  };
}

function namespace(databases: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    format: NOTE_PROPERTIES_FORMAT,
    version: 1,
    databases,
    ...extra,
  };
}

function expectIssue(
  issues: readonly { code: StructuredDataIssueCode; noteId: string; path: string }[],
  code: StructuredDataIssueCode,
) {
  expect(issues).toContainEqual(expect.objectContaining({ code, noteId: NOTE_ID, path: 'notes/research.md' }));
}

describe('projectNoteProperties', () => {
  it('projects every supported value type and round-trips the namespace through note frontmatter', () => {
    const values = {
      [TEXT_ID]: 'Café 日本語 🙂',
      [NUMBER_ID]: 4.5,
      [CHECKBOX_ID]: true,
      [DATE_ID]: '2026-10-28',
      [SELECT_ID]: OPTION_A,
      [MULTI_ID]: [OPTION_A, OPTION_B],
    };
    const original = note({ nodus_data: namespace({ [DB_ID]: values }), external: { retained: true } });
    const parsed = parseNote(serializeNote(original), original.path);

    expect(parsed.body).toBe(original.body);
    expect(parsed.id).toBe(original.id);
    expect(parsed.extraFrontmatter).toEqual(original.extraFrontmatter);
    expect(projectNoteProperties(parsed, schemas)).toEqual({
      rows: [{ noteId: NOTE_ID, path: original.path, databaseId: DB_ID, values }],
      issues: [],
    });
  });

  it('leaves legacy notes without nodus_data unchanged and preserves unrelated frontmatter', () => {
    const original = note({ project: 'Research', owner: { name: 'Nodus' } });
    const loaded = parseNote(serializeNote(original), original.path);

    expect(projectNoteProperties(loaded, schemas)).toEqual({ rows: [], issues: [] });
    expect(parseNote(serializeNote(loaded), loaded.path).extraFrontmatter).toEqual(original.extraFrontmatter);
  });

  it('does not add metadata when projecting a plain Markdown note', () => {
    const body = '# Daily note\n\nPlain body 🙂\n';
    const plain = parseNote(body, 'daily/today.md');

    expect(plain.sourceFormat).toBe('plain-markdown');
    expect(projectNoteProperties(plain, schemas)).toEqual({ rows: [], issues: [] });
    expect(serializeNote(plain)).toBe(body);
  });

  it.each([
    ['text', { [TEXT_ID]: 5 }, 'TYPE_MISMATCH'],
    ['number', { [NUMBER_ID]: '5' }, 'TYPE_MISMATCH'],
    ['checkbox', { [CHECKBOX_ID]: 1 }, 'TYPE_MISMATCH'],
    ['date type', { [DATE_ID]: 20261028 }, 'TYPE_MISMATCH'],
    ['invalid date', { [DATE_ID]: '2026-02-30' }, 'INVALID_VALUE'],
    ['infinite number', { [NUMBER_ID]: Number.POSITIVE_INFINITY }, 'INVALID_VALUE'],
    ['malformed option ID', { [SELECT_ID]: 'not-an-id' }, 'INVALID_VALUE'],
    ['multi-select shape', { [MULTI_ID]: OPTION_A }, 'TYPE_MISMATCH'],
    ['duplicate multi-select options', { [MULTI_ID]: [OPTION_A, OPTION_A] }, 'INVALID_VALUE'],
  ] as const)('diagnoses invalid %s values without mutating their source', (_label, values, code) => {
    const extension = namespace({ [DB_ID]: values });
    const original = note({ nodus_data: extension });
    const before = JSON.stringify(original.extraFrontmatter);

    const projection = projectNoteProperties(original, schemas);

    expectIssue(projection.issues, code);
    expect(JSON.stringify(original.extraFrontmatter)).toBe(before);
    expect(projection.rows[0]?.values).toEqual({});
  });

  it('preserves serializable invalid values through frontmatter normalization', () => {
    const extension = namespace({
      [DB_ID]: {
        [TEXT_ID]: 5,
        [DATE_ID]: '2026-02-30',
        [SELECT_ID]: '55555555-5555-4555-8555-555555555555',
      },
    });
    const original = note({ nodus_data: extension });
    const normalized = parseNote(serializeNote(original), original.path);

    expect(normalized.extraFrontmatter.nodus_data).toEqual(extension);
    expect(projectNoteProperties(normalized, schemas).issues.map((entry) => entry.code)).toEqual([
      'TYPE_MISMATCH',
      'INVALID_VALUE',
      'MISSING_OPTION',
    ]);
  });

  it('reports missing databases and properties without discarding their values', () => {
    const missingPropertyId = '33333333-3333-4333-8333-333333333333';
    const original = note({
      nodus_data: namespace({
        [MISSING_DB_ID]: { [TEXT_ID]: 'unavailable schema value' },
        [DB_ID]: { [missingPropertyId]: { retained: ['future', 2] }, [TEXT_ID]: 'Present' },
      }),
    });
    const before = JSON.stringify(original.extraFrontmatter);

    const projection = projectNoteProperties(original, schemas);

    expectIssue(projection.issues, 'MISSING_DATABASE');
    expect(projection.issues).toContainEqual(
      expect.objectContaining({ code: 'MISSING_PROPERTY', databaseId: DB_ID, propertyId: missingPropertyId }),
    );
    expect(projection.rows[0]?.values).toEqual({ [TEXT_ID]: 'Present' });
    expect(JSON.stringify(original.extraFrontmatter)).toBe(before);
    expect(parseNote(serializeNote(original), original.path).extraFrontmatter).toEqual(original.extraFrontmatter);
  });

  it('reports removed select options and keeps the stored option ID', () => {
    const removedOptionId = '44444444-4444-4444-8444-444444444444';
    const original = note({ nodus_data: namespace({ [DB_ID]: { [SELECT_ID]: removedOptionId } }) });
    const before = JSON.stringify(original.extraFrontmatter);

    const projection = projectNoteProperties(original, schemas);

    expectIssue(projection.issues, 'MISSING_OPTION');
    expect(projection.rows[0]?.values).toEqual({});
    expect(JSON.stringify(original.extraFrontmatter)).toBe(before);
    expect(parseNote(serializeNote(original), original.path).extraFrontmatter).toEqual(original.extraFrontmatter);
  });

  it('treats unsupported namespace versions as opaque and preserves unknown fields', () => {
    const future = {
      format: NOTE_PROPERTIES_FORMAT,
      version: 2,
      databases: { [DB_ID]: { [TEXT_ID]: { future: ['value', 3] } } },
      futureEnvelopeField: { retained: true },
    };
    const original = note({ nodus_data: future });
    const parsed = parseNote(serializeNote(original), original.path);

    const projection = projectNoteProperties(parsed, schemas);

    expectIssue(projection.issues, 'UNSUPPORTED_NAMESPACE_VERSION');
    expect(projection.rows).toEqual([]);
    expect(parsed.extraFrontmatter.nodus_data).toEqual(future);
    expect(JSON.stringify(projectNoteProperties(parsed, schemas))).not.toContain('futureEnvelopeField');
  });

  it.each([
    ['wrong format', { format: 'other', version: 1, databases: {} }],
    ['invalid version', { format: NOTE_PROPERTIES_FORMAT, version: 0, databases: {} }],
    ['unknown v1 field', { format: NOTE_PROPERTIES_FORMAT, version: 1, databases: {}, views: [] }],
    ['invalid database map', { format: NOTE_PROPERTIES_FORMAT, version: 1, databases: [] }],
  ])('reports %s while leaving the namespace available for preservation', (_label, extension) => {
    const original = note({ nodus_data: extension as Record<string, unknown> });
    const before = JSON.stringify(original.extraFrontmatter);

    expectIssue(projectNoteProperties(original, schemas).issues, 'INVALID_NAMESPACE');
    expect(JSON.stringify(original.extraFrontmatter)).toBe(before);
    expect(parseNote(serializeNote(original), original.path).extraFrontmatter.nodus_data).toEqual(extension);
  });
});

describe('setNotePropertyValue', () => {
  it('explicitly clears one value while retaining membership and unrelated metadata', () => {
    const original = note({ custom: { retained: true }, nodus_data: namespace({ [DB_ID]: { [TEXT_ID]: 'Keep', [SELECT_ID]: OPTION_A } }) });
    const before = structuredClone(original);
    const cleared = setNotePropertyValue(original, schemas, { databaseId: DB_ID, propertyId: SELECT_ID, remove: true });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(projectNoteProperties({ ...original, extraFrontmatter: cleared.extraFrontmatter }, schemas).rows).toMatchObject([{ databaseId: DB_ID, values: { [TEXT_ID]: 'Keep' } }]);
    expect(cleared.extraFrontmatter).toMatchObject({ custom: { retained: true } });
    const emptied = setNotePropertyValue({ ...original, extraFrontmatter: cleared.extraFrontmatter }, schemas, { databaseId: DB_ID, propertyId: TEXT_ID, remove: true });
    expect(emptied.ok).toBe(true);
    if (emptied.ok) expect(projectNoteProperties({ ...original, extraFrontmatter: emptied.extraFrontmatter }, schemas).rows).toMatchObject([{ databaseId: DB_ID, values: {} }]);
    expect(setNotePropertyValue(note(), schemas, { databaseId: DB_ID, propertyId: SELECT_ID, remove: true, confirmCreate: true })).toMatchObject({ ok: false });
    const future = note({ nodus_data: { ...namespace({ [DB_ID]: { [SELECT_ID]: OPTION_A } }), version: 99 } });
    expect(setNotePropertyValue(future, schemas, { databaseId: DB_ID, propertyId: SELECT_ID, remove: true })).toMatchObject({ ok: false, issues: [{ code: 'UNSUPPORTED_NAMESPACE_VERSION' }] });
    expect(original).toEqual(before);
  });
  it('changes only the requested value and preserves unrelated frontmatter and namespace fields', () => {
    const original = note({
      project: { owner: 'Nodus' },
      nodus_data: namespace({
        [DB_ID]: { [TEXT_ID]: 'Old', [NUMBER_ID]: 3 },
      }),
    });

    const result = setNotePropertyValue(original, schemas, {
      databaseId: DB_ID,
      propertyId: TEXT_ID,
      value: 'Updated',
    });

    expect(result).toEqual({
      ok: true,
      extraFrontmatter: {
        project: { owner: 'Nodus' },
        nodus_data: namespace({
          [DB_ID]: { [TEXT_ID]: 'Updated', [NUMBER_ID]: 3 },
        }),
      },
    });
    expect(original.extraFrontmatter.nodus_data).toEqual(
      namespace({ [DB_ID]: { [TEXT_ID]: 'Old', [NUMBER_ID]: 3 } }),
    );
  });

  it('requires explicit confirmation before adding metadata or database membership', () => {
    const original = note({ project: 'Research' });
    const input = { databaseId: DB_ID, propertyId: TEXT_ID, value: 'Added' };

    expect(setNotePropertyValue(original, schemas, input)).toEqual({
      ok: false,
      confirmationRequired: true,
    });
    const confirmed = setNotePropertyValue(original, schemas, { ...input, confirmCreate: true });
    expect(confirmed).toMatchObject({ ok: true });
    if (confirmed.ok) {
      const stored = parseNote(serializeNote({ ...original, extraFrontmatter: confirmed.extraFrontmatter }), original.path);
      expect(stored.id).toBe(original.id);
      expect(stored.body).toBe(original.body);
      expect(stored.extraFrontmatter.project).toBe('Research');
      expect(stored.extraFrontmatter.nodus_data).toEqual(
        namespace({ [DB_ID]: { [TEXT_ID]: 'Added' } }),
      );
    }
  });

  it('rejects mutation if existing namespace data is invalid and leaves it unchanged', () => {
    const original = note({
      nodus_data: namespace({ [DB_ID]: { [NUMBER_ID]: 'invalid' } }),
    });
    const before = JSON.stringify(original.extraFrontmatter);

    const result = setNotePropertyValue(original, schemas, {
      databaseId: DB_ID,
      propertyId: TEXT_ID,
      value: 'Would update',
    });

    expect(result).toMatchObject({ ok: false, issues: [{ code: 'TYPE_MISMATCH' }] });
    expect(JSON.stringify(original.extraFrontmatter)).toBe(before);
  });
});
