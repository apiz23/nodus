import { describe, expect, it, vi } from 'vitest';
import type { UiDatabase, UiDatabaseRowsResponse, UiDatabaseViewsResponse } from '../src/ui-server/dto';
import { createViewDataService } from '@/embeds/viewDataService';
import { invalidationForMutation, isViewDataInvalidation } from '@/embeds/viewDataInvalidation';

const DB_A = '11111111-1111-4111-8111-111111111111';
const DB_B = '22222222-2222-4222-8222-222222222222';

function database(id = DB_A): UiDatabase {
  return { id, name: 'Tests', path: `databases/${id}.json`, contentHash: 'hash', properties: [] };
}
function views(id = DB_A): UiDatabaseViewsResponse {
  return { databaseId: id, views: [], order: { viewIds: [] } } as unknown as UiDatabaseViewsResponse;
}
function rows(id = DB_A): UiDatabaseRowsResponse {
  return { databaseId: id, schemaHash: 'hash', rows: [], diagnostics: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

const flushNotifications = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });

describe('mutation to cache scope mapping', () => {
  it('does not invalidate embedded views for unrelated writes', () => {
    expect(invalidationForMutation('PUT', '/api/preferences/getting-started')).toEqual({ kind: 'none' });
    expect(invalidationForMutation('PUT', `/api/notes/${DB_A}/tags`)).toEqual({ kind: 'none' });
    expect(invalidationForMutation('POST', '/api/backup')).toEqual({ kind: 'none' });
    expect(invalidationForMutation('PUT', `/api/notes/${DB_A}/tasks/toggle`)).toEqual({ kind: 'none' });
    expect(invalidationForMutation('GET', '/api/notes')).toEqual({ kind: 'none' });
  });

  it('scopes a note save to rows, not to saved views', () => {
    expect(invalidationForMutation('PUT', `/api/notes/${DB_A}`)).toEqual({ kind: 'rows' });
  });

  it('scopes a property write to the database named in the body', () => {
    const body = JSON.stringify({ databaseId: DB_B, propertyId: 'p', baseHash: 'h' });
    expect(invalidationForMutation('PUT', `/api/notes/${DB_A}/properties`, body)).toEqual({ kind: 'rows', databaseId: DB_B });
    expect(invalidationForMutation('PUT', `/api/notes/${DB_A}/calendar-range`, body)).toEqual({ kind: 'rows', databaseId: DB_B });
  });

  it('separates database schema, view and row mutations', () => {
    expect(invalidationForMutation('PUT', `/api/databases/${DB_A}`)).toEqual({ kind: 'database', databaseId: DB_A });
    expect(invalidationForMutation('POST', `/api/databases/${DB_A}/views`)).toEqual({ kind: 'views', databaseId: DB_A });
    expect(invalidationForMutation('DELETE', `/api/databases/${DB_A}/views/order`)).toEqual({ kind: 'views', databaseId: DB_A });
    expect(invalidationForMutation('POST', `/api/databases/${DB_A}/rows`)).toEqual({ kind: 'rows', databaseId: DB_A });
  });

  it('falls back to a full clear for unknown or vault-wide mutations', () => {
    expect(invalidationForMutation('POST', '/api/restore')).toEqual({ kind: 'all' });
    expect(invalidationForMutation('POST', '/api/sync/pull')).toEqual({ kind: 'all' });
    expect(invalidationForMutation('POST', '/api/something-new')).toEqual({ kind: 'all' });
  });

  it('does not clear anything for read-only POST validation endpoints', () => {
    expect(invalidationForMutation('POST', '/api/import/preview')).toEqual({ kind: 'none' });
    expect(invalidationForMutation('POST', '/api/backup/validate')).toEqual({ kind: 'none' });
    expect(invalidationForMutation('POST', '/api/restore/preview')).toEqual({ kind: 'none' });
    expect(invalidationForMutation('POST', '/api/import/execute')).toEqual({ kind: 'all' });
    expect(invalidationForMutation('POST', '/api/import/operations/abc/recover')).toEqual({ kind: 'all' });
  });

  it('recognises only well-formed event details', () => {
    expect(isViewDataInvalidation({ kind: 'rows' })).toBe(true);
    expect(isViewDataInvalidation({ kind: 'rows', databaseId: DB_A })).toBe(true);
    expect(isViewDataInvalidation({ kind: 'rows', databaseId: 4 })).toBe(false);
    expect(isViewDataInvalidation({ kind: 'views' })).toBe(false);
    expect(isViewDataInvalidation({ kind: 'nonsense' })).toBe(false);
    expect(isViewDataInvalidation(null)).toBe(false);
  });
});

describe('scoped cache invalidation', () => {
  it('does not refetch views after an unrelated note save', async () => {
    const viewsLoader = vi.fn(async () => views());
    const rowsLoader = vi.fn(async () => rows());
    const service = createViewDataService({
      databases: async () => [database()],
      views: viewsLoader,
      rows: rowsLoader,
    });

    await service.views(DB_A);
    await service.rows(DB_A);
    service.invalidate(invalidationForMutation('PUT', `/api/notes/${DB_A}`));
    await flushNotifications();

    await service.views(DB_A);
    expect(viewsLoader).toHaveBeenCalledTimes(1);
    await service.rows(DB_A);
    expect(rowsLoader).toHaveBeenCalledTimes(2);
  });

  it('refetches views and rows for the mutated database only', async () => {
    const viewsLoader = vi.fn(async (id: string) => views(id));
    const rowsLoader = vi.fn(async (id: string) => rows(id));
    const service = createViewDataService({
      databases: async () => [database(DB_A), database(DB_B)],
      views: viewsLoader,
      rows: rowsLoader,
    });

    await Promise.all([service.views(DB_A), service.views(DB_B), service.rows(DB_A), service.rows(DB_B)]);
    service.invalidate(invalidationForMutation('PUT', `/api/databases/${DB_A}`));
    await flushNotifications();

    await Promise.all([service.views(DB_A), service.rows(DB_A), service.views(DB_B), service.rows(DB_B)]);
    expect(viewsLoader.mock.calls.map(([id]) => id)).toEqual([DB_A, DB_B, DB_A]);
    expect(rowsLoader.mock.calls.map(([id]) => id)).toEqual([DB_A, DB_B, DB_A]);
  });

  it('coalesces notifications for the same database in one task', async () => {
    const service = createViewDataService({ databases: async () => [], views: async () => views(), rows: async () => rows() });
    const listener = vi.fn();
    service.subscribe(listener);

    service.invalidate({ kind: 'rows', databaseId: DB_A });
    service.invalidate({ kind: 'rows', databaseId: DB_A });
    service.invalidate({ kind: 'views', databaseId: DB_A });
    await flushNotifications();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(DB_A);
  });

  it('notifies once when a full clear follows targeted invalidations', async () => {
    const service = createViewDataService({ databases: async () => [], views: async () => views(), rows: async () => rows() });
    const listener = vi.fn();
    service.subscribe(listener);

    service.invalidate({ kind: 'rows', databaseId: DB_A });
    service.invalidateAll();
    await flushNotifications();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(null);
  });
});

describe('cache lifetime and isolation', () => {
  it('removes expired entries even when their key is never requested again', async () => {
    let now = 0;
    const service = createViewDataService(
      { databases: async () => [database(DB_A)], views: async (id) => views(id), rows: async (id) => rows(id) },
      { ttlMs: 1_000, now: () => now },
    );

    await service.views(DB_A);
    await service.rows(DB_A);
    expect(service.cacheSize).toBe(2);
    now = 1_500;
    expect(service.pruneExpired()).toBe(2);
    expect(service.cacheSize).toBe(0);
  });

  it('bounds retained entries with an LRU-style cap', async () => {
    const service = createViewDataService(
      { databases: async () => [], views: async (id) => views(id), rows: async (id) => rows(id) },
      { maxEntries: 2 },
    );
    await service.views(DB_A);
    await service.rows(DB_A);
    await service.rows(DB_B);
    expect(service.cacheSize).toBe(2);
  });

  it('cannot reuse data from a previous vault', async () => {
    const rowsLoader = vi.fn(async (id: string) => ({ ...rows(id), schemaHash: service.getVaultIdentity() }));
    const service = createViewDataService({ databases: async () => [database()], views: async (id) => views(id), rows: rowsLoader });

    service.setVaultIdentity('/vault-a');
    const a = await service.rows(DB_A);
    service.setVaultIdentity('/vault-b');
    const b = await service.rows(DB_A);
    expect(a.schemaHash).toBe('/vault-a');
    expect(b.schemaHash).toBe('/vault-b');
    expect(rowsLoader).toHaveBeenCalledTimes(2);
  });

  it('does not let an in-flight response from the previous vault enter the new cache', async () => {
    const gate = deferred<UiDatabaseRowsResponse>();
    let call = 0;
    const rowsLoader = vi.fn(() => {
      call += 1;
      return call === 1 ? gate.promise : Promise.resolve({ ...rows(), schemaHash: 'vault-b' });
    });
    const service = createViewDataService({ databases: async () => [database()], views: async () => views(), rows: rowsLoader });

    service.setVaultIdentity('/vault-a');
    const stale = service.rows(DB_A);
    service.setVaultIdentity('/vault-b');
    const fresh = await service.rows(DB_A);
    expect(fresh.schemaHash).toBe('vault-b');

    gate.resolve({ ...rows(), schemaHash: 'vault-a' });
    await stale;
    const cached = await service.rows(DB_A);
    expect(cached.schemaHash).toBe('vault-b');
    expect(rowsLoader).toHaveBeenCalledTimes(2);
  });

  it('never caches a failed load', async () => {
    let attempt = 0;
    const service = createViewDataService({
      databases: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('offline');
        return [database()];
      },
      views: async (id) => views(id),
      rows: async (id) => rows(id),
    });
    await expect(service.rows(DB_A)).resolves.toBeDefined();
    await expect(service.views(DB_B)).resolves.toBeDefined();
    await expect(service.databases()).rejects.toThrow('offline');
    expect(service.cacheSize).toBe(2);
    await expect(service.databases()).resolves.toHaveLength(1);
  });
});
