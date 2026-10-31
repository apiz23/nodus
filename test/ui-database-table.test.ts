import { describe, expect, it } from 'vitest';
import type { Property } from '../src/database/schema.js';
import type { UiDatabaseRow } from '../src/ui-server/dto.js';
import {
  filterDatabaseRows,
  databaseIdentityLabel,
  filterOperators,
  hasBlockingRowIssues,
  isValidFilter,
  selectDatabaseRows,
  sortDatabaseRows,
  sortDatabaseRowsBy,
  type DatabaseFilter,
} from '../ui/src/database-table.js';

const IDS = {
  alpha: '11111111-1111-4111-8111-111111111111',
  beta: '22222222-2222-4222-8222-222222222222',
  status: '33333333-3333-4333-8333-333333333333',
  topic: '44444444-4444-4444-8444-444444444444',
  red: '55555555-5555-4555-8555-555555555555',
  blue: '66666666-6666-4666-8666-666666666666',
  dbA: '77777777-7777-4777-8777-777777777777',
  dbB: '88888888-8888-4888-8888-888888888888',
};

const properties: Property[] = [
  { id: IDS.alpha, name: 'Summary', type: 'text' },
  { id: IDS.beta, name: 'Score', type: 'number' },
  { id: IDS.status, name: 'Done', type: 'checkbox' },
  { id: IDS.topic, name: 'Due', type: 'date' },
  { id: IDS.red, name: 'Status', type: 'select', options: [{ id: IDS.red, name: 'Ready' }, { id: IDS.blue, name: 'Later' }] },
  { id: IDS.blue, name: 'Topics', type: 'multi-select', options: [{ id: IDS.red, name: 'Work' }, { id: IDS.blue, name: 'Research' }] },
];

function row(
  noteId: string,
  title: string,
  values: Record<string, unknown>,
): UiDatabaseRow {
  return {
    noteId,
    title,
    path: `notes/${title}.md`,
    databaseId: IDS.dbA,
    values,
    updatedAt: '',
    contentHash: '0'.repeat(64),
    issues: [],
  } as UiDatabaseRow;
}

const rows = [
  row('note-b', 'Beta', {
    [IDS.alpha]: 'Alpha project', [IDS.beta]: 10, [IDS.status]: true,
    [IDS.topic]: '2026-10-20', [IDS.red]: IDS.red, [IDS.blue]: [IDS.blue],
  }),
  row('note-a', 'Alpha', {
    [IDS.alpha]: 'alpha task', [IDS.beta]: 5, [IDS.status]: false,
    [IDS.topic]: '2026-10-28', [IDS.red]: IDS.blue, [IDS.blue]: [IDS.red, IDS.blue],
  }),
  row('note-c', 'Missing', { [IDS.beta]: Number.NaN, [IDS.topic]: 'not-a-date' }),
];

describe('database table session controls', () => {
  it('sorts all supported types and uses note IDs as stable deterministic ties', () => {
    expect(sortDatabaseRows(rows, properties, IDS.beta, 'asc').map((item) => item.noteId)).toEqual(['note-a', 'note-b', 'note-c']);
    expect(sortDatabaseRows(rows, properties, IDS.beta, 'desc').map((item) => item.noteId)).toEqual(['note-b', 'note-a', 'note-c']);
    expect(sortDatabaseRows(rows, properties, IDS.alpha, 'asc').map((item) => item.noteId)).toEqual(['note-b', 'note-a', 'note-c']);
    expect(sortDatabaseRows(rows, properties, 'title', 'asc').map((item) => item.noteId)).toEqual(['note-a', 'note-b', 'note-c']);
    expect(sortDatabaseRows(rows, properties, IDS.status, 'asc').map((item) => item.noteId)).toEqual(['note-a', 'note-b', 'note-c']);
    expect(sortDatabaseRows(rows, properties, IDS.topic, 'asc').map((item) => item.noteId)).toEqual(['note-b', 'note-a', 'note-c']);
    expect(sortDatabaseRows(rows, properties, IDS.red, 'asc').map((item) => item.noteId)).toEqual(['note-a', 'note-b', 'note-c']);
    expect(sortDatabaseRows(rows, properties, IDS.blue, 'asc').map((item) => item.noteId)).toEqual(['note-b', 'note-a', 'note-c']);
    expect(sortDatabaseRows([
      row('z-note', 'Z', { [IDS.beta]: 1 }),
      row('a-note', 'A', { [IDS.beta]: 1 }),
    ], properties, IDS.beta, 'asc').map((item) => item.noteId)).toEqual(['a-note', 'z-note']);
  });

  it('validates typed filter operators and filters text, number, checkbox, date, select and multi-select values', () => {
    const filters: DatabaseFilter[] = [
      { id: 'f1', propertyId: IDS.alpha, operator: 'contains', value: 'PROJECT' },
      { id: 'f2', propertyId: IDS.beta, operator: 'greater', value: 8 },
      { id: 'f3', propertyId: IDS.status, operator: 'is', value: true },
      { id: 'f4', propertyId: IDS.topic, operator: 'before', value: '2026-10-25' },
      { id: 'f5', propertyId: IDS.red, operator: 'is', value: IDS.red },
      { id: 'f6', propertyId: IDS.blue, operator: 'includes', value: IDS.blue },
    ];
    expect(filterDatabaseRows(rows, properties, filters).map((item) => item.noteId)).toEqual(['note-b']);
    expect(isValidFilter(properties[1]!, 'greater', Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidFilter(properties[3]!, 'before', '2026-02-30')).toBe(false);
    expect(isValidFilter(properties[4]!, 'contains', IDS.red)).toBe(false);
    expect(isValidFilter(properties[5]!, 'includes', 'not-an-option')).toBe(false);
  });

  it('combines filters, produces empty results safely, and ignores incomplete filters', () => {
    expect(selectDatabaseRows(rows, properties, [
      { id: 'text', propertyId: IDS.alpha, operator: 'contains', value: 'alpha' },
      { id: 'number', propertyId: IDS.beta, operator: 'less', value: 8 },
    ], 'title', 'asc').map((item) => item.noteId)).toEqual(['note-a']);
    expect(filterDatabaseRows(rows, properties, [
      { id: 'none', propertyId: IDS.alpha, operator: 'equals', value: 'no match' },
    ])).toEqual([]);
    expect(filterDatabaseRows(rows, properties, [
      { id: 'incomplete', propertyId: IDS.beta, operator: 'greater', value: '' },
      { id: 'unknown', propertyId: 'deleted-property', operator: 'equals', value: 'x' },
    ])).toEqual(rows);
  });

  it('allows empty text equality while empty contains remains inactive', () => {
    const textProperty = properties[0]!;
    const withEmpty = [row('empty-note', 'Empty value', { [IDS.alpha]: '' }), ...rows];
    const equality: DatabaseFilter = { id: 'empty-equality', propertyId: IDS.alpha, operator: 'equals', value: '' };
    const contains: DatabaseFilter = { id: 'empty-contains', propertyId: IDS.alpha, operator: 'contains', value: '' };

    expect(isValidFilter(textProperty, 'equals', '')).toBe(true);
    expect(filterDatabaseRows(withEmpty, properties, [equality]).map((item) => item.noteId)).toEqual(['empty-note']);
    expect(isValidFilter(textProperty, 'contains', '')).toBe(false);
    expect(filterDatabaseRows(withEmpty, properties, [contains])).toEqual(withEmpty);
  });

  it('sorts by ordered typed conditions and applies stable ID ties', () => {
    const multi = [
      row('b', 'Beta', { [IDS.beta]: 1, [IDS.alpha]: 'same' }),
      row('a', 'Alpha', { [IDS.beta]: 1, [IDS.alpha]: 'same' }),
      row('c', 'Charlie', { [IDS.beta]: 0, [IDS.alpha]: 'same' }),
    ];
    expect(sortDatabaseRowsBy(multi, properties, [{ propertyId: IDS.beta, direction: 'desc' }, { propertyId: 'title', direction: 'asc' }]).map((item) => item.noteId)).toEqual(['a', 'b', 'c']);
    expect(sortDatabaseRowsBy(multi, properties, [{ propertyId: IDS.beta, direction: 'asc' }]).map((item) => item.noteId)).toEqual(['c', 'a', 'b']);
  });

  it('distinguishes empty values from false and zero', () => {
    const records = [
      row('missing', 'Missing', {}), row('null', 'Null', { [IDS.alpha]: null }),
      row('empty', 'Empty', { [IDS.alpha]: '', [IDS.blue]: [] }),
      row('false', 'False', { [IDS.status]: false, [IDS.alpha]: 'present' }), row('zero', 'Zero', { [IDS.beta]: 0, [IDS.alpha]: 'also present' }),
    ];
    const emptyText: DatabaseFilter = { id: 'e', propertyId: IDS.alpha, operator: 'is-empty' };
    expect(filterDatabaseRows(records, properties, [emptyText]).map((item) => item.noteId)).toEqual(['missing', 'null', 'empty']);
    expect(filterDatabaseRows(records, properties, [{ ...emptyText, operator: 'is-not-empty' }]).map((item) => item.noteId)).toEqual(['false', 'zero']);
    expect(filterDatabaseRows(records, properties, [{ id: 'a', propertyId: IDS.status, operator: 'is-empty' }]).map((item) => item.noteId)).toEqual(['missing', 'null', 'empty', 'zero']);
    expect(filterDatabaseRows(records, properties, [{ id: 'b', propertyId: IDS.beta, operator: 'is-empty' }]).map((item) => item.noteId)).toEqual(['missing', 'null', 'empty', 'false']);
    expect(filterDatabaseRows(records, properties, [{ id: 'c', propertyId: IDS.blue, operator: 'is-empty' }]).map((item) => item.noteId)).toContain('empty');
  });

  it('uses inferred formula result types for date, number, boolean, and string filters', () => {
    const formulaNumber: Property = { id: 'formula-number', name: 'Total', type: 'formula', formula: { expression: '1 + 1', resultType: 'number' } };
    const formulaDate: Property = { id: 'formula-date', name: 'Date', type: 'formula', formula: { expression: 'date("2026-01-01")', resultType: 'date' } };
    const formulaBoolean: Property = { id: 'formula-boolean', name: 'Ready', type: 'formula', formula: { expression: 'true', resultType: 'boolean' } };
    const formulaString: Property = { id: 'formula-string', name: 'Label', type: 'formula', formula: { expression: '"abc"', resultType: 'string' } };
    const formulaProperties = [formulaNumber, formulaDate, formulaBoolean, formulaString];
    const formulaRows = [
      row('formula-a', 'A', { 'formula-number': 3, 'formula-date': '2026-01-01', 'formula-boolean': true, 'formula-string': 'abc' }),
      row('formula-b', 'B', { 'formula-number': 5, 'formula-date': '2026-02-01', 'formula-boolean': false, 'formula-string': 'xyz' }),
      { ...row('formula-error', 'Error', { 'formula-number': null }), issues: [{ propertyId: 'formula-number', code: 'FORMULA_ERROR', message: 'invalid' }] } as UiDatabaseRow,
    ];

    expect(filterOperators(formulaDate)).toEqual(['equals', 'before', 'after', 'is-empty', 'is-not-empty']);
    expect(isValidFilter(formulaNumber, 'greater', 2)).toBe(true);
    expect(isValidFilter(formulaNumber, 'greater', '2')).toBe(false);
    expect(isValidFilter(formulaBoolean, 'is', true)).toBe(true);
    expect(isValidFilter(formulaString, 'contains', 'b')).toBe(true);
    expect(filterDatabaseRows(formulaRows, formulaProperties, [{ id: 'date', propertyId: formulaDate.id, operator: 'before', value: '2026-01-15' }]).map((item) => item.noteId)).toEqual(['formula-a']);
    expect(filterDatabaseRows(formulaRows, formulaProperties, [{ id: 'number', propertyId: formulaNumber.id, operator: 'greater', value: 2 }]).map((item) => item.noteId)).toEqual(['formula-a', 'formula-b']);
    expect(filterDatabaseRows(formulaRows, formulaProperties, [{ id: 'boolean', propertyId: formulaBoolean.id, operator: 'is', value: true }]).map((item) => item.noteId)).toEqual(['formula-a']);
    expect(filterDatabaseRows(formulaRows, formulaProperties, [{ id: 'string', propertyId: formulaString.id, operator: 'contains', value: 'B' }]).map((item) => item.noteId)).toEqual(['formula-a']);
  });

  it('keeps source-property editing available when a derived formula has a row error', () => {
    const record = {
      ...row('formula-error-note', 'Formula error', { [IDS.alpha]: 'source value' }),
      issues: [{ noteId: 'formula-error-note', path: 'notes/Formula error.md', databaseId: IDS.dbA, propertyId: IDS.beta, code: 'FORMULA_ERROR', message: 'Division by zero' }],
    } as UiDatabaseRow;
    expect(hasBlockingRowIssues(record)).toBe(false);
    expect(hasBlockingRowIssues(record, properties[0])).toBe(false);
  });

  it('does not mutate rows or schemas while sorting/filtering', () => {
    const beforeRows = JSON.stringify(rows);
    const beforeProperties = JSON.stringify(properties);
    selectDatabaseRows(rows, properties, [
      { id: 'f', propertyId: IDS.status, operator: 'is', value: false },
    ], IDS.alpha, 'desc');
    expect(JSON.stringify(rows)).toBe(beforeRows);
    expect(JSON.stringify(properties)).toBe(beforeProperties);
  });

  it('distinguishes same-named databases by stable path and ID in their selector label', () => {
    const first = { id: IDS.dbA, name: 'Tasks', path: `databases/${IDS.dbA}.json` };
    const second = { id: IDS.dbB, name: 'Tasks', path: `databases/${IDS.dbB}.json` };
    expect(databaseIdentityLabel(first)).not.toBe(databaseIdentityLabel(second));
    expect(databaseIdentityLabel(first)).toContain(IDS.dbA);
    expect(databaseIdentityLabel(second)).toContain(IDS.dbB);
  });
});
