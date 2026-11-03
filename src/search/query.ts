/** Small, deterministic search grammar shared by API and search execution.
 * Examples: planning tag:research folder:Projects before:2026-01-01 title:"weekly review"
 */
export type SearchOperator = 'tag' | 'folder' | 'type' | 'before' | 'after' | 'created-before' | 'created-after' | 'modified-before' | 'modified-after' | 'title' | 'alias' | 'path';
export interface SearchConstraint { operator: SearchOperator; value: string; start: number; end: number }
export interface ParsedSearchQuery { raw: string; text: string[]; constraints: SearchConstraint[] }

const OPERATORS = new Set<SearchOperator>(['tag', 'folder', 'type', 'before', 'after', 'created-before', 'created-after', 'modified-before', 'modified-after', 'title', 'alias', 'path']);

export class SearchSyntaxError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) { super(message); this.name = 'SearchSyntaxError'; this.offset = offset; }
}

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  if (raw.length > 500) throw new SearchSyntaxError('Search query must be 500 characters or fewer.', 500);
  const text: string[] = [];
  const constraints: SearchConstraint[] = [];
  let freeText = '';
  const flushFreeText = () => { if (freeText.trim()) text.push(freeText.trim()); freeText = ''; };
  let cursor = 0;
  while (cursor < raw.length) {
    while (/\s/.test(raw[cursor] ?? '')) cursor++;
    if (cursor >= raw.length) break;
    const start = cursor;
    let operator: SearchOperator | undefined;
    const prefix = /^([a-z][a-z-]*):/i.exec(raw.slice(cursor));
    if (prefix) {
      const candidate = prefix[1]!.toLowerCase();
      if (OPERATORS.has(candidate as SearchOperator)) {
        operator = candidate as SearchOperator;
        cursor += prefix[0].length;
      }
    }
    if (operator || raw[cursor] === '"') flushFreeText();
    const quoted = raw[cursor] === '"';
    let value = '';
    if (raw[cursor] === '"') {
      cursor++;
      let closed = false;
      while (cursor < raw.length) {
        const char = raw[cursor]!;
        if (char === '\\' && (raw[cursor + 1] === '"' || raw[cursor + 1] === '\\')) { value += raw[cursor + 1]; cursor += 2; continue; }
        if (char === '"') { cursor++; closed = true; break; }
        value += char; cursor++;
      }
      if (!closed) throw new SearchSyntaxError('Unclosed quoted phrase.', start);
      if (cursor < raw.length && !/\s/.test(raw[cursor]!)) throw new SearchSyntaxError('Add a space after a quoted phrase.', cursor);
    } else {
      const valueStart = cursor;
      while (cursor < raw.length && !/\s/.test(raw[cursor]!)) cursor++;
      value = raw.slice(valueStart, cursor);
      if (!operator && prefix && !['http', 'https'].includes(prefix[1]!.toLowerCase())) {
        throw new SearchSyntaxError(`Unknown search operator "${prefix[1]}:".`, start);
      }
    }
    value = value.normalize('NFC').trim();
    if (!value) throw new SearchSyntaxError(operator ? `${operator}: requires a value.` : 'Quoted phrases cannot be empty.', start);
    if (operator) {
      if (['before', 'after', 'created-before', 'created-after', 'modified-before', 'modified-after'].includes(operator) && !validDate(value)) throw new SearchSyntaxError(`${operator}: expects a valid YYYY-MM-DD date.`, start);
      if (operator === 'type' && value.toLowerCase() !== 'note') throw new SearchSyntaxError('type: currently supports only "note".', start);
      constraints.push({ operator, value, start, end: cursor });
    } else if (quoted) text.push(value);
    else freeText = freeText ? `${freeText} ${value}` : value;
    if (text.length + constraints.length > 20) throw new SearchSyntaxError('Search queries can contain at most 20 terms or operators.', start);
  }
  flushFreeText();
  // Preserve literal matching for ordinary queries. Quoted chunks become independently
  // required phrases when mixed with operators or other phrases.
  return { raw, text, constraints };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
