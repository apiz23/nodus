import type { Note } from '../domain/note.js';
import { isUuidV4 } from '../domain/ids.js';

export interface WikiLink {
  raw: string;
  target: string;
  display?: string;
  start: number;
  end: number;
}

export type LinkableNote = Pick<Note, 'id' | 'title' | 'aliases'> & { path?: string };

export type LinkResolution =
  | { status: 'resolved'; noteId: string }
  | { status: 'unresolved' }
  | { status: 'ambiguous'; noteIds: string[] };

const WIKI_LINK = /\[\[([^\[\]|\r\n]+)(?:\|([^\[\]\r\n]*))?\]\]/g;

/** A wiki-link target must be non-empty, trimmed, and a single line. */
export function isValidLinkTarget(target: string): boolean {
  return target !== '' && target.trim() === target && !/[\[\]|\r\n]/.test(target);
}
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/;

export function parseWikiLinks(body: string): WikiLink[] {
  const masked = maskCode(body);
  const links: WikiLink[] = [];

  for (const match of masked.matchAll(WIKI_LINK)) {
    const start = match.index ?? 0;
    const raw = body.slice(start, start + match[0].length);
    const target = (match[1] ?? '').trim();
    if (target === '') continue;

    const display = match[2];
    links.push({
      raw,
      target,
      ...(display === undefined ? {} : { display }),
      start,
      end: start + raw.length,
    });
  }
  return links;
}

export function resolveLink(target: string, notes: readonly LinkableNote[]): LinkResolution {
  return createLinkResolver(notes)(target);
}

/** Precompute title/alias/path candidates once for a whole vault snapshot. */
export function createLinkResolver(notes: readonly LinkableNote[]): (target: string) => LinkResolution {
  const ids = new Set(notes.map((note) => note.id));
  const keys = new Map<string, Set<string>>();
  const paths = new Map<string, Set<string>>();
  for (const note of notes) {
    for (const value of [note.title, ...note.aliases]) {
      const key = normalizeKey(value);
      if (!keys.has(key)) keys.set(key, new Set());
      keys.get(key)!.add(note.id);
    }
    if (note.path !== undefined && note.path.trim() !== '') {
      const key = normalizePathKey(note.path);
      if (!paths.has(key)) paths.set(key, new Set());
      paths.get(key)!.add(note.id);
    }
  }
  return (target) => {
    const trimmed = target.trim();
    if (isUuidV4(trimmed)) return ids.has(trimmed) ? { status: 'resolved', noteId: trimmed } : { status: 'unresolved' };
    const matches = [...(keys.get(normalizeKey(trimmed)) ?? [])];
    const first = matches[0];
    if (first !== undefined) return matches.length === 1 ? { status: 'resolved', noteId: first } : { status: 'ambiguous', noteIds: matches };
    // Path resolution is a fallback after title/alias/ID. It accepts the
    // workspace-relative path with or without a trailing .md, and is unique
    // per vault because duplicate note paths are rejected by storage.
    const pathMatches = [...(paths.get(normalizePathKey(trimmed)) ?? [])];
    if (pathMatches.length === 0) return { status: 'unresolved' };
    const pathFirst = pathMatches[0];
    if (pathFirst === undefined) return { status: 'unresolved' };
    return pathMatches.length === 1
      ? { status: 'resolved', noteId: pathFirst }
      : { status: 'ambiguous', noteIds: pathMatches };
  };
}

function normalizeKey(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

/** Normalize a workspace-relative note path for wiki-link path matching. */
function normalizePathKey(value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\.md$/i, '')
    .toLowerCase();
}

/** External schemes are not internal note targets even when written in wiki syntax. */
export function isExternalTarget(target: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target.trim());
}

function maskCode(body: string): string {
  let fence: string | null = null;
  return body
    .split('\n')
    .map((line) => {
      if (fence !== null) {
        const close = FENCE_CLOSE.exec(line);
        if (close?.[1] && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
        return blank(line);
      }
      const open = FENCE_OPEN.exec(line);
      if (open?.[1]) {
        fence = open[1];
        return blank(line);
      }
      return line.replace(/(`+)[\s\S]*?\1/g, (code) => blank(code));
    })
    .join('\n');
}

function blank(text: string): string {
  return text.replace(/[^\r]/g, ' ');
}
