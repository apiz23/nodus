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
});
