import type { Note } from '../domain/note.js';
import { parseWikiLinks, resolveLink } from './wikilink.js';

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
 * next lookup. A full rebuild is O(N bodies + total links × N notes); see
 * the Phase 3A plan for the incremental-update follow-up path.
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
  const byTarget = new Map<string, MutableEntry[]>();
  if (notes.length === 0) return byTarget;

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

  for (const source of notes) {
    // parseWikiLinks returns source offsets into the body; code spans and
    // fenced blocks are already excluded by its masking.
    for (const link of parseWikiLinks(source.body)) {
      const resolution = resolveLink(link.target, notes);
      if (resolution.status === 'unresolved') continue;

      const targetIds =
        resolution.status === 'resolved' ? [resolution.noteId] : [...resolution.noteIds];
      const snippet = snippetAround(source.body, link.start, link.end);
      for (const targetId of targetIds) {
        if (targetId === source.id) continue; // a note does not backlink itself
        add(targetId, source.id, source.title, snippet, resolution.status === 'ambiguous');
      }
    }
  }

  return byTarget;
}

const SNIPPET_CONTEXT = 45;

/** Whitespace-compacted context around the first link occurrence. */
export function snippetAround(body: string, linkStart: number, linkEnd: number): string {
  const compact = body.replace(/\s+/g, ' ');
  // Map the link's original offset to its offset in the compacted string.
  let anchor = 0;
  let compactIndex = 0;
  let previousWasWhitespace = false;
  for (let index = 0; index < body.length && index <= linkStart; index += 1) {
    const isWhitespace = /\s/.test(body[index] ?? '');
    if (index === linkStart) {
      anchor = compactIndex;
      break;
    }
    if (isWhitespace) {
      if (!previousWasWhitespace) compactIndex += 1;
    } else {
      compactIndex += 1;
    }
    previousWasWhitespace = isWhitespace;
  }
  const anchorEnd = anchor + (linkEnd - linkStart);
  const start = Math.max(0, anchor - SNIPPET_CONTEXT);
  const end = Math.min(compact.length, anchorEnd + SNIPPET_CONTEXT);
  const slice = compact.slice(start, end);
  return `${start > 0 ? '…' : ''}${slice}${end < compact.length ? '…' : ''}`;
}
