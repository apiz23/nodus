/**
 * Pure saved-view ordering helpers shared by the keyboard reorder controls.
 */

/** Moves one view ID by `delta` positions; returns null at either boundary. */
export function moveSavedViewId(viewIds: readonly string[], viewId: string, delta: -1 | 1): string[] | null {
  const index = viewIds.indexOf(viewId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= viewIds.length) return null;
  const next = [...viewIds];
  next[index] = next[target]!;
  next[target] = viewId;
  return next;
}
