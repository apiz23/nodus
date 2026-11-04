/** A timezone-free Gregorian calendar date in canonical YYYY-MM-DD form. */
export type DateOnly = string;

export interface DateRange {
  /** Inclusive first calendar day. */
  startDate: DateOnly;
  /** Inclusive last calendar day; equal to startDate for a one-day event. */
  endDate: DateOnly;
}

export type DateRangeResult =
  | { status: 'valid'; range: DateRange }
  | { status: 'unscheduled'; reason: 'missing-start' }
  | { status: 'invalid'; reason: 'invalid-start' | 'invalid-end' | 'end-before-start' };

/** True only for real dates in the supported, timezone-free YYYY-MM-DD form. */
export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Validate a required start and optional inclusive end date. */
export function resolveDateRange(start: unknown, end?: unknown): DateRangeResult {
  if (start === undefined) return { status: 'unscheduled', reason: 'missing-start' };
  if (!isDateOnly(start)) return { status: 'invalid', reason: 'invalid-start' };
  if (end === undefined) return { status: 'valid', range: { startDate: start, endDate: start } };
  if (!isDateOnly(end)) return { status: 'invalid', reason: 'invalid-end' };
  if (end < start) return { status: 'invalid', reason: 'end-before-start' };
  return { status: 'valid', range: { startDate: start, endDate: end } };
}
