import type { ConflictSummary } from '../../src/sync/conflict-registry';

export function conflictLabel(conflict: Pick<ConflictSummary, 'status' | 'mergedCopyCount'>): string {
  if (conflict.mergedCopyCount > 0 && (conflict.status === 'open' || conflict.status === 'needs-recovery')) {
    return conflict.status === 'needs-recovery'
      ? 'Unresolved — merged copy created · needs recovery'
      : 'Open — merged copy created';
  }
  return conflict.status.replaceAll('-', ' ');
}
