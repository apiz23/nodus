import { isUuidV4 } from '../../src/domain/ids.js';
import type { Property } from '../../src/database/schema.js';
import type { UiDatabaseRow } from '../../src/ui-server/dto.js';
import type { UiDatabase } from '../../src/ui-server/dto.js';

export type DatabaseSortField = 'title' | string;
export type DatabaseSortDirection = 'asc' | 'desc';
export type DatabaseFilterOperator = 'contains' | 'equals' | 'greater' | 'less' | 'is' | 'before' | 'after' | 'includes' | 'is-empty' | 'is-not-empty';

export interface DatabaseFilter {
  id: string;
  propertyId: string;
  operator: DatabaseFilterOperator;
  value?: unknown;
}

export function databaseIdentityLabel(database: Pick<UiDatabase, 'id' | 'name' | 'path'>): string {
  return `${database.name} — ${database.path} — ${database.id}`;
}

export function filterOperators(property: Property): DatabaseFilterOperator[] {
  switch (property.type) {
    case 'text': return ['contains', 'equals', 'is-empty', 'is-not-empty'];
    case 'rollup':
    case 'number': return ['equals', 'greater', 'less', 'is-empty', 'is-not-empty'];
    case 'relation': return property.relation?.cardinality === 'one' ? ['is'] : ['includes'];
    case 'checkbox': return ['is', 'is-empty', 'is-not-empty'];
    case 'date': return ['equals', 'before', 'after', 'is-empty', 'is-not-empty'];
    case 'select': return ['is', 'is-empty', 'is-not-empty'];
    case 'multi-select': return ['includes', 'is-empty', 'is-not-empty'];
  }
}

export function initialFilterValue(property: Property): unknown {
  switch (property.type) {
    case 'relation': return '';
    case 'rollup':
    case 'text':
    case 'number':
    case 'date': return '';
    case 'checkbox': return true;
    case 'select':
    case 'multi-select': return property.options?.[0]?.id ?? '';
  }
}

export function isValidFilter(property: Property, operator: string, value: unknown): boolean {
  if (!filterOperators(property).includes(operator as DatabaseFilterOperator)) return false;
  if (operator === 'is-empty' || operator === 'is-not-empty') return value === undefined;
  switch (property.type) {
    case 'text':
      return typeof value === 'string' && (operator === 'equals' || value.length > 0);
    case 'relation': return typeof value === 'string' && isUuidV4(value);
    case 'rollup':
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'checkbox': return typeof value === 'boolean';
    case 'date': return typeof value === 'string' && isCalendarDate(value);
    case 'select':
    case 'multi-select':
      return typeof value === 'string' && (property.options ?? []).some((option) => option.id === value);
  }
}

/** Incomplete/invalid filters are ignored until their operator and value are valid. */
export function filterDatabaseRows(
  rows: readonly UiDatabaseRow[],
  properties: readonly Property[],
  filters: readonly DatabaseFilter[],
): UiDatabaseRow[] {
  const active = filters.flatMap((filter) => {
    const property = properties.find((item) => item.id === filter.propertyId);
    return property !== undefined && isValidFilter(property, filter.operator, filter.value)
      ? [{ filter, property }]
      : [];
  });

  return rows.filter((row) => active.every(({ filter, property }) => {
    const actual = row.values[property.id];
    if (filter.operator === 'is-empty') return actual === undefined || actual === null || actual === '' || (Array.isArray(actual) && actual.length === 0);
    if (filter.operator === 'is-not-empty') return actual !== undefined && actual !== null && actual !== '' && !(Array.isArray(actual) && actual.length === 0);
    if (actual === undefined || actual === null) return false;
    switch (filter.operator) {
      case 'contains':
        return property.type === 'text' && typeof actual === 'string'
          && actual.toLocaleLowerCase().includes((filter.value as string).toLocaleLowerCase());
      case 'equals':
        if (property.type === 'text') return typeof actual === 'string' && actual === filter.value;
        if ((property.type === 'number' || property.type === 'rollup')) return typeof actual === 'number' && actual === filter.value;
        if (property.type === 'date') return typeof actual === 'string' && isCalendarDate(actual) && actual === filter.value;
        return false;
      case 'greater': return (property.type === 'number' || property.type === 'rollup') && typeof actual === 'number' && Number.isFinite(actual) && actual > (filter.value as number);
      case 'less': return (property.type === 'number' || property.type === 'rollup') && typeof actual === 'number' && Number.isFinite(actual) && actual < (filter.value as number);
      case 'is':
        if (property.type === 'checkbox') return typeof actual === 'boolean' && actual === filter.value;
        if (property.type === 'select' || property.type === 'relation') return typeof actual === 'string' && actual === filter.value;
        return false;
      case 'before': return property.type === 'date' && typeof actual === 'string' && isCalendarDate(actual) && actual < (filter.value as string);
      case 'after': return property.type === 'date' && typeof actual === 'string' && isCalendarDate(actual) && actual > (filter.value as string);
      case 'includes': return (property.type === 'multi-select' || property.type === 'relation') && Array.isArray(actual) && actual.includes(filter.value as string);
    }
  }));
}

export function sortDatabaseRows(
  rows: readonly UiDatabaseRow[],
  properties: readonly Property[],
  field: DatabaseSortField,
  direction: DatabaseSortDirection,
): UiDatabaseRow[] {
  const property = field === 'title' ? undefined : properties.find((item) => item.id === field);
  const factor = direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = sortableValue(left, property, field);
    const b = sortableValue(right, property, field);
    if (a === undefined || b === undefined) {
      if (a !== undefined) return -1;
      if (b !== undefined) return 1;
    } else {
      const compared = typeof a === 'number' && typeof b === 'number'
        ? a - b
        : typeof a === 'boolean' && typeof b === 'boolean'
          ? Number(a) - Number(b)
          : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
      if (compared !== 0) return compared * factor;
    }
    return left.noteId.localeCompare(right.noteId);
  });
}

export function sortDatabaseRowsBy(rows: readonly UiDatabaseRow[], properties: readonly Property[], sorts: readonly { propertyId: DatabaseSortField; direction: DatabaseSortDirection }[]): UiDatabaseRow[] {
  const priorities = sorts.length ? sorts : [{ propertyId: 'title', direction: 'asc' as const }];
  return [...rows].sort((left, right) => {
    for (const sort of priorities) {
      const property = sort.propertyId === 'title' ? undefined : properties.find((item) => item.id === sort.propertyId);
      const a = sortableValue(left, property, sort.propertyId);
      const b = sortableValue(right, property, sort.propertyId);
      if (a === undefined || b === undefined) {
        if (a !== undefined) return -1;
        if (b !== undefined) return 1;
        continue;
      }
      const compared = typeof a === 'number' && typeof b === 'number' ? a - b
        : typeof a === 'boolean' && typeof b === 'boolean' ? Number(a) - Number(b)
          : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
      if (compared !== 0) return compared * (sort.direction === 'asc' ? 1 : -1);
    }
    return left.noteId.localeCompare(right.noteId);
  });
}

export function selectDatabaseRows(
  rows: readonly UiDatabaseRow[],
  properties: readonly Property[],
  filters: readonly DatabaseFilter[],
  sortField: DatabaseSortField | readonly { propertyId: DatabaseSortField; direction: DatabaseSortDirection }[],
  direction?: DatabaseSortDirection,
): UiDatabaseRow[] {
  const filtered = filterDatabaseRows(rows, properties, filters);
  return typeof sortField !== 'string'
    ? sortDatabaseRowsBy(filtered, properties, sortField)
    : sortDatabaseRows(filtered, properties, sortField, direction ?? 'asc');
}

function sortableValue(row: UiDatabaseRow, property: Property | undefined, field: DatabaseSortField): string | number | boolean | undefined {
  if (field === 'title' || property === undefined) return row.title || undefined;
  const value = row.values[property.id];
  if (property.type === 'relation') return row.relations?.[property.id]?.map((ref) => ref.title ?? ref.id).sort().join(', ') || undefined;
  if ((property.type === 'number' || property.type === 'rollup')) return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if (property.type === 'checkbox') return typeof value === 'boolean' ? value : undefined;
  if (property.type === 'text') return typeof value === 'string' ? value : undefined;
  if (property.type === 'date') return typeof value === 'string' && isCalendarDate(value) ? value : undefined;
  if (property.type === 'select') {
    return typeof value === 'string' ? property.options?.find((option) => option.id === value)?.name : undefined;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.map((id) => property.options?.find((option) => option.id === id)?.name ?? id).sort().join(', ');
  }
  return undefined;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function hasBlockingRowIssues(row: UiDatabaseRow, property?: Property): boolean { return row.issues.some((issue) => !['MISSING_TARGET', 'INCOMPATIBLE_TARGET', 'INVALID_CONFIGURATION', 'CIRCULAR_ROLLUP', 'ROLLUP_ERROR'].includes(issue.code) && !(property?.type === 'relation' && issue.propertyId === property.id && ['TYPE_MISMATCH', 'INVALID_VALUE'].includes(issue.code))); }
