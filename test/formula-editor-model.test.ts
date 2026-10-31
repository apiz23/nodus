import { describe, expect, it } from 'vitest';
import type { Property } from '../src/database/schema.js';
import type { UiDatabaseRow } from '../src/ui-server/dto.js';
import { FORMULA_EDITOR_SUGGESTIONS } from '../src/database/formula-engine.js';
import { analyzeFormulaDraft, formulaCompletions } from '../ui/src/database/formula-editor-model.js';

const IDS = {
  title: '11111111-1111-4111-8111-111111111111',
  count: '22222222-2222-4222-8222-222222222222',
  doubled: '33333333-3333-4333-8333-333333333333',
  total: '44444444-4444-4444-8444-444444444444',
  status: '55555555-5555-4555-8555-555555555555',
  relation: '66666666-6666-4666-8666-666666666666',
};

const properties: Property[] = [
  { id: IDS.title, name: 'Title', type: 'text' },
  { id: IDS.count, name: 'Count', type: 'number' },
  { id: IDS.status, name: 'Done', type: 'checkbox' },
  { id: IDS.doubled, name: 'Doubled', type: 'formula', formula: { expression: `@{${IDS.count}} * 2` } },
  { id: IDS.total, name: 'Total', type: 'formula', formula: { expression: `@{${IDS.doubled}} + 1` } },
  { id: IDS.relation, name: 'Related', type: 'relation', relation: { databaseId: IDS.relation, cardinality: 'many' } },
  { id: '77777777-7777-4777-8777-777777777777', name: 'Status', type: 'select', options: [] },
];

const previewRow = {
  noteId: 'note-id', title: 'Example record', path: 'example.md', databaseId: 'database-id',
  values: { [IDS.title]: 'example', [IDS.count]: 4, [IDS.doubled]: 8, [IDS.total]: 9, [IDS.status]: true },
  updatedAt: '', contentHash: '0'.repeat(64), issues: [],
} as UiDatabaseRow;

describe('formula editor model', () => {
  it('suggests stable UUID property references and identifies unsupported properties', () => {
    const source = '@{tit';
    const completion = formulaCompletions(source, source.length, properties)!;
    expect(completion.kind).toBe('property');
    expect(completion.options.find((option) => option.label === 'Title')).toMatchObject({
      insertText: `@{${IDS.title}}`, detail: expect.stringContaining(IDS.title),
    });
    const all = formulaCompletions('@{', 2, properties)!;
    expect(all.options.find((option) => option.label === 'Related')).toMatchObject({ disabled: true, reason: expect.stringContaining('numeric rollup') });
    expect(all.options.find((option) => option.label === 'Status')).toMatchObject({ disabled: true });
  });

  it('derives function and logic suggestions from the engine registry', () => {
    expect(FORMULA_EDITOR_SUGGESTIONS.map((item) => item.name)).toEqual(expect.arrayContaining([
      'concat', 'upper', 'lower', 'trim', 'length', 'contains', 'abs', 'round', 'floor', 'ceil', 'min', 'max', 'if', 'and', 'or', 'not', 'date', 'year', 'month', 'day', 'dateAdd', 'dateDiff',
    ]));
    const completion = formulaCompletions('up', 2, properties)!;
    expect(completion.options).toHaveLength(1);
    expect(completion.options[0]).toMatchObject({ label: 'upper', insertText: 'upper(', documentation: { description: expect.any(String), example: expect.any(String) } });
    for (const item of FORMULA_EDITOR_SUGGESTIONS) {
      expect(item.signature).toContain(item.name);
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.example.length).toBeGreaterThan(0);
      expect(item.insertText.length).toBeGreaterThan(0);
    }
    expect(formulaCompletions('"@{Title', 8, properties)).toBeUndefined();
  });

  it('reports syntax and static type diagnostics with source spans', () => {
    const syntax = analyzeFormulaDraft(`@{${IDS.count}`, properties, IDS.total);
    expect(syntax.diagnostics[0]).toMatchObject({ code: 'SYNTAX_ERROR', span: { start: 0 } });
    const unknown = analyzeFormulaDraft('@{99999999-9999-4999-8999-999999999999} + 1', properties, IDS.total);
    expect(unknown.diagnostics[0]).toMatchObject({ code: 'UNKNOWN_PROPERTY', propertyId: '99999999-9999-4999-8999-999999999999', span: expect.any(Object) });
    const wrongType = analyzeFormulaDraft(`@{${IDS.title}} - 1`, properties, IDS.total);
    expect(wrongType.diagnostics[0]).toMatchObject({ code: 'TYPE_MISMATCH', span: expect.any(Object) });
  });

  it('detects self and indirect cycles while leaving independent formulas valid', () => {
    const self = analyzeFormulaDraft(`@{${IDS.total}} + 1`, properties, IDS.total);
    expect(self.diagnostics.some((diagnostic) => diagnostic.code === 'CIRCULAR_DEPENDENCY' && diagnostic.relatedPropertyIds?.includes(IDS.total))).toBe(true);
    const indirect = analyzeFormulaDraft(`@{${IDS.total}} + 1`, properties, IDS.doubled);
    expect(indirect.diagnostics.some((diagnostic) => diagnostic.code === 'CIRCULAR_DEPENDENCY')).toBe(true);
    const unrelated = analyzeFormulaDraft(`@{${IDS.count}} + 1`, properties, IDS.total);
    expect(unrelated.diagnostics).toEqual([]);
  });

  it('previews dependencies from current record source values and updated candidate formulas', () => {
    const doubled = analyzeFormulaDraft(`@{${IDS.count}} * 3`, properties, IDS.doubled, previewRow);
    expect(doubled.resultType).toBe('number');
    expect(doubled.dependencies).toEqual([IDS.count]);
    expect(doubled.preview).toEqual({ type: 'number', value: 12 });
    const total = analyzeFormulaDraft(`@{${IDS.doubled}} + 2`, properties, IDS.total, previewRow);
    expect(total.preview).toEqual({ type: 'number', value: 10 });
  });

  it('keeps null and runtime errors distinct in preview', () => {
    const emptyProperties: Property[] = [{ id: IDS.count, name: 'Count', type: 'number' }, { id: IDS.total, name: 'Result', type: 'formula', formula: { expression: 'null' } }];
    const emptyPreview = { ...previewRow, values: { [IDS.count]: null } } as UiDatabaseRow;
    expect(analyzeFormulaDraft('null', emptyProperties, IDS.total, emptyPreview).preview).toEqual({ type: 'null' });
    const errorPreview = analyzeFormulaDraft(`1 / @{${IDS.count}}`, emptyProperties, IDS.total, { ...emptyPreview, values: { [IDS.count]: 0 } });
    expect(errorPreview.preview).toMatchObject({ type: 'error', error: { code: 'DIVISION_BY_ZERO' } });
  });
});
