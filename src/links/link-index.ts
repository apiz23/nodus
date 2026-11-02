import { createSnapshotCache } from '../indexing/snapshot-cache.js';
import type { Note } from '../domain/note.js';
import { createLinkResolver, isExternalTarget, parseWikiLinks, type LinkResolution, type WikiLink } from './wikilink.js';

export interface IndexedNote { id: string; title: string; path: string; aliases: string[] }
export interface IndexedLink extends WikiLink {
  sourceId: string;
  sourceTitle: string;
  sourcePath: string;
  line: number;
  snippet: string;
  resolution: LinkResolution;
}
export interface LinkIndex {
  notes: IndexedNote[];
  links: IndexedLink[];
  /** Confirmed incoming links from other notes; self-links do not prevent orphan status. */
  orphanNotes: IndexedNote[];
  /** Notes with neither confirmed incoming nor confirmed outgoing internal links. Self-links do not count as connections. */
  isolatedNotes: IndexedNote[];
}

/** Markdown is authoritative. This snapshot can be discarded and rebuilt at any time. */
export function buildLinkIndex(notes: readonly Note[]): LinkIndex {
  const resolve = createLinkResolver(notes);
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  const links: IndexedLink[] = [];
  for (const note of notes) {
    let offset = 0;
    let line = 1;
    for (const link of parseWikiLinks(note.body)) {
      for (; offset < link.start; offset++) if (note.body[offset] === '\n') line++;
      // Wiki-link syntax is for internal notes. Absolute external URLs are not
      // relationship edges and must not create phantom unresolved targets.
      if (isExternalTarget(link.target)) continue;
      const resolution = resolve(link.target);
      if (resolution.status === 'resolved' && resolution.noteId !== note.id) {
        incoming.add(resolution.noteId);
        outgoing.add(note.id);
      }
      links.push({ ...link, sourceId: note.id, sourceTitle: note.title, sourcePath: note.path, line,
        snippet: snippetAround(note.body, link.start, link.end), resolution });
    }
  }
  const summaries = notes.map(({ id, title, path, aliases }) => ({ id, title, path, aliases: [...aliases] }));
  return {
    notes: summaries,
    links,
    orphanNotes: summaries.filter((note) => !incoming.has(note.id)),
    isolatedNotes: summaries.filter((note) => !incoming.has(note.id) && !outgoing.has(note.id)),
  };
}

export function snippetAround(body: string, start: number, end: number): string {
  const from = Math.max(0, start - 65);
  const to = Math.min(body.length, end + 65);
  return `${from > 0 ? '…' : ''}${body.slice(from, to).replace(/\s+/g, ' ')}${to < body.length ? '…' : ''}`;
}

/** Compatibility entry point backed by the shared derived-snapshot cache. */
export function createLinkIndexCache(load: () => Promise<Note[]>, ttlMs = 5000, now = Date.now) {
  return createSnapshotCache(load, buildLinkIndex, ttlMs, now);
}
