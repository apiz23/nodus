import type { NotePropertyDefinition, NotePropertyValue, PropertyCatalog } from '../properties/catalog.js';
import { validateNotePropertyValue } from '../properties/catalog.js';

export type EmptyFilterOperator = 'is-empty' | 'is-not-empty';
export type NoteFilter =
  | { type: 'tag'; operator: 'contains' | 'does-not-contain' | 'contains-all'; value: string | string[] }
  | { type: 'property'; propertyId: string; operator: string; value?: NotePropertyValue };
export type NoteFilterLogic = 'and' | 'or';

export interface FilterableNote {
  tags: readonly string[];
  values: Readonly<Record<string, NotePropertyValue>>;
  invalidPropertyIds: ReadonlySet<string>;
}

const OPERATORS: Record<NotePropertyDefinition['type'], readonly string[]> = {
  text: ['equals', 'contains', 'is-empty', 'is-not-empty'],
  number: ['equals', 'greater-than', 'less-than', 'is-empty', 'is-not-empty'],
  checkbox: ['is-checked', 'is-unchecked'],
  date: ['equals', 'before', 'after', 'is-empty', 'is-not-empty'],
  select: ['is', 'is-not', 'is-empty', 'is-not-empty'],
  'multi-select': ['contains', 'does-not-contain', 'contains-all', 'is-empty', 'is-not-empty'],
  url: ['equals', 'contains', 'is-empty', 'is-not-empty'],
};

export function operatorsForProperty(property: NotePropertyDefinition): readonly string[] {
  return OPERATORS[property.type];
}

/** Validate the small serializable filter contract against the current catalog. */
export function validateNoteFilters(value: unknown, catalog: PropertyCatalog): NoteFilter[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('filters must be an array containing at most 20 filters.');
  const properties = new Map(catalog.properties.map((property) => [property.id, property]));
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`Filter ${index + 1} must be an object.`);
    if (candidate.type === 'tag') {
      if (!['contains', 'does-not-contain', 'contains-all'].includes(String(candidate.operator))) throw new Error(`Filter ${index + 1} has an unsupported tag operator.`);
      const strings = typeof candidate.value === 'string' ? [candidate.value] : candidate.value;
      if (!Array.isArray(strings) || strings.length === 0 || strings.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`Filter ${index + 1} requires a non-empty tag value.`);
      if (candidate.operator !== 'contains-all' && strings.length !== 1) throw new Error(`Filter ${index + 1} accepts one tag value for this operator.`);
      return { type: 'tag', operator: candidate.operator as 'contains' | 'does-not-contain' | 'contains-all', value: candidate.operator === 'contains-all' ? strings : strings[0]! };
    }
    if (candidate.type !== 'property' || typeof candidate.propertyId !== 'string') throw new Error(`Filter ${index + 1} has an unsupported type.`);
    const property = properties.get(candidate.propertyId);
    if (!property) throw new Error(`Filter ${index + 1} references a deleted or unknown property.`);
    if (!OPERATORS[property.type].includes(String(candidate.operator))) throw new Error(`Operator "${String(candidate.operator)}" is not valid for ${property.type}.`);
    const operator = candidate.operator as string;
    if (operator === 'is-empty' || operator === 'is-not-empty' || operator === 'is-checked' || operator === 'is-unchecked') {
      if (Object.hasOwn(candidate, 'value')) throw new Error(`Operator "${operator}" does not accept a value.`);
      return { type: 'property', propertyId: property.id, operator };
    }
    const filterValue = candidate.value;
    if (property.type === 'multi-select' && operator === 'contains-all') {
      if (!Array.isArray(filterValue) || filterValue.length === 0) throw new Error('contains-all requires a non-empty array of option labels.');
      for (const item of filterValue) assertValid(property, [item]);
      return { type: 'property', propertyId: property.id, operator, value: filterValue as string[] };
    }
    if (property.type === 'multi-select' && ['contains', 'does-not-contain'].includes(operator)) {
      if (typeof filterValue !== 'string') throw new Error(`${operator} requires one option label.`);
      assertValid(property, [filterValue]);
      return { type: 'property', propertyId: property.id, operator, value: filterValue };
    }
    if (property.type === 'multi-select') throw new Error(`Operator "${operator}" is not valid for multi-select.`);
    if (property.type === 'url' && operator === 'contains') {
      if (typeof filterValue !== 'string' || !filterValue.trim()) throw new Error('URL contains requires a non-empty text fragment.');
      return { type: 'property', propertyId: property.id, operator, value: filterValue };
    }
    assertValid(property, filterValue);
    return { type: 'property', propertyId: property.id, operator, value: filterValue as NotePropertyValue };
  });
}

export function validateFilterLogic(value: unknown): NoteFilterLogic {
  if (value === undefined || value === 'and') return 'and';
  if (value === 'or') return 'or';
  throw new Error('logic must be "and" or "or".');
}

export function matchesNoteFilters(
  note: FilterableNote,
  filters: readonly NoteFilter[],
  logic: NoteFilterLogic,
): boolean {
  if (filters.length === 0) return true;
  const matches = filters.map((filter) => filter.type === 'tag'
    ? matchTag(note.tags, filter)
    : matchProperty(note, filter));
  return logic === 'and' ? matches.every(Boolean) : matches.some(Boolean);
}

function matchTag(tags: readonly string[], filter: Extract<NoteFilter, { type: 'tag' }>): boolean {
  const identities = new Set(tags.map(tagIdentity));
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  const includes = (value: string) => identities.has(tagIdentity(value));
  if (filter.operator === 'contains') return includes(values[0]!);
  if (filter.operator === 'does-not-contain') return !includes(values[0]!);
  return values.every(includes);
}

function matchProperty(note: FilterableNote, filter: Extract<NoteFilter, { type: 'property' }>): boolean {
  if (note.invalidPropertyIds.has(filter.propertyId)) return false;
  const present = Object.hasOwn(note.values, filter.propertyId);
  const value = note.values[filter.propertyId];
  const operator = filter.operator;
  if (operator === 'is-empty') return !present || value === '' || (Array.isArray(value) && value.length === 0);
  if (operator === 'is-not-empty') return present && value !== '' && !(Array.isArray(value) && value.length === 0);
  if (operator === 'is-checked') return value === true;
  if (operator === 'is-unchecked') return value === false;
  if (!present) return false;
  const expected = filter.value;
  switch (operator) {
    case 'equals': return fold(String(value)) === fold(String(expected));
    case 'is': return fold(String(value)) === fold(String(expected));
    case 'is-not': return fold(String(value)) !== fold(String(expected));
    case 'contains': return typeof expected === 'string' && (typeof value === 'string'
      ? fold(value).includes(fold(expected))
      : Array.isArray(value) && value.some((item) => fold(item) === fold(expected)));
    case 'does-not-contain': return Array.isArray(value) && typeof expected === 'string' && !value.some((item) => fold(item) === fold(expected));
    case 'contains-all': return Array.isArray(value) && Array.isArray(expected) && expected.every((item) => value.some((candidate) => fold(candidate) === fold(item)));
    case 'greater-than': return typeof value === 'number' && typeof expected === 'number' && value > expected;
    case 'less-than': return typeof value === 'number' && typeof expected === 'number' && value < expected;
    case 'before': return typeof value === 'string' && typeof expected === 'string' && value < expected;
    case 'after': return typeof value === 'string' && typeof expected === 'string' && value > expected;
    default: return false;
  }
}

function assertValid(property: NotePropertyDefinition, value: unknown): void {
  const result = validateNotePropertyValue(property, value);
  if (!result.ok) throw new Error(result.issue.message);
}

function tagIdentity(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

function fold(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
