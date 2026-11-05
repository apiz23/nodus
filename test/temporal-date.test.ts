import { describe, expect, it } from 'vitest';
import { isDateOnly, resolveDateRange } from '../src/temporal/date.js';

describe('date-only temporal contract', () => {
  it('accepts canonical real dates and leap days only in leap years', () => {
    expect(isDateOnly('2028-02-29')).toBe(true);
    expect(isDateOnly('2026-02-28')).toBe(true);
    expect(isDateOnly('2026-02-29')).toBe(false);
  });

  it('rejects malformed dates and timestamps', () => {
    for (const value of ['2026-2-03', '2026-02-30', '26-02-03', '2026-02-03T00:00:00Z', 20260203, null]) {
      expect(isDateOnly(value)).toBe(false);
    }
  });

  it('resolves missing end dates and inclusive single-day ranges', () => {
    expect(resolveDateRange('2026-11-04')).toEqual({ status: 'valid', range: { startDate: '2026-11-04', endDate: '2026-11-04' } });
    expect(resolveDateRange('2026-11-04', '2026-11-04')).toEqual({ status: 'valid', range: { startDate: '2026-11-04', endDate: '2026-11-04' } });
  });

  it('keeps valid inclusive multi-day ranges and rejects missing or invalid starts and reversed ranges', () => {
    expect(resolveDateRange('2026-11-04', '2026-11-06')).toEqual({ status: 'valid', range: { startDate: '2026-11-04', endDate: '2026-11-06' } });
    expect(resolveDateRange(undefined)).toEqual({ status: 'unscheduled', reason: 'missing-start' });
    expect(resolveDateRange('2026-02-30')).toEqual({ status: 'invalid', reason: 'invalid-start' });
    expect(resolveDateRange(null)).toEqual({ status: 'invalid', reason: 'invalid-start' });
    expect(resolveDateRange('2026-11-04', '2026-11-03')).toEqual({ status: 'invalid', reason: 'end-before-start' });
    expect(resolveDateRange('2026-11-04', '2026-11-31')).toEqual({ status: 'invalid', reason: 'invalid-end' });
    expect(resolveDateRange('2026-11-04', '')).toEqual({ status: 'invalid', reason: 'invalid-end' });
  });
});
