import { api } from '@/api';
import type { UiDatabase, UiDatabaseRowsResponse, UiDatabaseViewsResponse } from '../../../src/ui-server/dto';

/**
 * Shared data layer for embedded database views.
 *
 * One entry per (vault, database, resource). Concurrent callers share the
 * in-flight promise, successful values are cached for a short window, and a
 * failed load is never cached. Mutations dispatch `nodus:data-changed`, which
 * clears the cache and notifies open embeds so they reload instead of showing
 * permanently stale rows.
 */

export interface ViewDataLoaders {
  databases: () => Promise<UiDatabase[]>;
  views: (databaseId: string) => Promise<UiDatabaseViewsResponse>;
  rows: (databaseId: string) => Promise<UiDatabaseRowsResponse>;
}

export interface ViewDataServiceOptions {
  ttlMs?: number;
  now?: () => number;
}

interface CacheEntry<T> {
  promise: Promise<T>;
  expiresAt: number;
}

type Listener = (databaseId: string | null) => void;

export interface ViewDataService {
  setVaultIdentity(next: string): void;
  getVaultIdentity(): string;
  databases(): Promise<UiDatabase[]>;
  views(databaseId: string): Promise<UiDatabaseViewsResponse>;
  rows(databaseId: string): Promise<UiDatabaseRowsResponse>;
  invalidateDatabase(databaseId: string): void;
  invalidateAll(): void;
  subscribe(listener: Listener): () => void;
  readonly cacheSize: number;
}

const DEFAULT_TTL_MS = 30_000;

export function createViewDataService(loaders: ViewDataLoaders, options: ViewDataServiceOptions = {}): ViewDataService {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const cache = new Map<string, CacheEntry<unknown>>();
  const listeners = new Set<Listener>();
  let vaultIdentity = '';
  // Bumped on every invalidation so an older in-flight response cannot
  // repopulate the cache after newer data was requested.
  let generation = 0;

  function setVaultIdentity(next: string): void {
    if (next === vaultIdentity) return;
    vaultIdentity = next;
    generation += 1;
    cache.clear();
  }

  function scope(kind: string, id: string): string {
    return `${vaultIdentity}\u0000${kind}\u0000${id}`;
  }

  function read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const current = cache.get(key) as CacheEntry<T> | undefined;
    if (current !== undefined && current.expiresAt > now()) return current.promise;
    const startGeneration = generation;
    const promise = load().catch((reason: unknown) => {
      const entry = cache.get(key) as CacheEntry<T> | undefined;
      if (entry?.promise === promise) cache.delete(key);
      throw reason;
    });
    if (startGeneration === generation) cache.set(key, { promise, expiresAt: now() + ttlMs });
    return promise;
  }

  function notify(databaseId: string | null): void {
    for (const listener of listeners) listener(databaseId);
  }

  function invalidateDatabase(databaseId: string): void {
    const marker = `\u0000${databaseId}`;
    for (const key of [...cache.keys()]) if (key.includes(marker)) cache.delete(key);
    generation += 1;
    notify(databaseId);
  }

  function invalidateAll(): void {
    generation += 1;
    cache.clear();
    notify(null);
  }

  return {
    setVaultIdentity,
    getVaultIdentity: () => vaultIdentity,
    databases: (): Promise<UiDatabase[]> => read(scope('databases', 'all'), loaders.databases),
    views: (databaseId: string): Promise<UiDatabaseViewsResponse> => read(scope('views', databaseId), () => loaders.views(databaseId)),
    rows: (databaseId: string): Promise<UiDatabaseRowsResponse> => read(scope('rows', databaseId), () => loaders.rows(databaseId)),
    invalidateDatabase,
    invalidateAll,
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    get cacheSize(): number { return cache.size; },
  };
}

export const viewDataService = createViewDataService({
  databases: () => api.databases().then((result) => result.databases),
  views: (databaseId) => api.databaseViews(databaseId),
  rows: (databaseId) => api.databaseRows(databaseId),
});

if (typeof window !== 'undefined') {
  window.addEventListener('nodus:data-changed', () => viewDataService.invalidateAll());
}
