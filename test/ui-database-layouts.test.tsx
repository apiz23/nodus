import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ListView } from '../ui/src/DatabaseLayouts.js';
import type { Property } from '../src/database/schema.js';
import type { UiDatabaseRow } from '../src/ui-server/dto.js';

const properties: Property[] = [{ id: 'summary', name: 'Summary', type: 'text' }];
const row = { noteId: 'note-1', title: 'A very long record title', path: 'notes/a.md', values: { summary: 'Readable value' }, issues: [] } as UiDatabaseRow;

describe('database list view', () => {
  it('renders title, visible formatted properties, and accessible open/edit actions', () => {
    const markup = renderToStaticMarkup(createElement(ListView, {
      rows: [row], visibleProperties: properties, disabled: false, onOpen: () => undefined,
      onEdit: () => undefined, formatValue: (_property, value) => String(value ?? '—'),
    }));
    expect(markup).toContain('aria-label="Database list view"');
    expect(markup).toContain('A very long record title');
    expect(markup).toContain('Readable value');
    expect(markup).toContain('aria-label="Edit Summary for A very long record title"');
    expect(markup).toContain('data-note-open="note-1"');
  });

  it('shows a useful no-match state without rendering missing properties', () => {
    const markup = renderToStaticMarkup(createElement(ListView, {
      rows: [], visibleProperties: [], disabled: false, onOpen: () => undefined,
      onEdit: () => undefined, formatValue: (_property, value) => String(value ?? '—'),
    }));
    expect(markup).toContain('No records match this view.');
  });

  it('does not expose an edit action for derived formula properties', () => {
    const formula: Property = { id: 'formula', name: 'Derived total', type: 'formula', formula: { expression: '1 + 1', resultType: 'number' } };
    const markup = renderToStaticMarkup(createElement(ListView, {
      rows: [{ ...row, values: { ...row.values, formula: 2 } }], visibleProperties: [formula], disabled: false,
      onOpen: () => undefined, onEdit: () => undefined, formatValue: (_property, value) => String(value ?? 'â€”'),
    }));
    expect(markup).toContain('Derived total');
    expect(markup).not.toContain('aria-label="Edit Derived total for A very long record title"');
  });

  it('renders a windowed slice of large lists while exposing each record position', () => {
    const rows = Array.from({ length: 5000 }, (_, index) => ({ ...row, noteId: `note-${index + 1}`, title: `Record ${String(index + 1).padStart(5, '0')}` }));
    const markup = renderToStaticMarkup(createElement(ListView, {
      rows, visibleProperties: properties, disabled: false, onOpen: () => undefined,
      onEdit: () => undefined, formatValue: (_property, value) => String(value ?? '—'),
    }));
    const renderedRecords = [...markup.matchAll(/role="listitem"/g)].length;
    expect(markup).toContain('aria-setsize="5000"');
    expect(markup).toContain('Record 00001');
    expect(markup).not.toContain('Record 05000');
    expect(renderedRecords).toBeGreaterThan(0);
    expect(renderedRecords).toBeLessThan(5000);
  });
});
