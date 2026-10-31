import type { Property } from '../../src/database/schema.js';
import type { DatabaseView, DatabaseViewType } from '../../src/database/database-view.js';
import type { UiDatabase, UiDatabaseRow } from '../../src/ui-server/dto.js';

/** Group only already-filtered/sorted rows; preserve their deterministic order. */
export function kanbanColumns(rows: readonly UiDatabaseRow[], property: Property) {
  const options = property.options ?? [];
  return [
    ...options.map((option) => ({ id: option.id, name: option.name, rows: rows.filter((row) => row.values[property.id] === option.id) })),
    { id: '', name: 'Unassigned', rows: rows.filter((row) => !options.some((option) => option.id === row.values[property.id])) },
  ];
}

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Today's local calendar date, never a UTC conversion of the local day. */
export function todayDate(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  const bounded = Math.max(12, Math.min(9999 * 12 + 11, index));
  return `${String(Math.floor(bounded / 12)).padStart(4, '0')}-${String(bounded % 12 + 1).padStart(2, '0')}`;
}

export function monthDays(month: string): Array<string | null> {
  const first = new Date(`${month}-01T00:00:00.000Z`);
  if (!isDateOnly(`${month}-01`)) return [];
  const days: Array<string | null> = Array(first.getUTCDay()).fill(null);
  for (let day = 1; day <= 31; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    if (!isDateOnly(date)) break;
    days.push(date);
  }
  while (days.length % 7) days.push(null);
  return days;
}

export function calendarRows(rows: readonly UiDatabaseRow[], propertyId: string) {
  const dated = new Map<string, UiDatabaseRow[]>();
  const undated: UiDatabaseRow[] = [];
  for (const row of rows) {
    const date = row.values[propertyId];
    if (!isDateOnly(date)) undated.push(row);
    else dated.set(date, [...(dated.get(date) ?? []), row]);
  }
  return { dated, undated };
}

export interface DatabaseRowGroup { id: string; name: string; rows: UiDatabaseRow[] }

/** Groups an already filtered and sorted row set without changing member order. */
export function groupDatabaseRows(rows: readonly UiDatabaseRow[], property: Property): DatabaseRowGroup[] {
  const buckets = new Map<string, UiDatabaseRow[]>();
  const valueFor = (row: UiDatabaseRow) => row.values[property.id];
  const noValue = (value: unknown) => value === undefined || value === null || value === '';
  let unknown: UiDatabaseRow[] = [];
  for (const row of rows) {
    if(property.type==='formula'&&row.issues.some(issue=>issue.propertyId===property.id&&issue.code==='FORMULA_ERROR')){const bucket=buckets.get('__formula-error__')??[];bucket.push(row);buckets.set('__formula-error__',bucket);continue;}
    const value = valueFor(row);
    if (noValue(value)) continue;
    const key = property.type === 'select' && typeof value === 'string'
      ? (property.options ?? []).some((option) => option.id === value) ? value : '__unknown__'
      : property.type === 'checkbox' && typeof value === 'boolean' ? String(value)
      : property.type==='formula'&&['string','number','boolean'].includes(typeof value)?`formula:${typeof value}:${String(value)}`:'__unknown__';
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  const groups: DatabaseRowGroup[] = [];
  if (property.type === 'select') {
    for (const option of property.options ?? []) {
      const members = buckets.get(option.id);
      if (members?.length) groups.push({ id: option.id, name: option.name, rows: members });
    }
    unknown = buckets.get('__unknown__') ?? [];
  } else if (property.type === 'checkbox') {
    for (const [id, name] of [['false', 'No'], ['true', 'Yes']] as const) {
      const members = buckets.get(id);
      if (members?.length) groups.push({ id, name, rows: members });
    }
    unknown = buckets.get('__unknown__') ?? [];
  } else if(property.type==='formula'){
    for(const [id,members] of buckets)if(id!=='__unknown__'&&id!=='__formula-error__')groups.push({id,name:id.slice(id.indexOf(':',8)+1),rows:members});
    groups.sort((a,b)=>a.name.localeCompare(b.name));unknown=buckets.get('__unknown__')??[];const failed=buckets.get('__formula-error__');if(failed?.length)groups.push({id:'__formula-error__',name:'Formula error',rows:failed});
  }
  if (unknown.length) groups.push({ id: '__unknown__', name: 'Unknown value', rows: unknown });
  const unassigned = rows.filter((row) => noValue(valueFor(row))&&!(property.type==='formula'&&row.issues.some(issue=>issue.propertyId===property.id&&issue.code==='FORMULA_ERROR')));
  if (unassigned.length) groups.push({ id: '__no-value__', name: 'No value', rows: unassigned });
  return groups;
}

export type ViewConfiguration = Pick<DatabaseView, 'sort' | 'sorts' | 'filters' | 'visiblePropertyIds' | 'type' | 'settings'>;

export function defaultView(database: UiDatabase, type: DatabaseViewType = 'table'): ViewConfiguration {
  return {
    type, sort: { propertyId: 'title', direction: 'asc' }, filters: [],
    visiblePropertyIds: database.properties.map((property) => property.id),
    settings: type === 'kanban'
      ? { groupPropertyId: database.properties.find((property) => property.type === 'select')?.id }
      : type === 'calendar' ? { datePropertyId: database.properties.find((property) => property.type === 'date')?.id } : {},
  };
}
