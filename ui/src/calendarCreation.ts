/**
 * True only when the server definitively rejected a creation request without
 * persisting a note. Network failures, timeouts and 5xx responses are
 * ambiguous and must keep the retry operation locked.
 */
export function isDefinitiveCreationRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && [400, 404, 413, 422].includes(status);
}

export type RecoveredDateAction = 'write-intended-date' | 'keep-current-date' | 'conflict';

/**
 * Decide what a replayed creation may do with its original date intent.
 * A newer, different or invalid date always wins and is never overwritten.
 */
export function decideRecoveredDateAction(
  currentDate: unknown,
  hasDateIssue: boolean,
  intendedDate: string,
): RecoveredDateAction {
  if (hasDateIssue) return 'conflict';
  if (currentDate === undefined || currentDate === null) return 'write-intended-date';
  return currentDate === intendedDate ? 'keep-current-date' : 'conflict';
}
