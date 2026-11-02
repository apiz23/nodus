import type { Note } from '../domain/note.js';
import { buildLinkIndex, type LinkIndex } from './link-index.js';
import type { LinkResolution } from './wikilink.js';

export interface BacklinkSource {
  sourceId: string;
  sourceTitle: string;
  snippet: string;
  count: number;
  ambiguous: boolean;
}

export interface OutgoingLink {
  raw: string;
  target: string;
  display?: string;
  start: number;
  end: number;
  line: number;
  snippet: string;
  resolution: LinkResolution;
  targetId?: string;
  targetTitle?: string;
  targetPath?: string;
  candidateIds?: string[];
  selfReference: boolean;
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

export function backlinksByTarget(index: LinkIndex): Map<string, BacklinkSource[]> {  const byTarget = new Map<string, MutableEntry[]>();


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

/** Outgoing occurrences for one note, with current target metadata where resolved. */
export function outgoingLinksForNote(index: LinkIndex, noteId: string): OutgoingLink[] {
  const byId = new Map(index.notes.map((note) => [note.id, note]));
  return index.links
    .filter((link) => link.sourceId === noteId)
    .sort((left, right) => left.start - right.start)
    .map((link): OutgoingLink => {
      const resolution = link.resolution;
      if (resolution.status === 'resolved') {
        const target = byId.get(resolution.noteId);
        return {
          raw: link.raw,
          target: link.target,
          ...(link.display === undefined ? {} : { display: link.display }),
          start: link.start,
          end: link.end,
          line: link.line,
          snippet: link.snippet,
          resolution,
          targetId: resolution.noteId,
          ...(target === undefined ? {} : { targetTitle: target.title, targetPath: target.path }),
          selfReference: resolution.noteId === noteId,
        };
      }
      if (resolution.status === 'ambiguous') {
        return {
          raw: link.raw,
          target: link.target,
          ...(link.display === undefined ? {} : { display: link.display }),
          start: link.start,
          end: link.end,
          line: link.line,
          snippet: link.snippet,
          resolution,
          candidateIds: [...resolution.noteIds],
          selfReference: resolution.noteIds.includes(noteId),
        };
      }
      return {
        raw: link.raw,
        target: link.target,
        ...(link.display === undefined ? {} : { display: link.display }),
        start: link.start,
        end: link.end,
        line: link.line,
        snippet: link.snippet,
        resolution,
        selfReference: false,
      };
    });
}

export { snippetAround } from './link-index.js';
