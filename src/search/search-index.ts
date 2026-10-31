import type { Note } from '../domain/note.js';
import { readPageIcon } from '../ui-server/page-icon.js';
import { canonicalizePropertyValue, projectPropertyValues, propertyOptionLabels, type NotePropertyValue, type PropertyCatalog } from '../properties/catalog.js';
import { matchesNoteFilters, type NoteFilter, type NoteFilterLogic } from './note-filters.js';

export type SearchField = 'title' | 'alias' | 'path' | 'content' | 'tag' | 'property' | 'filter';
export interface SearchMatch { field: SearchField; text: string; start: number; end: number; propertyId?: string; propertyName?: string }
export interface SearchMetadataIssue { noteId: string; key: string; propertyId: string; message: string }
export interface SearchResult {
  id: string; title: string; path: string; updatedAt: string; aliases: string[]; icon: string | null;
  snippet: string;
  match: SearchMatch;
}
interface SearchText { text: string; folded: string; offsets?: number[] }
interface IndexedProperty { id: string; name: string; type: string; value?: NotePropertyValue; invalid: boolean }
interface SearchDocument {
  note: Pick<SearchResult, 'id' | 'title' | 'path' | 'updatedAt' | 'aliases' | 'icon'>;
  title: SearchText; aliases: SearchText[]; path: SearchText; content: SearchText;
  tags: SearchText[];
  tagsRaw: string[];
  properties: Array<{ id: string; name: SearchText; nameDisplay: string; value: SearchText; canonicalValues: SearchText[]; valueRaw: NotePropertyValue; invalid: boolean }>;
  filterProperties: Record<string, NotePropertyValue>;
  invalidPropertyIds: Set<string>;
}
export interface SearchIndex { documents: SearchDocument[]; metadataIssues: SearchMetadataIssue[]; catalogIssue?: string; properties: PropertyCatalog['properties'] }

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
export function buildSearchIndex(notes: readonly Note[], catalog: PropertyCatalog = { properties: [] }, catalogIssue?: string): SearchIndex {
  const metadataIssues: SearchMetadataIssue[] = [];
  const propertyById = new Map(catalog.properties.map((property) => [property.id, property] as const));
  const documents = notes.map((note) => {
    const projection = projectPropertyValues(catalog, note.extraFrontmatter);
    for (const issue of projection.issues) metadataIssues.push({ noteId: note.id, key: issue.key, propertyId: issue.propertyId, message: issue.message });
    const invalidPropertyIds = new Set(projection.issues.map((issue) => issue.propertyId));
    const properties = catalog.properties.flatMap((property) => {
      const hasValue = Object.hasOwn(projection.values, property.id);
      const value = projection.values[property.id];
      if (!hasValue && !invalidPropertyIds.has(property.id)) return [];
      const valueDisplay = hasValue ? displayPropertyValue(value!) : '';
      return [{ id: property.id, name: searchable(property.name), nameDisplay: property.name, value: searchable(valueDisplay),
        canonicalValues: hasValue ? canonicalSearchValues(property, value!) : [],
        valueRaw: value!, invalid: invalidPropertyIds.has(property.id) }];
    });
    return {
    note: { id: note.id, title: note.title, path: note.path, updatedAt: note.updatedAt,
      aliases: [...note.aliases], icon: readPageIcon(note.extraFrontmatter) },
    title: searchable(note.title), aliases: note.aliases.map(searchable),
    path: searchable(note.path), content: searchable(note.body),
    tags: note.tags.map(searchable), tagsRaw: [...note.tags], properties,
    filterProperties: Object.fromEntries(Object.entries(projection.values).map(([propertyId, value]) => {
      const property = propertyById.get(propertyId);
      return [propertyId, property === undefined ? value : canonicalizePropertyValue(property, value)];
    })),
    invalidPropertyIds,
  };
  });
  return { documents, metadataIssues, ...(catalogIssue === undefined ? {} : { catalogIssue }), properties: catalog.properties };
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

/** Preserve prior title/path/content ordering, then consider tags and registered properties. */
export function searchIndex(index: SearchIndex, rawQuery: string, limit = 50, filters: readonly NoteFilter[] = [], logic: NoteFilterLogic = 'and'): SearchResult[] {
  const query = normalizeSearch(rawQuery);
  if (!query && filters.length === 0) return [];
  const ranked: { rank: number; result: SearchResult }[] = [];
  for (const doc of index.documents) {
    if (!matchesNoteFilters({ tags: doc.tagsRaw, values: doc.filterProperties, invalidPropertyIds: doc.invalidPropertyIds }, filters, logic)) continue;
    if (!query) {
      ranked.push({ rank: 10, result: { ...doc.note, aliases: [...doc.note.aliases], snippet: 'Matches active filters', match: { field: 'filter', text: 'Matches active filters', start: 0, end: 0 } } });
      continue;
    }
    let rank = 8;
    let match: SearchMatch | undefined;
    const alias = doc.aliases.find((alias) => alias.folded === query)
      ?? doc.aliases.find((alias) => alias.folded.includes(query));
    if (doc.title.folded === query) { rank = 0; match = matchIn(doc.title, query, 'title'); }
    else if (alias) { rank = alias.folded === query ? 1 : 2; match = matchIn(alias, query, 'alias'); }
    else if (doc.title.folded.includes(query)) { rank = doc.title.folded.startsWith(query) ? 3 : 4; match = matchIn(doc.title, query, 'title'); }
    else if (doc.path.folded.includes(query)) { rank = 5; match = matchIn(doc.path, query, 'path'); }
    else if (doc.content.folded.includes(query)) { rank = 6; match = matchIn(doc.content, query, 'content'); }
    else {
      const tagMatch = doc.tags.find((tag) => tag.folded.includes(query));
      if (tagMatch) { rank = 7; match = matchIn(tagMatch, query, 'tag'); }
      else {
        const propertyMatch = findPropertyMatch(doc.properties, query);
        if (propertyMatch) { rank = 8; match = propertyMatch; }
      }
    }
    if (!match) continue;
    const excerpt = context(match);
    const label = { title: 'Title', alias: 'Alias', path: 'Path', content: 'Content', tag: 'Tag', property: 'Property', filter: 'Filter' }[match.field];
    ranked.push({ rank, result: { ...doc.note, aliases: [...doc.note.aliases],
      snippet: match.field === 'content' ? excerpt.text : `${label}: ${excerpt.text}`, match: excerpt } });
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.result.title.localeCompare(b.result.title)
    || a.result.path.localeCompare(b.result.path) || a.result.id.localeCompare(b.result.id))
    .slice(0, limit).map(({ result }) => result);
}

function findPropertyMatch(properties: SearchDocument['properties'], query: string): SearchMatch | undefined {
  for (const property of properties) {
    if (property.invalid) continue;
    const nameMatch = matchIn(property.name, query, 'property');
    if (nameMatch) {
      const text = `${property.nameDisplay}: ${property.value.text}`;
      return { field: 'property', propertyId: property.id, propertyName: property.nameDisplay, text,
        start: nameMatch.start, end: nameMatch.end };
    }
    const valueMatch = matchIn(property.value, query, 'property');
    if (valueMatch) {
      const prefix = `${property.nameDisplay}: `;
      return { field: 'property', propertyId: property.id, propertyName: property.nameDisplay,
        text: `${prefix}${property.value.text}`, start: prefix.length + valueMatch.start, end: prefix.length + valueMatch.end };
    }
    for (const canonical of property.canonicalValues) {
      const canonicalMatch = matchIn(canonical, query, 'property');
      if (canonicalMatch) {
        const prefix = `${property.nameDisplay}: `;
        return { field: 'property', propertyId: property.id, propertyName: property.nameDisplay,
          text: `${prefix}${canonical.text}`, start: prefix.length + canonicalMatch.start, end: prefix.length + canonicalMatch.end };
      }
    }
  }
  return undefined;
}

/** Only the current/retained labels of options the note's own value resolves to. */
function canonicalSearchValues(
  property: PropertyCatalog['properties'][number],
  value: NotePropertyValue,
): SearchText[] {
  if (property.type !== 'select' && property.type !== 'multi-select') return [];
  const rawValues = Array.isArray(value) ? value : [value];
  const rawFolded = new Set(rawValues
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.normalize('NFC').toLowerCase()));
  return propertyOptionLabels(property, value)
    .filter((item) => !rawFolded.has(item.normalize('NFC').toLowerCase()))
    .map(searchable);
}

function displayPropertyValue(value: NotePropertyValue): string {
  return Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? String(value) : String(value);
}
