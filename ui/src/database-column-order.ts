/**
 * Deterministic column ordering for a saved database view.
 *
 * Only current schema property IDs belong in the effective order. A saved view
 * contributes the valid IDs it knows about; schema properties missing from the
 * saved order keep their schema-relative order after the saved columns. Unknown
 * and duplicate references are ignored here because the saved-view diagnostics
 * remain responsible for preserving and reporting them.
 */
export function mergeColumnOrder(schemaIds: readonly string[], savedIds: readonly string[]): string[] {
  const known = new Set(schemaIds);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of savedIds) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  for (const id of schemaIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  return order;
}

/** Schema order with duplicate IDs removed. */
export function resetColumnOrder(schemaIds: readonly string[]): string[] {
  return mergeColumnOrder(schemaIds, []);
}

/** Visible columns in their effective order. */
export function visibleColumnIds(order: readonly string[], hidden: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  return order.filter((id) => {
    if (hidden.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Swap one visible column with its adjacent visible neighbor.
 *
 * Hidden columns keep their slots in the complete order; only visible IDs
 * change places. Hidden, missing and boundary targets return null.
 */
export function moveVisibleColumn(
  order: readonly string[],
  hidden: ReadonlySet<string>,
  id: string,
  delta: -1 | 1,
): string[] | null {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const candidate of order) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    unique.push(candidate);
  }
  if (hidden.has(id)) return null;
  const visible = visibleColumnIds(unique, hidden);
  const index = visible.indexOf(id);
  const neighbor = visible[index + delta];
  if (index < 0 || neighbor === undefined) return null;
  const from = unique.indexOf(id);
  const to = unique.indexOf(neighbor);
  const next = [...unique];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** Whether the effective order is exactly schema order. */
export function columnOrderMatchesSchema(schemaIds: readonly string[], order: readonly string[]): boolean {
  const expected = resetColumnOrder(schemaIds);
  const actual = mergeColumnOrder(schemaIds, order);
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}
