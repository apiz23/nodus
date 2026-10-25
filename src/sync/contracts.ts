/**
 * Sync domain contracts.
 *
 * These types are shared by the relay, the CLI client, and any future sync
 * adapters. They deliberately do not reference HTTP, SQLite, or filesystem
 * types.
 */

export type DocumentKind = 'note' | 'database';

export interface DocumentRef {
  kind: DocumentKind;
  id: string;
}

export interface DocumentHeader extends DocumentRef {
  path: string;
  version: number;
  contentHash: string;
}

export type ChangeOp = 'create' | 'update' | 'move' | 'delete';

export interface ChangeInput extends DocumentRef {
  op: ChangeOp;
  /** Expected document version on the relay before applying; 0 for create. */
  baseVersion: number;
  version: number;
  /** Workspace-relative path. */
  path: string;
  /** SHA-256 of the document bytes (utf8). Empty for deletes. */
  contentHash: string;
  /** Document bytes for create/update; optional for move; absent for delete. */
  content?: string;
  /** Previous path for move operations. */
  previousPath?: string;
}

export interface ChangeRecord extends ChangeInput {
  /** Relay-allocated monotonic sequence for this change. */
  vaultSeq: number;
  /** Vault epoch in which the change was authored. */
  epoch: number;
  /** ISO 8601 UTC timestamp. */
  timestamp: string;
}

/** Every authenticated sync request must identify the vault lineage. */
export interface SyncIdentity {
  vaultId: string;
  epoch: number;
}

export interface SnapshotQuery {
  after?: string;
  limit?: number;
}

export interface SnapshotPage extends Snapshot {
  /** Stable upper bound for this bootstrap. */
  snapshotSeq: number;
  /** Opaque cursor for the next page, or null when complete. */
  nextCursor: string | null;
  /** Active tombstones are returned on the first page. */
  tombstones: TombstoneHeader[];
  /** Retired IDs are retained indefinitely. */
  retiredIds: DocumentRef[];
}

export interface DocumentContent {
  kind: DocumentKind;
  id: string;
  path: string;
  version: number;
  contentHash: string;
  content: string;
}

export interface Operation {
  /** Client-generated UUID for idempotency. */
  operationId: string;
  /** Per-device monotonic sequence. */
  deviceSeq: number;
  changes: ChangeRecord[];
}

export type MutationStatus = 'applied' | 'conflict' | 'rejected';

export interface MutationResult extends DocumentRef {
  status: MutationStatus;
  /** Relay document version after the mutation, when applied. */
  version?: number;
  /** Relay sequence assigned to the change, when applied. */
  vaultSeq?: number;
  /** Human-readable reason for conflict/rejection. */
  reason?: string;
  /** Machine-readable conflict/rejection code. */
  code?: string;
}

export interface OperationResult {
  operationId: string;
  deviceSeq: number;
  results: MutationResult[];
}

export interface PullResponse {
  vaultId: string;
  epoch: number;
  /** Opaque cursor derived from the last included vaultSeq. */
  cursor: string;
  changes: ChangeRecord[];
  bootstrapRequired: boolean;
  /** First change-log sequence still retained, if any. */
  earliestRetainedSeq: number | null;
  /** Last allocated vault sequence at the time of the read. */
  latestSeq: number;
}

export interface VaultIdentity {
  vaultId: string;
  epoch: number;
}

export interface TombstoneHeader extends DocumentRef {
  deletedAt: string;
  retainedUntil: string;
}

export interface Snapshot {
  vaultId: string;
  epoch: number;
  cursor: string;
  documents: DocumentHeader[];
  tombstones: TombstoneHeader[];
}
