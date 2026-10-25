/**
 * Shared path normalization for sync and storage.
 *
 * Matches the folding used by Phase 2 storage to detect case-insensitive and
 * NFC-normalized collisions.
 */

export function foldPath(path: string): string {
  return path.normalize('NFC').toLowerCase();
}
