import { isDateOnly, type DateOnly } from '../temporal/date.js';
import type { CalendarEvent } from './events.js';

/** Calendar weeks start on Sunday, matching the existing database Calendar. */
export const CALENDAR_WEEK_START = 0;
export const DAY_EVENT_LIMIT = 3;

export type CalendarViewMode = 'month' | 'week' | 'day';

export function monthGrid(month: string): Array<DateOnly | null> {
  if (!/^\d{4}-\d{2}$/.test(month) || !isDateOnly(`${month}-01`)) return [];
  const [year, numericMonth] = month.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(year!, numericMonth! - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(year!, numericMonth!, 0)).getUTCDate();
  const days: Array<DateOnly | null> = Array(firstWeekday).fill(null);
  for (let day = 1; day <= count; day++) days.push(`${month}-${String(day).padStart(2, '0')}`);
  while (days.length % 7) days.push(null);
  return days;
}

export function shiftDate(date: DateOnly, days: number): DateOnly {
  if (!isDateOnly(date) || !Number.isInteger(days)) throw new RangeError('A valid date and whole-day offset are required');
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day! + days));
  const result = value.toISOString().slice(0, 10);
  if (!isDateOnly(result)) throw new RangeError('Date is outside the supported range');
  return result;
}

export function weekDates(date: DateOnly, weekStartsOn = CALENDAR_WEEK_START): DateOnly[] {
  if (!isDateOnly(date) || !Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) throw new RangeError('Invalid date or week start');
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  const start = shiftDate(date, -((weekday - weekStartsOn + 7) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftDate(start, index));
}

export interface CalendarDay {
  date: DateOnly;
  events: CalendarEvent[];
  preview: CalendarEvent[];
  overflow: number;
}

/** Bounded expansion: callers provide visible dates, never an entire event span. */
export function calendarDays(events: readonly CalendarEvent[], dates: readonly DateOnly[], limit = DAY_EVENT_LIMIT): CalendarDay[] {
  if (dates.length > 366) throw new RangeError('Calendar windows cannot exceed 366 days');
  if (!Number.isInteger(limit) || limit < 0) throw new RangeError('Event limit must be a nonnegative integer');
  const unique = new Map<string, CalendarEvent>();
  for (const event of events) {
    const previous = unique.get(event.id);
    if (!previous || JSON.stringify(event) < JSON.stringify(previous)) unique.set(event.id, event);
  }
  const ordered = [...unique.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return dates.map((date) => {
    if (!isDateOnly(date)) throw new RangeError('Calendar days require YYYY-MM-DD dates');
    const active = ordered.filter((event) => event.dateState === 'scheduled' && event.dateRange !== undefined &&
      event.dateRange.startDate <= date && event.dateRange.endDate >= date);
    return { date, events: active, preview: active.slice(0, limit), overflow: Math.max(0, active.length - limit) };
  });
}

export function undatedReason(event: CalendarEvent): string | undefined {
  if (event.dateState === 'scheduled') return undefined;
  if (event.dateState === 'unscheduled') return 'Missing start date';
  if (event.issue === 'end-before-start') return 'End date is before start date';
  if (event.issue === 'invalid-end') return 'Invalid end date';
  return 'Invalid start date';
}
