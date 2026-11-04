import { describe, expect, it } from 'vitest';
import { calendarDays, monthGrid, shiftDate, undatedReason, weekDates } from '../src/calendar/layout.js';
import { projectCalendarEvents } from '../src/calendar/events.js';

const events = projectCalendarEvents({
  databaseSources: [{ databaseId: 'db', startDatePropertyId: 'start', endDatePropertyId: 'end' }],
  databaseRows: [
    { databaseId: 'db', noteId: 'span', title: 'Span', path: 'span.md', values: { start: '2028-02-28', end: '2028-03-02' }, issues: [] },
    { databaseId: 'db', noteId: 'missing', title: 'Missing', path: 'missing.md', values: {}, issues: [] },
    { databaseId: 'db', noteId: 'reversed', title: 'Reversed', path: 'reversed.md', values: { start: '2028-03-02', end: '2028-03-01' }, issues: [] },
  ],
});

describe('shared Calendar layout', () => {
  it('builds aligned month grids and Sunday weeks across month and year boundaries', () => {
    expect(monthGrid('2028-02').filter(Boolean)).toHaveLength(29);
    expect(monthGrid('2028-02')[2]).toBe('2028-02-01');
    expect(monthGrid('2027-02')[0]).toBe(null);
    expect(weekDates('2027-01-01')).toEqual(['2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(shiftDate('2028-02-29', 1)).toBe('2028-03-01');
  });
  it('clips inclusive spans to visible dates including leap days and month transitions', () => {
    const days = calendarDays(events, ['2028-02-29', '2028-03-01', '2028-03-02', '2028-03-03']);
    expect(days.map((day) => day.events.length)).toEqual([1, 1, 1, 0]);
  });
  it('deduplicates events and exposes overflow without losing agenda entries', () => {
    const event = events.find((event) => event.dateState === 'scheduled')!;
    const input = [event, event, { ...event, id: 'other' }];
    const day = calendarDays(input, ['2028-02-29'], 1)[0]!;
    expect(day.events).toHaveLength(2);
    expect(day.preview).toHaveLength(1);
    expect(day.overflow).toBe(1);
    expect(calendarDays([...input].reverse(), ['2028-02-29'], 1)).toEqual([day]);
  });
  it('retains explicit missing and reversed date classifications', () => {
    expect(events.map(undatedReason)).toEqual([undefined, 'Missing start date', 'End date is before start date']);
  });
  it('bounds rendering and rejects malformed dates', () => {
    expect(() => calendarDays(events, Array(367).fill('2028-02-29'))).toThrow(/366/);
    expect(() => calendarDays(events, ['2027-02-29'])).toThrow(/YYYY-MM-DD/);
  });
});
