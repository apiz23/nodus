import { describe, expect, it } from 'vitest';
import { calendarRows, isDateOnly, kanbanColumns, monthDays, shiftMonth, todayDate } from '../ui/src/database-view-layout.js';
import { selectDatabaseRows } from '../ui/src/database-table.js';
import type { UiDatabaseRow } from '../src/ui-server/dto.js';
import { defaultView } from '../ui/src/database-view-layout.js';

const properties = [
  { id: 'status', name: 'Status', type: 'select' as const, options: [{ id: 'ready', name: 'Ready' }, { id: 'done', name: 'Done' }] },
  { id: 'date', name: 'Due', type: 'date' as const },
];
const makeRow = (noteId: string, title: string, values: UiDatabaseRow['values']): UiDatabaseRow => ({ noteId, title, path: `${noteId}.md`, databaseId: 'db', values, issues: [], contentHash: 'a'.repeat(64), updatedAt: '' });

describe('database view layouts', () => {
  it('groups filtered and stably sorted rows by option IDs with an unassigned column', () => {
    const rows = [makeRow('2', 'Same', { status: 'ready' }), makeRow('1', 'Same', { status: 'ready' }), makeRow('3', 'Unassigned', {}), makeRow('4', 'Done', { status: 'done' })];
    const selected = selectDatabaseRows(rows, properties, [], 'title', 'asc');
    const columns = kanbanColumns(selected, properties[0]!);
    expect(columns.map((column) => [column.id, column.rows.map((row) => row.noteId)])).toEqual([['ready', ['1', '2']], ['done', ['4']], ['', ['3']]]);
    const filtered = selectDatabaseRows(rows, properties, [{ id: 'f', propertyId: 'status', operator: 'is', value: 'done' }], 'title', 'asc');
    expect(kanbanColumns(filtered, properties[0]!)[0]?.rows).toEqual([]);
    expect(rows[0]?.values.status).toBe('ready');
  });

  it('uses strict date-only semantics, leap days, month boundaries, and undated fallback', () => {
    expect(isDateOnly('2028-02-29')).toBe(true);
    expect(isDateOnly('2026-02-29')).toBe(false);
    expect(isDateOnly('2026-10-28T12:00:00Z')).toBe(false);
    expect(monthDays('2028-02').filter(Boolean)).toHaveLength(29);
    expect(monthDays('2026-02').filter(Boolean)).toHaveLength(28);
    expect(monthDays('2026-11')[0]).toBe('2026-11-01');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(todayDate(new Date(2026, 9, 28, 0, 1))).toBe('2026-10-28');
    const result = calendarRows([makeRow('1', 'Dated', { date: '2026-10-28' }), makeRow('2', 'Missing', {}), makeRow('3', 'Invalid', { date: '2026-02-30' })], 'date');
    expect(result.dated.get('2026-10-28')?.map((row) => row.noteId)).toEqual(['1']);
    expect(result.undated.map((row) => row.noteId)).toEqual(['2', '3']);
  });

  it('defaults new views to title sorting, all columns, no filters and typed setting IDs', () => {
    const database = { id: 'db', name: 'Tasks', path: 'db.json', contentHash: '', properties };
    expect(defaultView(database, 'table')).toMatchObject({ type: 'table', sort: { propertyId: 'title', direction: 'asc' }, filters: [], visiblePropertyIds: ['status', 'date'], settings: {} });
    expect(defaultView(database, 'kanban').settings).toEqual({ groupPropertyId: 'status' });
    expect(defaultView(database, 'calendar').settings).toEqual({ datePropertyId: 'date' });
  });
});
