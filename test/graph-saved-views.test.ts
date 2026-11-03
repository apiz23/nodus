import { describe, expect, it } from 'vitest';
import {
  createSavedGraphView,
  graphViewsStorageKey,
  loadSavedGraphViews,
  parseSavedGraphViews,
  serializeSavedGraphViews,
  updateSavedGraphView,
  writeSavedGraphViews,
  type SavedGraphViewConfig,
  type StorageLike,
} from '../ui/src/graph-saved-views.js';

const config: SavedGraphViewConfig = {
  query: 'project',
  folder: 'notes',
  clusterId: 'cluster-a',
  focusId: '11111111-1111-4111-8111-111111111111',
  selectedId: null,
  showIsolated: false,
  showUnresolved: true,
  pathMode: 'undirected',
  viewport: { x: 12, y: -4, scale: 1.4 },
};

function memoryStorage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe('saved graph views', () => {
  it('round-trips validated views and scopes storage by vault', () => {
    const view = createSavedGraphView('  Project map  ', config, '2026-11-03T00:00:00Z');
    expect(view.name).toBe('Project map');
    const parsed = parseSavedGraphViews(serializeSavedGraphViews([view]));
    expect(parsed).toEqual([view]);
    const storage = memoryStorage();
    writeSavedGraphViews(storage, '/vault/one', [view]);
    expect(loadSavedGraphViews(storage, '/vault/one')).toEqual([view]);
    expect(loadSavedGraphViews(storage, '/vault/two')).toEqual([]);
    expect(graphViewsStorageKey('/vault/one')).not.toBe(graphViewsStorageKey('/vault/two'));
  });

  it('drops malformed, duplicate, and unsupported records safely', () => {
    const view = createSavedGraphView('Valid', config, '2026-11-03T00:00:00Z');
    const raw = JSON.stringify({
      version: 1,
      views: [
        view,
        { ...view },
        { ...view, id: 'broken', config: { ...config, query: 42 } },
        { ...view, id: 'empty-name', name: '   ' },
      ],
    });
    expect(parseSavedGraphViews(raw)).toEqual([view]);
    expect(parseSavedGraphViews('{bad')).toEqual([]);
    expect(parseSavedGraphViews(JSON.stringify({ version: 99, views: [view] }))).toEqual([]);
  });

  it('renames views and updates only the config revision', () => {
    const view = createSavedGraphView('One', config, '2026-11-03T00:00:00Z');
    const next = updateSavedGraphView(view, { name: 'Two', config: { ...config, query: 'next' } }, '2026-11-04T00:00:00Z');
    expect(next).toMatchObject({ id: view.id, name: 'Two', createdAt: view.createdAt, updatedAt: '2026-11-04T00:00:00Z', config: { query: 'next' } });
    expect(() => updateSavedGraphView(view, { name: '   ' })).toThrow(/required/);
  });
});
