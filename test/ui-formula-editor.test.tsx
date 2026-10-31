import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Property } from '../src/database/schema.js';
import type { UiDatabaseRow } from '../src/ui-server/dto.js';
import { FormulaValueDisplay } from '../ui/src/DatabasesView.js';
import { FormulaEditor } from '../ui/src/database/FormulaEditor.js';

const COUNT = '11111111-1111-4111-8111-111111111111';
const RESULT = '22222222-2222-4222-8222-222222222222';
const properties: Property[] = [
  { id: COUNT, name: 'Count', type: 'number' },
  { id: RESULT, name: 'Double', type: 'formula', formula: { expression: `@{${COUNT}} * 2` } },
];

describe('formula editor and formula value presentation', () => {
  it('renders a labeled formula editor with validation, preview guidance, help, and safe actions', () => {
    const html = renderToStaticMarkup(createElement(FormulaEditor, {
      property: properties[1]!, properties,
      onApply: vi.fn(), onCancel: vi.fn(),
    }));
    expect(html).toContain('Formula editor for Double');
    expect(html).toContain('Validation');
    expect(html).toContain('Preview');
    expect(html).toContain('Add a record to this database to preview the formula in record context.');
    expect(html).toContain('Function reference');
    expect(html).toContain('Apply formula');
    expect(html).toContain('Cancel formula edit');
    expect(html).toContain('Returns Number');
  });

  it('explains invalid and empty formulas without treating them as a preview value', () => {
    const html = renderToStaticMarkup(createElement(FormulaEditor, {
      property: { id: RESULT, name: 'Double', type: 'formula', formula: { expression: '' } },
      properties, onApply: vi.fn(), onCancel: vi.fn(),
    }));
    expect(html).toContain('SYNTAX_ERROR');
    expect(html).toContain('Apply formula');
    expect(html).toContain('disabled=""');
  });

  it('shows null distinctly and exposes an accessible formula error affordance', () => {
    const row = {
      noteId: 'note', title: 'Example', path: 'example.md', databaseId: 'database', values: { [RESULT]: null },
      updatedAt: '', contentHash: '0'.repeat(64), issues: [],
    } as UiDatabaseRow;
    const nullHtml = renderToStaticMarkup(createElement(FormulaValueDisplay, { row, property: properties[1]! }));
    expect(nullHtml).toContain('No value');
    expect(nullHtml).toContain('Double: no value');
    const errorHtml = renderToStaticMarkup(createElement(FormulaValueDisplay, {
      row: { ...row, issues: [{ noteId: 'note', path: row.path, databaseId: 'database', propertyId: RESULT, code: 'FORMULA_ERROR', formulaErrorCode: 'DIVISION_BY_ZERO', formulaErrorSpan: { start: 0, end: 3 }, message: 'Division by zero' }] },
      property: properties[1]!,
    }));
    expect(errorHtml).toContain('Show formula error for Double on Example');
    expect(errorHtml).toContain('Formula error');
    expect(errorHtml).not.toContain('stack trace');
  });
});
