import type { Note } from '../domain/note.js';
import { isUuidV4 } from '../domain/ids.js';

export interface WikiLink {
  raw: string;
  target: string;
  display?: string;
  start: number;
  end: number;
}

export type LinkableNote = Pick<Note, 'id' | 'title' | 'aliases'>;

export type LinkResolution =
  | { status: 'resolved'; noteId: string }
  | { status: 'unresolved' }
  | { status: 'ambiguous'; noteIds: string[] };

const WIKI_LINK = /\[\[([^\[\]|\r\n]+)(?:\|([^\[\]\r\n]*))?\]\]/g;
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
  const trimmed = target.trim();

  if (isUuidV4(trimmed)) {
    const match = notes.find((note) => note.id === trimmed);
    return match ? { status: 'resolved', noteId: match.id } : { status: 'unresolved' };
  }

  const key = normalizeKey(trimmed);
  const matches = new Set<string>();
  for (const note of notes) {
    if (normalizeKey(note.title) === key || note.aliases.some((alias) => normalizeKey(alias) === key)) {
      matches.add(note.id);
    }
  }

  const [first, ...rest] = [...matches];
  if (first === undefined) return { status: 'unresolved' };
  if (rest.length === 0) return { status: 'resolved', noteId: first };
  return { status: 'ambiguous', noteIds: [first, ...rest] };
}

function normalizeKey(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
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
