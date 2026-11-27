import { api } from '@/api';
import type { UiDatabase, UiDatabaseRowsResponse, UiDatabaseViewsResponse } from '../../../src/ui-server/dto';
import { isViewDataInvalidation, type ViewDataInvalidation } from './viewDataInvalidation';

/**
 * Shared data layer for embedded database views.
 *
 * One entry per (vault, resource kind, database). Concurrent callers share the
 * in-flight promise, successful values are cached for a short window, and a
 * failed load is never cached. Mutations dispatch `nodus:data-changed` with the
 * cache scope they affect, so an unrelated note or preference write does not
 * clear every open embed.
 */

export interface ViewDataLoaders {
  databases: () => Promise<UiDatabase[]>;
  views: (databaseId: string) => Promise<UiDatabaseViewsResponse>;
  rows: (databaseId: string) => Promise<UiDatabaseRowsResponse>;
}

export interface ViewDataServiceOptions {
  ttlMs?: number;
  now?: () => number;
  /** Upper bound on cached resources; the oldest entry is evicted first. */
  maxEntries?: number;
}

type ResourceKind = 'databases' | 'views' | 'rows';

interface CacheEntry {
  kind: ResourceKind;
  databaseId: string | null;
  promise: Promise<unknown>;
  expiresAt: number;
}

type Listener = (databaseId: string | null) => void;

export interface ViewDataService {
  setVaultIdentity(next: string): void;
  getVaultIdentity(): string;
  databases(): Promise<UiDatabase[]>;
  views(databaseId: string): Promise<UiDatabaseViewsResponse>;
  rows(databaseId: string): Promise<UiDatabaseRowsResponse>;
  invalidate(scope: ViewDataInvalidation): void;
  invalidateDatabase(databaseId: string): void;
  invalidateAll(): void;
  pruneExpired(): number;
  subscribe(listener: Listener): () => void;
  readonly cacheSize: number;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 32;

export function createViewDataService(loaders: ViewDataLoaders, options: ViewDataServiceOptions = {}): ViewDataService {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const cache = new Map<string, CacheEntry>();
  const listeners = new Set<Listener>();
  const pendingNotifications = new Set<string | null>();
  let notificationScheduled = false;
  let vaultIdentity = '';
  // Bumped on every invalidation so an older in-flight response cannot
  // repopulate the cache after newer data was requested.
  let generation = 0;

  function notify(databaseId: string | null): void {
    for (const listener of listeners) listener(databaseId);
  }

  /**
   * Coalesce notifications raised in the same task: several row writes for one
   * database reload its embeds once, not once per write.
   */
  function scheduleNotify(databaseId: string | null): void {
    if (pendingNotifications.has(null)) return;
    if (databaseId === null) pendingNotifications.clear();
    pendingNotifications.add(databaseId);
    if (notificationScheduled) return;
    notificationScheduled = true;
    queueMicrotask(() => {
      notificationScheduled = false;
      const pending = [...pendingNotifications];
      pendingNotifications.clear();
      for (const id of pending) notify(id);
    });
  }

  function setVaultIdentity(next: string): void {
    if (next === vaultIdentity) return;
    vaultIdentity = next;
    generation += 1;
    cache.clear();
  }

  function scope(kind: string, id: string): string {
    return `${vaultIdentity}\u0000${kind}\u0000${id}`;
  }

  function pruneExpired(): number {
    const at = now();
    let removed = 0;
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= at) {
        cache.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  function evictOverflow(): void {
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next();
      if (oldest.done === true) return;
      cache.delete(oldest.value);
    }
  }

  function read<T>(kind: ResourceKind, databaseId: string | null, key: string, load: () => Promise<T>): Promise<T> {
    if (cache.size > 0) pruneExpired();
    const current = cache.get(key);
    if (current !== undefined) return current.promise as Promise<T>;
    const startGeneration = generation;
    const promise = load().catch((reason: unknown) => {
      const entry = cache.get(key);
      if (entry?.promise === promise) cache.delete(key);
      throw reason;
    });
    if (startGeneration === generation) {
      cache.set(key, { kind, databaseId, promise, expiresAt: now() + ttlMs });
      evictOverflow();
    }
    return promise;
  }

  function deleteWhere(predicate: (entry: CacheEntry) => boolean): void {
    for (const [key, entry] of cache) if (predicate(entry)) cache.delete(key);
  }

  function invalidate(scopeValue: ViewDataInvalidation): void {
    switch (scopeValue.kind) {
      case 'none':
        return;
      case 'all':
        generation += 1;
        cache.clear();
        scheduleNotify(null);
        return;
      case 'databases':
        // The database list is shared by every embed; a rename or new database
        // can change the header and membership, so the list is reloaded.
        deleteWhere((entry) => entry.kind === 'databases');
        generation += 1;
        scheduleNotify(null);
        return;
      case 'database':
        deleteWhere((entry) => entry.databaseId === scopeValue.databaseId);
        deleteWhere((entry) => entry.kind === 'databases');
        generation += 1;
        scheduleNotify(scopeValue.databaseId);
        return;
      case 'views':
        deleteWhere((entry) => entry.kind === 'views' && entry.databaseId === scopeValue.databaseId);
        generation += 1;
        scheduleNotify(scopeValue.databaseId);
        return;
      case 'rows':
        deleteWhere((entry) => entry.kind === 'rows' && (scopeValue.databaseId === undefined || entry.databaseId === scopeValue.databaseId));
        generation += 1;
        scheduleNotify(scopeValue.databaseId ?? null);
        return;
      default:
        return;
    }
  }

  function invalidateDatabase(databaseId: string): void {
    invalidate({ kind: 'database', databaseId });
  }

  function invalidateAll(): void {
    invalidate({ kind: 'all' });
  }

  return {
    setVaultIdentity,
    getVaultIdentity: () => vaultIdentity,
    databases: (): Promise<UiDatabase[]> => read('databases', null, scope('databases', 'all'), loaders.databases),
    views: (databaseId: string): Promise<UiDatabaseViewsResponse> => read('views', databaseId, scope('views', databaseId), () => loaders.views(databaseId)),
    rows: (databaseId: string): Promise<UiDatabaseRowsResponse> => read('rows', databaseId, scope('rows', databaseId), () => loaders.rows(databaseId)),
    invalidate,
    invalidateDatabase,
    invalidateAll,
    pruneExpired,
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    get cacheSize(): number {
      pruneExpired();
      return cache.size;
    },
  };
}

export const viewDataService = createViewDataService({
  databases: () => api.databases().then((result) => result.databases),
  views: (databaseId) => api.databaseViews(databaseId),
  rows: (databaseId) => api.databaseRows(databaseId),
});

if (typeof window !== 'undefined') {
  window.addEventListener('nodus:data-changed', (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    // Events without a recognised scope (for example a manual dispatch or an
    // older bundle) stay conservative and clear everything.
    viewDataService.invalidate(isViewDataInvalidation(detail) ? detail : { kind: 'all' });
  });
}
