import { describe, expect, it } from 'vitest';
import {
  columnOrderMatchesSchema,
  mergeColumnOrder,
  moveVisibleColumn,
  resetColumnOrder,
  visibleColumnIds,
} from '../ui/src/database-column-order.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';

describe('database column order', () => {
  it('uses saved order first and appends schema properties missing from it', () => {
    expect(mergeColumnOrder([A, B, C], [C, A])).toEqual([C, A, B]);
    expect(mergeColumnOrder([A, B, C], [])).toEqual([A, B, C]);
  });

  it('removes duplicates and unknown references without treating title as a property', () => {
    expect(mergeColumnOrder([A, B], [B, B, UNKNOWN, 'title', A, B])).toEqual([B, A]);
    expect(mergeColumnOrder([], [A])).toEqual([]);
  });

  it('derives visible IDs in effective order while excluding hidden columns', () => {
    expect(visibleColumnIds([C, A, B], new Set([A]))).toEqual([C, B]);
    expect(visibleColumnIds([C, A, B], new Set())).toEqual([C, A, B]);
  });

  it('moves one visible column across hidden slots without moving hidden IDs', () => {
    const original = [A, B, C];
    const moved = moveVisibleColumn(original, new Set([B]), C, -1);
    expect(moved).toEqual([C, B, A]);
    expect(original).toEqual([A, B, C]);
    expect(moveVisibleColumn(moved!, new Set([B]), C, 1)).toEqual(original);
  });

  it('rejects hidden, missing and boundary moves', () => {
    expect(moveVisibleColumn([A, B], new Set([B]), B, -1)).toBeNull();
    expect(moveVisibleColumn([A, B], new Set(), UNKNOWN, 1)).toBeNull();
    expect(moveVisibleColumn([A, B], new Set(), A, -1)).toBeNull();
    expect(moveVisibleColumn([A, B], new Set(), B, 1)).toBeNull();
    expect(moveVisibleColumn([A], new Set([A]), A, 1)).toBeNull();
  });

  it('never emits duplicate IDs while moving', () => {
    expect(moveVisibleColumn([A, A, B], new Set(), A, 1)).toEqual([B, A]);
  });

  it('resets to unique schema order', () => {
    expect(resetColumnOrder([A, A, B, C, B])).toEqual([A, B, C]);
    expect(resetColumnOrder([])).toEqual([]);
  });

  it('detects schema order after ignoring invalid saved references', () => {
    expect(columnOrderMatchesSchema([A, B], [A, B])).toBe(true);
    expect(columnOrderMatchesSchema([A, B], [B, A])).toBe(false);
    expect(columnOrderMatchesSchema([A, B], [A, UNKNOWN, B])).toBe(true);
  });
});
