import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Property } from '../src/database/schema';
import type { UiDatabaseRow } from '../src/ui-server/dto';
import { KanbanView, GalleryView, CalendarView, type LayoutProps } from '@/DatabaseLayouts';
import { EmbeddedBody } from '@/embeds/EmbeddedDatabaseView';
import {
  EMBED_BOARD_CARD_LIMIT,
  EMBED_GALLERY_CARD_LIMIT,
  EMBED_UNDATED_LIMIT,
} from '@/embeds/embedLimits';

const DATABASE = '11111111-1111-4111-8111-111111111111';
const status: Property = {
  id: 'd0000000-0000-4000-8000-000000000001',
  name: 'Status',
  type: 'select',
  options: Array.from({ length: 5 }, (_, index) => ({ id: `e0000000-0000-4000-8000-00000000000${index}`, name: `Stage ${index + 1}` })),
};
const due: Property = { id: 'd0000000-0000-4000-8000-000000000002', name: 'Due', type: 'date' };

function row(index: number): UiDatabaseRow {
  return {
    noteId: `f0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    path: `notes/row-${index}.md`,
    databaseId: DATABASE,
    title: `Record ${index}`,
    updatedAt: '2026-11-27T00:00:00Z',
    contentHash: 'hash',
    issues: [],
    values: { [status.id]: `e0000000-0000-4000-8000-00000000000${index % 5}` },
  } as UiDatabaseRow;
}

const rows: UiDatabaseRow[] = Array.from({ length: 1_000 }, (_, index) => row(index + 1));

function layoutProps(overrides: Partial<LayoutProps> = {}): LayoutProps {
  return {
    rows,
    visibleProperties: [status],
    disabled: true,
    onOpen: () => undefined,
    onEdit: () => undefined,
    formatValue: () => '',
    renderValue: () => null,
    ...overrides,
  } as LayoutProps;
}

function countCards(html: string): number {
  return (html.match(/<article /g) ?? []).length;
}

describe('embedded board bounds', () => {
  it('renders at most the board card budget for 1,000 rows', () => {
    const html = renderToStaticMarkup(createElement(KanbanView, { ...layoutProps(), property: status, maxCards: EMBED_BOARD_CARD_LIMIT, maxColumns: 12 }));
    expect(countCards(html)).toBeLessThanOrEqual(EMBED_BOARD_CARD_LIMIT);
    expect(countCards(html)).toBeGreaterThan(0);
    expect(html).toContain('Board preview: showing');
    expect(html).toContain('of 1000 cards');
    expect(html).toContain('Open the database for the full view.');
  });

  it('keeps every card for the unbounded database browser', () => {
    const html = renderToStaticMarkup(createElement(KanbanView, { ...layoutProps(), property: status }));
    expect(countCards(html)).toBe(1_000);
    expect(html).not.toContain('Board preview: showing');
  });

  it('caps columns when a Select property has many options', () => {
    const wide: Property = { ...status, options: Array.from({ length: 40 }, (_, index) => ({ id: `e1000000-0000-4000-8000-${String(index).padStart(12, '0')}`, name: `Option ${index}` })) };
    const html = renderToStaticMarkup(createElement(KanbanView, { ...layoutProps(), property: wide, maxCards: EMBED_BOARD_CARD_LIMIT, maxColumns: 12 }));
    expect((html.match(/ column" aria-label|<section[^>]*aria-label="[^"]* column"/g) ?? []).length).toBeLessThanOrEqual(12);
    expect(html).toContain('columns hidden');
  });
});

describe('embedded gallery bounds', () => {
  it('renders at most the gallery card budget and says it is a subset', () => {
    const html = renderToStaticMarkup(createElement(GalleryView, { ...layoutProps(), maxCards: EMBED_GALLERY_CARD_LIMIT }));
    expect(countCards(html)).toBeLessThanOrEqual(EMBED_GALLERY_CARD_LIMIT);
    expect(html).toContain('Gallery preview: showing');
    expect(html).toContain('of 1000 cards');
  });

  it('still renders small galleries in full without a notice', () => {
    const html = renderToStaticMarkup(createElement(GalleryView, { ...layoutProps({ rows: rows.slice(0, 4) }), maxCards: EMBED_GALLERY_CARD_LIMIT }));
    expect(countCards(html)).toBe(4);
    expect(html).not.toContain('Gallery preview: showing');
  });
});

describe('embedded calendar bounds', () => {
  it('caps undated events and reports the subset', () => {
    const undatedRows = rows.map((entry) => ({ ...entry, values: {} }));
    const html = renderToStaticMarkup(createElement(CalendarView, {
      ...layoutProps({ rows: undatedRows }),
      property: due,
      maxUndated: EMBED_UNDATED_LIMIT,
      onCreate: () => undefined,
    }));
    expect(html).toContain(`Calendar preview: showing ${EMBED_UNDATED_LIMIT} of 1000 undated events.`);
  });
});

describe('EmbeddedBody applies the bounds only to embeds', () => {
  it('passes the board budget through the embed dispatcher', () => {
    const html = renderToStaticMarkup(createElement(EmbeddedBody, {
      layout: { kind: 'kanban', groupProperty: status },
      rows,
      properties: [status],
      height: 320,
      databaseId: DATABASE,
      onOpenNote: () => undefined,
    }));
    expect(countCards(html)).toBeLessThanOrEqual(EMBED_BOARD_CARD_LIMIT);
    expect(html).toContain('Board preview: showing');
  });

  it('passes the gallery budget through the embed dispatcher', () => {
    const html = renderToStaticMarkup(createElement(EmbeddedBody, {
      layout: { kind: 'gallery' },
      rows,
      properties: [status],
      height: 320,
      databaseId: DATABASE,
      onOpenNote: () => undefined,
    }));
    expect(countCards(html)).toBeLessThanOrEqual(EMBED_GALLERY_CARD_LIMIT);
    expect(html).toContain('Gallery preview: showing');
  });
});
