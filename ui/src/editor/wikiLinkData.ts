import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import {
  parseWikiLinks,
  resolveLink,
  type LinkableNote,
  type LinkResolution,
} from '../../../src/links/wikilink.js';

export interface WikiLinkInfo {
  from: number;
  to: number;
  target: string;
  display: string;
  status: LinkResolution['status'];
  noteId?: string;
  candidateIds?: string[];
}

function toInfo(
  from: number,
  to: number,
  target: string,
  display: string | undefined,
  notes: readonly LinkableNote[],
): WikiLinkInfo {
  const resolution = resolveLink(target, notes);
  const base = {
    from,
    to,
    target,
    display: display ?? target,
  };
  if (resolution.status === 'resolved') {
    return { ...base, status: 'resolved' as const, noteId: resolution.noteId };
  }
  if (resolution.status === 'ambiguous') {
    return { ...base, status: 'ambiguous' as const, candidateIds: resolution.noteIds };
  }
  return { ...base, status: 'unresolved' as const };
}

export function collectWikiLinks(
  state: EditorState,
  notes: readonly LinkableNote[],
): WikiLinkInfo[] {
  return parseWikiLinks(state.doc.toString()).map((link) =>
    toInfo(link.start, link.end, link.target, link.display, notes),
  );
}

function insideCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, 1);
  for (;;) {
    if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeText') {
      return true;
    }
    if (node.parent === null) return false;
    node = node.parent;
  }
}

/**
 * Collect links only from the visible line ranges. Code is excluded through
 * the syntax tree, and the range is expanded to whole lines so a link cannot
 * be cut at a viewport edge.
 */
export function collectWikiLinksInRanges(
  state: EditorState,
  notes: readonly LinkableNote[],
  ranges: readonly { from: number; to: number }[],
): WikiLinkInfo[] {
  const links: WikiLinkInfo[] = [];
  const seen = new Set<string>();

  for (const range of ranges) {
    const from = state.doc.lineAt(range.from).from;
    const to = state.doc.lineAt(Math.max(range.from, range.to)).to;
    if (to <= from) continue;
    const slice = state.doc.sliceString(from, to);
    for (const link of parseWikiLinks(slice)) {
      const absoluteFrom = from + link.start;
      const absoluteTo = from + link.end;
      if (insideCode(state, absoluteFrom) || insideCode(state, Math.max(absoluteFrom, absoluteTo - 1))) {
        continue;
      }
      const key = `${absoluteFrom}:${absoluteTo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(
        toInfo(absoluteFrom, absoluteTo, link.target, link.display, notes),
      );
    }
  }

  return links;
}

export function wikiLinkLabel(
  link: WikiLinkInfo,
  notes: readonly LinkableNote[],
): string {
  if (link.status === 'resolved') return `Open ${link.display}`;
  if (link.status === 'unresolved') return `Unresolved link: ${link.display}`;
  const candidates = (link.candidateIds ?? [])
    .map((id) => notes.find((note) => note.id === id)?.title ?? id)
    .join(', ');
  return `Ambiguous link: ${link.display}. Candidates: ${candidates}`;
}
