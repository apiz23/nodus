import type { Note } from '../domain/note.js';
import { readPageIcon } from '../ui-server/page-icon.js';

export type SearchField = 'title' | 'alias' | 'path' | 'content';
export interface SearchMatch { field: SearchField; text: string; start: number; end: number }
export interface SearchResult {
  id: string; title: string; path: string; updatedAt: string; aliases: string[]; icon: string | null;
  snippet: string;
  match: SearchMatch;
}
interface SearchText { text: string; folded: string; offsets?: number[] }
interface SearchDocument {
  note: Pick<SearchResult, 'id' | 'title' | 'path' | 'updatedAt' | 'aliases' | 'icon'>;
  title: SearchText; aliases: SearchText[]; path: SearchText; content: SearchText;
}
export interface SearchIndex { documents: SearchDocument[] }

export function normalizeSearch(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}
function searchable(value: string): SearchText {
  const text = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  const folded = text.toLowerCase();
  // Lowercasing can expand a Unicode character (e.g. İ). Keep display offsets correct.
  if (folded.length === text.length) return { text, folded };
  const offsets: number[] = [];
  let position = 0;
  for (const character of text) {
    for (let i = 0; i < character.toLowerCase().length; i++) offsets.push(position);
    position += character.length;
  }
  offsets.push(text.length);
  return { text, folded, offsets };
}

/** Pre-normalized searchable fields, rebuilt only from authoritative parsed Markdown notes. */
export function buildSearchIndex(notes: readonly Note[]): SearchIndex {
  return { documents: notes.map((note) => ({
    note: { id: note.id, title: note.title, path: note.path, updatedAt: note.updatedAt,
      aliases: [...note.aliases], icon: readPageIcon(note.extraFrontmatter) },
    title: searchable(note.title), aliases: note.aliases.map(searchable),
    path: searchable(note.path), content: searchable(note.body),
  })) };
}

function matchIn(value: SearchText, query: string, field: SearchField): SearchMatch | undefined {
  const start = value.folded.indexOf(query);
  if (start < 0) return undefined;
  const end = start + query.length;
  const displayStart = value.offsets?.[start] ?? start;
  const last = value.offsets?.[end - 1];
  const displayEnd = last === undefined ? end : last + (value.text.codePointAt(last)! > 0xffff ? 2 : 1);
  return { field, text: value.text, start: displayStart, end: displayEnd };
}

function context(match: SearchMatch): SearchMatch {
  let start = Math.max(0, match.start - 45);
  let end = Math.min(match.text.length, Math.max(match.end, match.start + 1) + 90);
  // Excerpts use UTF-16 offsets, but must not split an emoji/supplementary character.
  const splitsCharacter = (offset: number) => {
    const code = match.text.charCodeAt(offset);
    const previous = match.text.charCodeAt(offset - 1);
    return code >= 0xdc00 && code <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff;
  };
  if (splitsCharacter(start)) start--;
  if (splitsCharacter(end)) end++;
  const prefix = start > 0 ? '…' : '';
  return { ...match, text: `${prefix}${match.text.slice(start, end)}${end < match.text.length ? '…' : ''}`,
    start: prefix.length + match.start - start, end: prefix.length + match.end - start };
}

/** Exact title → exact alias → partial alias → title prefix/partial → path → content. */
export function searchIndex(index: SearchIndex, rawQuery: string, limit = 50): SearchResult[] {
  const query = normalizeSearch(rawQuery);
  if (!query) return [];
  const ranked: { rank: number; result: SearchResult }[] = [];
  for (const doc of index.documents) {
    let rank: number;
    let match: SearchMatch | undefined;
    const alias = doc.aliases.find((alias) => alias.folded === query)
      ?? doc.aliases.find((alias) => alias.folded.includes(query));
    if (doc.title.folded === query) { rank = 0; match = matchIn(doc.title, query, 'title'); }
    else if (alias) { rank = alias.folded === query ? 1 : 2; match = matchIn(alias, query, 'alias'); }
    else if (doc.title.folded.includes(query)) { rank = doc.title.folded.startsWith(query) ? 3 : 4; match = matchIn(doc.title, query, 'title'); }
    else if (doc.path.folded.includes(query)) { rank = 5; match = matchIn(doc.path, query, 'path'); }
    else { rank = 6; match = matchIn(doc.content, query, 'content'); }
    if (!match) continue;
    const excerpt = context(match);
    const label = { title: 'Title', alias: 'Alias', path: 'Path', content: 'Content' }[match.field];
    ranked.push({ rank, result: { ...doc.note, aliases: [...doc.note.aliases],
      snippet: match.field === 'content' ? excerpt.text : `${label}: ${excerpt.text}`, match: excerpt } });
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.result.title.localeCompare(b.result.title)
    || a.result.path.localeCompare(b.result.path) || a.result.id.localeCompare(b.result.id))
    .slice(0, limit).map(({ result }) => result);
}
