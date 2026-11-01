import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DatabaseView } from '../src/database/database-view.js';
import type { UiDatabaseView } from '../src/ui-server/dto.js';
import { SavedViewOrderControls } from '../ui/src/SavedViewControls.js';
import { moveSavedViewId } from '../ui/src/saved-view-order.js';

const DB = '9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function savedView(id: string, name: string): UiDatabaseView {
  const view: DatabaseView = {
    id, databaseId: DB, name, type: 'gallery', settings: {},
    sort: { propertyId: 'title', direction: 'asc' },
    sorts: [{ propertyId: 'title', direction: 'asc' }],
    filters: [], visiblePropertyIds: [],
  };
  return { view, path: `database-views/${DB}/${id}.json`, contentHash: 'a'.repeat(64), diagnostics: [] };
}

describe('saved-view order controls', () => {
  it('offers keyboard-reachable up/down buttons with explicit names and boundary states', () => {
    const markup = renderToStaticMarkup(createElement(SavedViewOrderControls, {
      views: [savedView(A, 'Alpha'), savedView(B, 'Beta'), savedView(C, 'Gamma')],
      disabled: false,
      onMove: () => undefined,
    }));
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Reorder saved views"');
    expect(markup).toContain('aria-label="Move Alpha up"');
    expect(markup).toContain('aria-label="Move Alpha down"');
    expect(markup).toContain('aria-label="Move Gamma up"');
    expect(markup).toContain('aria-label="Move Gamma down"');
    expect(markup).toMatch(/aria-label="Move Alpha up"[^>]*disabled=""/);
    expect(markup).toMatch(/aria-label="Move Gamma down"[^>]*disabled=""/);
    expect(markup).not.toMatch(/aria-label="Move Beta up"[^>]*disabled=""/);
    expect(markup.match(/type="button"/g)).toHaveLength(6);
  });

  it('disables every reorder control while the view is busy', () => {
    const markup = renderToStaticMarkup(createElement(SavedViewOrderControls, {
      views: [savedView(A, 'Alpha'), savedView(B, 'Beta')],
      disabled: true,
      onMove: () => undefined,
    }));
    expect(markup.match(/disabled=""/g)).toHaveLength(4);
  });

  it('renders nothing when there is no meaningful order to change', () => {
    expect(renderToStaticMarkup(createElement(SavedViewOrderControls, {
      views: [savedView(A, 'Alpha')], disabled: false, onMove: () => undefined,
    }))).toBe('');
  });
});

describe('moveSavedViewId', () => {
  it('moves one stable view ID without touching the others', () => {
    expect(moveSavedViewId([A, B, C], C, -1)).toEqual([A, C, B]);
    expect(moveSavedViewId([A, B, C], A, 1)).toEqual([B, A, C]);
    expect(moveSavedViewId([A, B, C], B, -1)).toEqual([B, A, C]);
  });

  it('returns null at a boundary or for an unknown ID', () => {
    expect(moveSavedViewId([A, B], A, -1)).toBeNull();
    expect(moveSavedViewId([A, B], B, 1)).toBeNull();
    expect(moveSavedViewId([A, B], C, 1)).toBeNull();
    expect(moveSavedViewId([], A, 1)).toBeNull();
  });
});
