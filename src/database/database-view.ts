import { NodusError } from '../domain/errors.js';
import { isUuidV4 } from '../domain/ids.js';
import type { DatabaseDefinition, Property } from './schema.js';

export const DATABASE_VIEW_FORMAT = 'nodus-database-view';
export const DATABASE_VIEW_VERSION = 3;

export type DatabaseViewType = 'table' | 'list' | 'kanban' | 'calendar';
export interface DatabaseViewSettings { groupPropertyId?: string; datePropertyId?: string }

export type ViewSort = { propertyId: 'title' | string; direction: 'asc' | 'desc' };
export type ViewFilterOperator = 'contains' | 'equals' | 'greater' | 'less' | 'is' | 'before' | 'after' | 'includes' | 'is-empty' | 'is-not-empty';
export interface ViewFilter { id: string; propertyId: string; operator: ViewFilterOperator; value?: string | number | boolean }
export interface DatabaseView {
  id: string;
  databaseId: string;
  name: string;
  sort: ViewSort;
  /** v3 ordered sort priorities; sort remains the v1/v2 primary-sort field. */
  sorts?: ViewSort[];
  filters: ViewFilter[];
  visiblePropertyIds: string[];
  /** Absent only for legacy v1 table files. New views use the v2 envelope. */
  type?: DatabaseViewType;
  settings?: DatabaseViewSettings;
}
export interface DatabaseViewDiagnostic { code: 'MISSING_DATABASE' | 'MISSING_PROPERTY' | 'MISSING_OPTION' | 'INVALID_REFERENCE'; message: string; propertyId?: string }

export function parseDatabaseView(json: string): DatabaseView {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch (error) { throw invalid(`View file is not valid JSON: ${(error as Error).message}`); }
  if (!record(raw)) throw invalid('View must be a JSON object');
  if (raw.format !== DATABASE_VIEW_FORMAT) throw invalid(`format must be "${DATABASE_VIEW_FORMAT}"`);
  if (!Number.isInteger(raw.version) || typeof raw.version !== 'number' || raw.version < 1) throw invalid('View version must be a positive integer');
  if (raw.version > DATABASE_VIEW_VERSION) throw new NodusError('UNSUPPORTED_VERSION', `Database view version ${raw.version} is newer than supported version ${DATABASE_VIEW_VERSION}; upgrade Nodus to read it`);
  exactKeys(raw, ['format', 'version', 'id', 'databaseId', 'name', 'sort', 'filters', 'visiblePropertyIds', ...(raw.version >= 2 ? ['type', 'settings'] : []), ...(raw.version >= 3 ? ['sorts'] : [])], 'view');
  let presentation: Pick<DatabaseView, 'type' | 'settings'> = {};
  if (raw.version >= 2) {
    if (raw.type !== 'table' && raw.type !== 'kanban' && raw.type !== 'calendar' && !(raw.version >= 3 && raw.type === 'list')) throw invalid('type must be table, list, kanban, or calendar');
    if (!record(raw.settings)) throw invalid('settings must be an object');
    const key = raw.type === 'kanban' ? 'groupPropertyId' : raw.type === 'calendar' ? 'datePropertyId' : undefined;
    exactKeys(raw.settings, key === undefined ? [] : [key], 'settings');
    presentation = { type: raw.type, settings: key === undefined ? {} : { [key]: uuid(raw.settings[key], `settings.${key}`) } };
  }
  const id = uuid(raw.id, 'view id');
  const databaseId = uuid(raw.databaseId, 'databaseId');
  const name = requiredName(raw.name);
  if (!record(raw.sort)) throw invalid('sort must be an object');
  exactKeys(raw.sort, ['propertyId', 'direction'], 'sort');
  const propertyId = raw.sort.propertyId;
  if (propertyId !== 'title' && !isUuidV4(propertyId)) throw invalid('sort.propertyId must be "title" or a lowercase UUID v4');
  if (raw.sort.direction !== 'asc' && raw.sort.direction !== 'desc') throw invalid('sort.direction must be "asc" or "desc"');
  const sorts = raw.version >= 3 ? parseSorts(raw.sorts) : undefined;
  if (!Array.isArray(raw.filters)) throw invalid('filters must be an array');
  const filters = raw.filters.map((item, index): ViewFilter => {
    const where = `filters[${index}]`;
    if (!record(item)) throw invalid(`${where} must be an object`);
    exactKeys(item, ['id', 'propertyId', 'operator', 'value'], where);
    const filterId = uuid(item.id, `${where}.id`);
    const filterPropertyId = uuid(item.propertyId, `${where}.propertyId`);
    if (!OPERATORS.has(item.operator as string)) throw invalid(`${where}.operator is not supported`);
    if (item.operator === 'is-empty' || item.operator === 'is-not-empty') {
      if ('value' in item) throw invalid(`${where}.value is not allowed for empty filters`);
      return { id: filterId, propertyId: filterPropertyId, operator: item.operator as ViewFilterOperator };
    }
    if (typeof item.value !== 'string' && typeof item.value !== 'number' && typeof item.value !== 'boolean') throw invalid(`${where}.value must be a string, finite number, or boolean`);
    if (typeof item.value === 'number' && !Number.isFinite(item.value)) throw invalid(`${where}.value must be finite`);
    return { id: filterId, propertyId: filterPropertyId, operator: item.operator as ViewFilterOperator, value: item.value };
  });
  unique(filters.map((filter) => filter.id), 'filter ID');
  if (!Array.isArray(raw.visiblePropertyIds)) throw invalid('visiblePropertyIds must be an array');
  const visiblePropertyIds = raw.visiblePropertyIds.map((value, index) => uuid(value, `visiblePropertyIds[${index}]`));
  unique(visiblePropertyIds, 'visible property ID');
  return { id, databaseId, name, sort: { propertyId, direction: raw.sort.direction }, ...(sorts === undefined ? {} : { sorts }), filters, visiblePropertyIds, ...presentation };
}

export function serializeDatabaseView(view: DatabaseView): string {
  const version = view.type === 'list' || view.sorts !== undefined || view.filters.some((filter) => filter.operator === 'is-empty' || filter.operator === 'is-not-empty') ? DATABASE_VIEW_VERSION : view.type === undefined && view.settings === undefined ? 1 : 2;
  const normalized = version >= 3 ? { ...view, type: view.type ?? 'table', settings: view.settings ?? {}, sorts: view.sorts ?? [view.sort] } : view;
  const json = `${JSON.stringify({
    format: DATABASE_VIEW_FORMAT, version, id: normalized.id, databaseId: normalized.databaseId, name: normalized.name,
    ...(normalized.type === undefined ? {} : { type: normalized.type }),
    ...(normalized.settings === undefined ? {} : { settings: normalized.settings }),
    sort: normalized.sort, ...(normalized.sorts === undefined ? {} : { sorts: normalized.sorts }),
    filters: normalized.filters, visiblePropertyIds: normalized.visiblePropertyIds,
  }, null, 2)}\n`;
  parseDatabaseView(json);
  return json;
}

/** Diagnostics are read-only. Orphan references never make the saved file disappear. */
export function diagnoseDatabaseView(view: DatabaseView, database?: DatabaseDefinition): DatabaseViewDiagnostic[] {
  if (!database) return [{ code: 'MISSING_DATABASE', message: `Database "${view.databaseId}" is missing; saved view was preserved.` }];
  const issues: DatabaseViewDiagnostic[] = [];
  const byId = new Map(database.properties.map((property) => [property.id, property]));
  const settingId = view.type === 'kanban' ? view.settings?.groupPropertyId : view.type === 'calendar' ? view.settings?.datePropertyId : undefined;
  if (settingId !== undefined) {
    const property = byId.get(settingId);
    if (property === undefined) issues.push({ code: 'MISSING_PROPERTY', propertyId: settingId, message: `View property "${settingId}" is missing; saved view was preserved.` });
    else if (property.type !== (view.type === 'kanban' ? 'select' : 'date')) issues.push({ code: 'INVALID_REFERENCE', propertyId: settingId, message: `${view.type} requires a ${view.type === 'kanban' ? 'Select' : 'Date'} property; saved view was preserved.` });
  }
  const refs = new Set([...view.visiblePropertyIds, ...(view.sort.propertyId === 'title' ? [] : [view.sort.propertyId]), ...(view.sorts ?? []).filter((sort) => sort.propertyId !== 'title').map((sort) => sort.propertyId), ...view.filters.map((filter) => filter.propertyId)]);
  for (const id of refs) if (!byId.has(id)) issues.push({ code: 'MISSING_PROPERTY', propertyId: id, message: `Property "${id}" is missing; saved view was preserved.` });
  for (const filter of view.filters) {
    const property = byId.get(filter.propertyId);
    if (!property) continue;
    if (filter.operator === 'is-empty' || filter.operator === 'is-not-empty') {
      if (!['text', 'number', 'date', 'checkbox', 'select', 'multi-select'].includes(property.type)) issues.push({ code: 'INVALID_REFERENCE', propertyId: property.id, message: `Empty filter is incompatible with property "${property.name}"; saved view was preserved.` });
      continue;
    }
    if (!filterFits(property, filter.operator, filter.value)) {
      issues.push({ code: 'INVALID_REFERENCE', propertyId: property.id, message: `Filter "${filter.id}" is incompatible with property "${property.name}"; saved view was preserved.` });
      continue;
    }
    if ((property.type === 'select' || property.type === 'multi-select') && !(property.options ?? []).some((option) => option.id === filter.value)) {
      issues.push({ code: 'MISSING_OPTION', propertyId: property.id, message: `Filter "${filter.id}" references a missing option; saved view was preserved.` });
    }
  }
  return issues;
}

export function validateViewReferences(view: DatabaseView, database: DatabaseDefinition): void {
  const diagnostics = diagnoseDatabaseView(view, database);
  if (diagnostics.length) throw invalid(diagnostics.map((item) => item.message).join(' '));
}

function filterFits(property: Property, operator: ViewFilterOperator, value: unknown): boolean {
  const matches = (operators: ViewFilterOperator[], type: string) => operators.includes(operator) && property.type === type;
  if (matches(['contains', 'equals'], 'text')) return typeof value === 'string' && (operator === 'equals' || value.length > 0);
  if (property.type === 'relation') return (property.relation?.cardinality === 'one' ? operator === 'is' : operator === 'includes') && typeof value === 'string' && isUuidV4(value);
  if (matches(['equals', 'greater', 'less'], 'number') || matches(['equals', 'greater', 'less'], 'rollup')) return typeof value === 'number' && Number.isFinite(value);
  if (matches(['is'], 'checkbox')) return typeof value === 'boolean';
  if (matches(['equals', 'before', 'after'], 'date')) return typeof value === 'string' && validDate(value);
  if (matches(['is'], 'select') || matches(['includes'], 'multi-select')) return typeof value === 'string';
  return false;
}
function parseSorts(value: unknown): ViewSort[] {
  if (!Array.isArray(value) || value.length === 0) throw invalid('sorts must be a non-empty array');
  const sorts = value.map((item, index) => {
    if (!record(item)) throw invalid(`sorts[${index}] must be an object`);
    exactKeys(item, ['propertyId', 'direction'], `sorts[${index}]`);
    if (item.propertyId !== 'title' && !isUuidV4(item.propertyId)) throw invalid(`sorts[${index}].propertyId must be "title" or a lowercase UUID v4`);
    if (item.direction !== 'asc' && item.direction !== 'desc') throw invalid(`sorts[${index}].direction must be asc or desc`);
    return { propertyId: item.propertyId as string, direction: item.direction as 'asc' | 'desc' };
  });
  unique(sorts.map((sort) => sort.propertyId), 'sort property ID');
  return sorts;
}
function validDate(value: string): boolean { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }
function uuid(value: unknown, label: string): string { if (typeof value !== 'string' || !isUuidV4(value)) throw invalid(`${label} must be a lowercase UUID v4`); return value; }
function requiredName(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.trim() !== value) throw invalid('name must be a non-empty string without surrounding whitespace'); return value; }
function exactKeys(value: Record<string, unknown>, allowed: string[], where: string): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw invalid(`Unknown key "${key}" in ${where}`); }
function unique(values: string[], label: string): void { if (new Set(values).size !== values.length) throw invalid(`Duplicate ${label}`); }
function record(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function invalid(message: string): NodusError { return new NodusError('INVALID_DATABASE', message); }
const OPERATORS = new Set<string>(['contains', 'equals', 'greater', 'less', 'is', 'before', 'after', 'includes', 'is-empty', 'is-not-empty']);
