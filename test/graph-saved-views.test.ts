import { describe, expect, it } from 'vitest';
import {
  createSavedGraphView,
  graphViewsStorageKey,
  mergeImportedGraphViews,
  parseGraphViewsImport,
  sanitizeGraphViewReferences,
  serializeGraphViewsExport,
  validateGraphViewReferences,
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
  renderLimit: 200,
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

  it('defaults legacy local views without a render limit to 200', () => {
    const view = createSavedGraphView('Legacy', config, '2026-11-03T00:00:00Z');
    const raw = JSON.parse(serializeSavedGraphViews([view]));
    delete raw.views[0].config.renderLimit;
    expect(parseSavedGraphViews(JSON.stringify(raw))[0]?.config.renderLimit).toBe(200);
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


describe('portable graph view export and import', () => {
  const refs = {
    noteIds: new Set([config.focusId!]),
    folderPaths: new Set(['notes']),
    clusterIds: new Set(['cluster-a']),
  };

  it('exports no vault path and parses portable and legacy envelopes', () => {
    const view = createSavedGraphView('Portable', config, '2026-11-03T00:00:00Z');
    const serialized = serializeGraphViewsExport([view], '2026-11-04T00:00:00Z');
    expect(serialized).not.toContain('/vault');
    const portable = parseGraphViewsImport(serialized);
    expect(portable.issues).toEqual([]);
    expect(portable.views).toEqual([view]);
    const legacy = parseGraphViewsImport(serializeSavedGraphViews([view]));
    expect(legacy.views).toEqual([view]);
    expect(parseGraphViewsImport('{bad').issues).toContain('The file is not valid JSON.');
    expect(parseGraphViewsImport(JSON.stringify({ format: 'nodus-graph-views', version: 99, views: [] })).issues[0]).toContain('not supported');
  });

  it('validates and clears missing destination references', () => {
    const view = createSavedGraphView('References', config, '2026-11-03T00:00:00Z');
    expect(validateGraphViewReferences(view, refs)).toEqual([]);
    const missing = validateGraphViewReferences(view, { noteIds: new Set(), folderPaths: new Set(), clusterIds: new Set() });
    expect(missing).toHaveLength(3);
    const sanitized = sanitizeGraphViewReferences(view, { noteIds: new Set(), folderPaths: new Set(), clusterIds: new Set() });
    expect(sanitized.config).toMatchObject({ folder: null, clusterId: null, focusId: null, selectedId: null });
  });

  it('applies replace, skip, and rename strategies safely', () => {
    const existing = createSavedGraphView('Project map', config, '2026-11-03T00:00:00Z');
    const imported = { ...createSavedGraphView('Project map', config, '2026-11-03T00:00:00Z'), id: existing.id };
    const replace = mergeImportedGraphViews([existing], [imported], 'replace', '2026-11-04T00:00:00Z');
    expect(replace.replaced).toBe(1);
    expect(replace.views).toHaveLength(1);
    const skip = mergeImportedGraphViews([existing], [imported], 'skip', '2026-11-04T00:00:00Z');
    expect(skip.skipped).toBe(1);
    expect(skip.views).toEqual([existing]);
    const rename = mergeImportedGraphViews([existing], [imported], 'rename', '2026-11-04T00:00:00Z');
    expect(rename.renamed).toBe(1);
    expect(rename.views).toHaveLength(2);
    expect(rename.views[1]?.name).toMatch(/Project map \(imported/);
    expect(new Set(rename.views.map((view) => view.id)).size).toBe(2);
    expect(new Set(rename.views.map((view) => view.name.toLocaleLowerCase())).size).toBe(2);
  });
});
