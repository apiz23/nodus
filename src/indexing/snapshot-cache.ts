import type { Note } from '../domain/note.js';

/** One shared, bounded snapshot per vault; concurrent readers share the same rebuild. */
export function createSnapshotCache<T>(load: () => Promise<Note[]>, build: (notes: Note[]) => T, ttlMs = 5000, now = Date.now) {
  let generation = 0;
  let cached: { generation: number; expires: number; index: T } | undefined;
  let pending: { generation: number; promise: Promise<T> } | undefined;
  return {
    markDirty() { generation++; },
    async get(refresh = false): Promise<T> {
      if (refresh) generation++;
      if (cached?.generation === generation && cached.expires > now()) return cached.index;
      if (pending?.generation === generation) return pending.promise;
      const revision = generation;
      const promise = load().then((notes) => {
        const index = build(notes);
        if (revision === generation) cached = { generation: revision, expires: now() + ttlMs, index };
        return index;
      });
      pending = { generation: revision, promise };
      try { return await promise; } finally { if (pending?.promise === promise) pending = undefined; }
    },
  };
}
