import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Property } from '../src/database/schema.js';
import type { UiDatabaseRow } from '../src/ui-server/dto.js';
import { CalendarView, GalleryView, KanbanView, ListView } from '../ui/src/DatabaseLayouts.js';
import { RelationValue } from '../ui/src/RelationControl.js';

const REL = '11111111-1111-4111-8111-111111111111';
const STATUS = '22222222-2222-4222-8222-222222222222';
const DATE = '33333333-3333-4333-8333-333333333333';
const ROLLUP = '77777777-7777-4777-8777-777777777777';
const FORMULA = '88888888-8888-4888-8888-888888888888';
const TARGET = '44444444-4444-4444-8444-444444444444';
const MISSING = '55555555-5555-4555-8555-555555555555';
const OPENED: string[] = [];

const relation: Property = { id: REL, name: 'Related tasks', type: 'relation', relation: { databaseId: '99999999-9999-4999-8999-999999999999', cardinality: 'many' } };
const rollup: Property = { id: ROLLUP, name: 'Average estimate', type: 'rollup', rollup: { relationPropertyId: REL, operation: 'average', targetPropertyId: TARGET } };
const formula: Property = { id: FORMULA, name: 'Related formula', type: 'formula', formula: { expression: `relatedCount(@{${REL}})`, resultType: 'number' } };
const status: Property = { id: STATUS, name: 'Status', type: 'select', options: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Open' }] };
const date: Property = { id: DATE, name: 'Due', type: 'date' };

const row: UiDatabaseRow = {
  noteId: '66666666-6666-4666-8666-666666666666',
  path: 'projects/project.md',
  title: 'Project Alpha',
  updatedAt: '2026-11-01T00:00:00Z',
  contentHash: 'a'.repeat(64),
  values: { [REL]: [TARGET, MISSING], [ROLLUP]: 12.5, [FORMULA]: 2, [STATUS]: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', [DATE]: '2026-11-02' },
  relations: { [REL]: [{ id: TARGET, title: 'Task Beta', path: 'tasks/beta.md', status: 'resolved' }, { id: MISSING, status: 'missing' }] },
  issues: [],
};

const renderRelation = (target: UiDatabaseRow) => createElement(RelationValue, { references: target.relations?.[REL], onOpen: (id: string) => { OPENED.push(id); } });
const formatValue = (property: Property, value: unknown) => String(value ?? '—');

describe('relation values in every database layout', () => {
  it('renders the same resolved and missing relation states in Table-style cells', () => {
    const markup = renderToStaticMarkup(renderRelation(row));
    expect(markup).toContain('Open related record Task Beta, tasks/beta.md');
    expect(markup).toContain('Missing record');
    expect(markup).not.toContain(TARGET);
    expect(markup).not.toContain(MISSING);
  });

  it('renders relations in List, Kanban, Calendar, and Gallery layouts with property visibility', () => {
    const common = { rows: [row], visibleProperties: [relation, rollup, formula], disabled: false, onOpen: () => undefined, onEdit: () => undefined, formatValue, renderValue: (target: UiDatabaseRow, property: Property) => property.type === 'relation' ? renderRelation(target) : formatValue(property, target.values[property.id]) };
    const list = renderToStaticMarkup(createElement(ListView, common));
    const kanban = renderToStaticMarkup(createElement(KanbanView, { ...common, property: status }));
    const calendar = renderToStaticMarkup(createElement(CalendarView, { ...common, property: date, onCreate: () => undefined }));
    const gallery = renderToStaticMarkup(createElement(GalleryView, common));

    for (const markup of [list, kanban, calendar, gallery]) {
      expect(markup).toContain('Related tasks');
      expect(markup).toContain('Open related record Task Beta, tasks/beta.md');
      expect(markup).toContain('Missing record');
      expect(markup).toContain('Average estimate');
      expect(markup).toContain('12.5');
      expect(markup).toContain('Related formula');
      expect(markup).toContain('2');
      expect(markup).not.toContain('Estimate');
    }
    expect(list).toContain('aria-label="Database list view"');
    expect(kanban).toContain('aria-label="Kanban grouped by Status"');
    expect(calendar).toContain('aria-label="Calendar by Due"');
    expect(gallery).toContain('aria-label="Database gallery view"');
  });

  it('renders an explicit empty state when a record has no relations', () => {
    const empty = { ...row, values: {}, relations: { [REL]: [] } };
    const markup = renderToStaticMarkup(createElement(GalleryView, {
      rows: [empty], visibleProperties: [relation], disabled: false, onOpen: () => undefined,
      onEdit: () => undefined, formatValue, renderValue: (target: UiDatabaseRow) => renderRelation(target),
    }));
    expect(markup).toContain('—');
  });
});
