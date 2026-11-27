import { describe, expect, it, vi } from 'vitest';
import type { DatabaseView } from '../src/database/database-view';
import type { Property } from '../src/database/schema';
import type { UiDatabase, UiDatabaseRowsResponse, UiDatabaseViewsResponse } from '../src/ui-server/dto';
import { createViewDataService } from '@/embeds/viewDataService';
import { resolveEmbedLayout } from '@/embeds/embedLayout';

const DATABASE_ID = '11111111-1111-4111-8111-111111111111';
const VIEW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const DIRECTIVE = `database: ${DATABASE_ID}\nview: ${VIEW_ID}`;

function database(): UiDatabase {
  return { id: DATABASE_ID, name: 'Tests', path: `databases/${DATABASE_ID}.json`, contentHash: 'hash', properties: [] };
}
function views(): UiDatabaseViewsResponse {
  return { databaseId: DATABASE_ID, views: [], order: { viewIds: [] } } as unknown as UiDatabaseViewsResponse;
}
function rows(): UiDatabaseRowsResponse {
  return { databaseId: DATABASE_ID, schemaHash: 'hash', rows: [], diagnostics: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

const flushNotifications = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });

describe('M1 shared view data service', () => {
  it('shares one in-flight request across twenty concurrent embeds', async () => {
    const gate = deferred<UiDatabase[]>();
    const databases = vi.fn(() => gate.promise);
    const service = createViewDataService({ databases, views: vi.fn(async () => views()), rows: vi.fn(async () => rows()) });

    const pending = Array.from({ length: 20 }, () => service.databases());
    expect(databases).toHaveBeenCalledTimes(1);
    gate.resolve([database()]);
    const results = await Promise.all(pending);
    expect(results.every((result) => result[0]?.id === DATABASE_ID)).toBe(true);
    expect(databases).toHaveBeenCalledTimes(1);
  });

  it('serves later embeds from cache inside the TTL and refetches after expiry', async () => {
    let now = 0;
    const databases = vi.fn(async () => [database()]);
    const service = createViewDataService({ databases, views: async () => views(), rows: async () => rows() }, { ttlMs: 1_000, now: () => now });

    await service.databases();
    await service.databases();
    expect(databases).toHaveBeenCalledTimes(1);
    now = 1_001;
    await service.databases();
    expect(databases).toHaveBeenCalledTimes(2);
  });

  it('shares rows for different views of the same database but keeps view lookups keyed', async () => {
    const rowsLoader = vi.fn(async () => rows());
    const viewsLoader = vi.fn(async () => views());
    const service = createViewDataService({ databases: async () => [database()], views: viewsLoader, rows: rowsLoader });

    await Promise.all([
      Promise.all([service.rows(DATABASE_ID), service.views(DATABASE_ID)]),
      Promise.all([service.rows(DATABASE_ID), service.views(DATABASE_ID)]),
    ]);
    expect(rowsLoader).toHaveBeenCalledTimes(1);
    expect(viewsLoader).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures, and retry succeeds', async () => {
    let attempt = 0;
    const databases = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('temporary');
      return [database()];
    });
    const service = createViewDataService({ databases, views: async () => views(), rows: async () => rows() });

    await expect(service.databases()).rejects.toThrow('temporary');
    expect(service.cacheSize).toBe(0);
    await expect(service.databases()).resolves.toHaveLength(1);
    expect(databases).toHaveBeenCalledTimes(2);
  });

  it('invalidates one database only and notifies subscribers', async () => {
    const other = '22222222-2222-4222-8222-222222222222';
    const rowsLoader = vi.fn(async (id: string) => ({ ...rows(), databaseId: id }));
    const service = createViewDataService({ databases: async () => [database()], views: async () => views(), rows: rowsLoader });
    const listener = vi.fn();
    service.subscribe(listener);

    await service.rows(DATABASE_ID);
    await service.rows(other);
    service.invalidateDatabase(DATABASE_ID);
    await flushNotifications();
    expect(listener).toHaveBeenCalledWith(DATABASE_ID);
    await service.rows(other);
    expect(rowsLoader).toHaveBeenCalledTimes(2);
    await service.rows(DATABASE_ID);
    expect(rowsLoader).toHaveBeenCalledTimes(3);
  });

  it('clears the cache when the vault identity changes', async () => {
    const databases = vi.fn(async () => [database()]);
    const service = createViewDataService({ databases, views: async () => views(), rows: async () => rows() });
    service.setVaultIdentity('/vault-a');
    await service.databases();
    service.setVaultIdentity('/vault-b');
    await service.databases();
    expect(databases).toHaveBeenCalledTimes(2);
    expect(service.getVaultIdentity()).toBe('/vault-b');
  });

  it('ignores an in-flight response that started before invalidation', async () => {
    const gates = [deferred<UiDatabaseRowsResponse>(), deferred<UiDatabaseRowsResponse>()];
    let call = 0;
    const rowsLoader = vi.fn(() => gates[call++].promise);
    const service = createViewDataService({ databases: async () => [database()], views: async () => views(), rows: rowsLoader });

    const stale = service.rows(DATABASE_ID);
    service.invalidateAll();
    const fresh = service.rows(DATABASE_ID);
    expect(rowsLoader).toHaveBeenCalledTimes(2);

    gates[0].resolve({ ...rows(), schemaHash: 'stale' });
    gates[1].resolve({ ...rows(), schemaHash: 'fresh' });
    const [staleResult, freshResult] = await Promise.all([stale, fresh]);
    expect(staleResult.schemaHash).toBe('stale');
    expect(freshResult.schemaHash).toBe('fresh');

    const cached = await service.rows(DATABASE_ID);
    expect(cached.schemaHash).toBe('fresh');
    expect(rowsLoader).toHaveBeenCalledTimes(2);
  });

  it('stops notifying after unsubscribe', async () => {
    const service = createViewDataService({ databases: async () => [database()], views: async () => views(), rows: async () => rows() });
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    unsubscribe();
    service.invalidateAll();
    expect(listener).not.toHaveBeenCalled();
  });
});

const select: Property = { id: 'p-select', name: 'Stage', type: 'select', options: [{ id: 'o-1', name: 'One' }] };
const date: Property = { id: 'p-date', name: 'Due', type: 'date' };
const endDate: Property = { id: 'p-end', name: 'Ends', type: 'date' };
const text: Property = { id: 'p-text', name: 'Notes', type: 'text' };

function view(overrides: Partial<DatabaseView>): DatabaseView {
  return {
    id: VIEW_ID, databaseId: DATABASE_ID, name: 'View', type: 'table', settings: {},
    sort: { propertyId: 'title', direction: 'asc' }, filters: [], visiblePropertyIds: [],
    ...overrides,
  };
}

describe('M2 saved layout resolution', () => {
  const properties = [select, date, endDate, text];

  it('keeps a table a table and a gallery a gallery', () => {
    expect(resolveEmbedLayout(view({ type: 'table' }), properties).kind).toBe('table');
    expect(resolveEmbedLayout(view({ type: 'gallery' }), properties).kind).toBe('gallery');
  });

  it('renders a list with and without a group property', () => {
    expect(resolveEmbedLayout(view({ type: 'list' }), properties)).toEqual({ kind: 'list' });
    expect(resolveEmbedLayout(view({ type: 'list', settings: { groupPropertyId: select.id } }), properties))
      .toEqual({ kind: 'list', groupProperty: select });
  });

  it('renders a board only with a select grouping property', () => {
    const board = resolveEmbedLayout(view({ type: 'kanban', settings: { groupPropertyId: select.id } }), properties);
    expect(board.kind).toBe('kanban');
    const missing = resolveEmbedLayout(view({ type: 'kanban' }), properties);
    expect(missing.kind).toBe('unsupported');
    const wrong = resolveEmbedLayout(view({ type: 'kanban', settings: { groupPropertyId: text.id } }), properties);
    expect(wrong.kind).toBe('unsupported');
  });

  it('renders a calendar with a start date and optional end date', () => {
    const calendar = resolveEmbedLayout(view({ type: 'calendar', settings: { startDatePropertyId: date.id, endDatePropertyId: endDate.id } }), properties);
    expect(calendar.kind).toBe('calendar');
    if (calendar.kind === 'calendar') {
      expect(calendar.startProperty.id).toBe(date.id);
      expect(calendar.endProperty?.id).toBe(endDate.id);
    }
    const legacy = resolveEmbedLayout(view({ type: 'calendar', settings: { datePropertyId: date.id } }), properties);
    expect(legacy.kind).toBe('calendar');
    const missing = resolveEmbedLayout(view({ type: 'calendar' }), properties);
    expect(missing.kind).toBe('unsupported');
  });

  it('falls back explicitly for an unknown layout instead of showing a table', () => {
    const unknown = resolveEmbedLayout(view({ type: 'timeline' as never }), properties);
    expect(unknown.kind).toBe('unsupported');
    if (unknown.kind === 'unsupported') expect(unknown.requested).toBe('timeline');
  });
});
