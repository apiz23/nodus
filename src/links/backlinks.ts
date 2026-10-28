import type { Note } from '../domain/note.js';
import { buildLinkIndex, type LinkIndex } from './link-index.js';

export interface BacklinkSource {
  sourceId: string;
  sourceTitle: string;
  snippet: string;
  count: number;
  ambiguous: boolean;
}

/**
 * Rebuildable in-memory reverse index over wiki links.
 *
 * Keyed by resolved target note ID. Built from the authoritative parsed
 * notes; never a source of truth. Reuses `parseWikiLinks` (which masks
 * inline and fenced code) and `resolveLink` so backlink semantics match
 * the editor exactly.
 *
 * Invalidation model: mark dirty on any mutation and rebuild lazily on the
 * next lookup. A rebuild uses the shared link index with precomputed title/alias candidates.
 * The local API shares a bounded snapshot across discovery and backlink readers.
 */
export interface BacklinkIndex {
  /** Replaces the whole index from authoritative notes. */
  rebuild(notes: readonly Note[]): void;
  /** Marks the index stale; the next lookup rebuilds from fresh notes. */
  markDirty(): void;
  /** Returns backlinks for a target, rebuilding first when stale. */
  getBacklinks(targetId: string, notes: readonly Note[]): BacklinkSource[];
}

interface MutableEntry {
  sourceId: string;
  sourceTitle: string;
  snippet: string;
  count: number;
  ambiguous: boolean;
}

export function createBacklinkIndex(): BacklinkIndex {
  let byTarget = new Map<string, MutableEntry[]>();
  let dirty = true;

  const index = {
    rebuild(notes: readonly Note[]): void {
      byTarget = buildIndex(notes);
      dirty = false;
    },
    markDirty(): void {
      dirty = true;
    },
    getBacklinks(targetId: string, notes: readonly Note[]): BacklinkSource[] {
      if (dirty) {
        byTarget = buildIndex(notes);
        dirty = false;
      }
      const entries = byTarget.get(targetId);
      if (entries === undefined) return [];
      return entries.map((entry) => ({ ...entry }));
    },
  } satisfies BacklinkIndex;
  return index;
}

function buildIndex(notes: readonly Note[]): Map<string, MutableEntry[]> {
  return backlinksByTarget(buildLinkIndex(notes));
}

export function backlinksByTarget(index: LinkIndex): Map<string, BacklinkSource[]> {
  const byTarget = new Map<string, MutableEntry[]>();


  const add = (
    targetId: string,
    sourceId: string,
    sourceTitle: string,
    snippet: string,
    ambiguous: boolean,
  ): void => {
    const entries = byTarget.get(targetId);
    if (entries === undefined) {
      byTarget.set(targetId, [{ sourceId, sourceTitle, snippet, count: 1, ambiguous }]);
      return;
    }
    const existing = entries.find((entry) => entry.sourceId === sourceId);
    if (existing === undefined) {
      entries.push({ sourceId, sourceTitle, snippet, count: 1, ambiguous });
      return;
    }
    existing.count += 1;
    // An ambiguous mention must never be downgraded to a confirmed backlink
    // because another link in the same source resolved cleanly.
    existing.ambiguous = existing.ambiguous || ambiguous;
  };

  for (const link of index.links) {
    const resolution = link.resolution;
    if (resolution.status === 'unresolved') continue;
    const targetIds = resolution.status === 'resolved' ? [resolution.noteId] : resolution.noteIds;
    for (const targetId of targetIds) {
      if (targetId === link.sourceId) continue;
      add(targetId, link.sourceId, link.sourceTitle, link.snippet, resolution.status === 'ambiguous');
    }
  }

  return byTarget;
}

export { snippetAround } from './link-index.js';
