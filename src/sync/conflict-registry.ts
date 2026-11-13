import type { DatabaseSync } from 'node:sqlite';
import type { ChangeRecord, DocumentKind, SyncIdentity } from './contracts.js';
import type { ApplyIntent, DocumentState, FileRevision } from './state.js';

export type ConflictStatus = 'open' | 'needs-recovery' | 'resolved-remote' | 'resolved-local';

export interface ConflictSummary extends SyncIdentity {
  schemaVersion: 1;
  conflictId: string;
  document: { kind: DocumentKind; id: string };
  status: ConflictStatus;
  resolutionDecisionId: string | null;
  applyStatus: 'pending' | 'committed' | 'conflict' | null;
  type: 'incoming-delete' | 'path-divergence' | 'content-divergence' | 'unknown';
  base: DocumentState | null;
  local: FileRevision | null;
  remote: { version: number; path: string | null; hash: string; operation: ChangeRecord['op'] | null };
  target: FileRevision | null;
  copy: { id: string | null; path: string | null; expectedHash: string | null; publicationRecorded: boolean | null } | null;
  mergedCopyCount: number;
  hasApplyIntent: boolean;
  hasBlockedApply: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  diagnostics: string[];
}

export interface ConflictPageOptions {
  limit?: number;
  after?: string;
  status?: ConflictStatus;
}

export interface ConflictPage {
  conflicts: ConflictSummary[];
  next: string | null;
}

type Key = [DocumentKind, string, number, string];

interface RegistryRow {
  kind: DocumentKind;
  id: string;
  version: number;
  contentHash: string;
  applyStatus: ConflictSummary['applyStatus'];
  status: ConflictStatus;
  resolutionDecisionId: string | null;
  mergedCopyCount: number;
  copyId: string | null;
  copyPath: string | null;
  ledgerCopyId: string | null;
  ledgerCopyPath: string | null;
  localPath: string | null;
  localHash: string | null;
  copyHash: string | null;
  published: number | null;
  intentJson: string | null;
  hasIntent: number;
  blockedJson: string | null;
  hasBlock: number;
  reason: string | null;
  blockedAt: string | null;
  updatedAt: string | null;
}

// Every join includes the full scoped revision key. Ordinary apply intents
// are intentionally absent unless a copy, block, or conflict ledger identifies them.
function projection(keyPredicate = '') {
  return `
WITH keys AS (
  SELECT vaultId, epoch, kind, id, version, contentHash FROM conflict_records_v1
    WHERE vaultId = :vaultId AND epoch = :epoch ${keyPredicate}
  UNION
  SELECT vaultId, epoch, kind, id, version, contentHash FROM blocked_apply_v1
    WHERE vaultId = :vaultId AND epoch = :epoch ${keyPredicate}
  UNION
  SELECT vaultId, epoch, kind, id, version, contentHash FROM apply_ledger
    WHERE vaultId = :vaultId AND epoch = :epoch ${keyPredicate}
      AND (conflictId IS NOT NULL OR conflictPath IS NOT NULL OR status = 'conflict')
), registry AS (
  SELECT k.kind, k.id, k.version, k.contentHash, a.status AS applyStatus,
    (SELECT count(*) FROM resolution_merged_v1 m JOIN resolution_decisions_v1 md
      ON md.vaultId = m.vaultId AND md.epoch = m.epoch AND md.decisionId = m.decisionId
      WHERE m.vaultId = k.vaultId AND m.epoch = k.epoch AND m.sourceKind = k.kind AND m.sourceId = k.id
        AND m.sourceVersion = k.version AND m.sourceHash = k.contentHash AND md.status = 'completed'
        AND md.action = 'save-merged-copy') AS mergedCopyCount,
    CASE WHEN d.status = 'completed' AND d.action = 'keep-local' THEN 'resolved-local'
      WHEN d.status = 'completed' AND d.action = 'keep-remote' THEN 'resolved-remote'
      WHEN b.id IS NULL AND a.status = 'committed' AND c.published = 1
      AND a.conflictId = c.conflictId AND a.conflictPath = c.conflictPath
      THEN 'open' ELSE 'needs-recovery' END AS status,
    d.decisionId AS resolutionDecisionId, c.conflictId AS copyId, c.conflictPath AS copyPath,
    a.conflictId AS ledgerCopyId, a.conflictPath AS ledgerCopyPath,
    c.localPath, c.localHash, c.copyHash, c.published,
    i.id IS NOT NULL AS hasIntent, b.id IS NOT NULL AS hasBlock,
    CASE WHEN json_valid(i.intentJson) THEN json_remove(i.intentJson, '$.change.content') END AS intentJson,
    CASE WHEN json_valid(b.changeJson) THEN json_remove(b.changeJson, '$.content') END AS blockedJson,
    b.reason, b.createdAt AS blockedAt, COALESCE(d.updatedAt, a.updatedAt) AS updatedAt
  FROM keys k
  LEFT JOIN apply_ledger a USING (vaultId, epoch, kind, id, version, contentHash)
  LEFT JOIN conflict_records_v1 c USING (vaultId, epoch, kind, id, version, contentHash)
  LEFT JOIN blocked_apply_v1 b USING (vaultId, epoch, kind, id, version, contentHash)
  LEFT JOIN apply_intent_v1 i USING (vaultId, epoch, kind, id, version, contentHash)
  LEFT JOIN resolution_consumed_v1 r USING (vaultId, epoch, kind, id, version, contentHash)
  LEFT JOIN resolution_decisions_v1 d ON d.vaultId = r.vaultId AND d.epoch = r.epoch AND d.decisionId = r.decisionId
)
SELECT * FROM registry`;
}

function encode(scope: SyncIdentity, key: Key): string {
  return Buffer.from(JSON.stringify([scope.vaultId, scope.epoch, ...key])).toString('base64url');
}

function decode(scope: SyncIdentity, id: string): Key {
  if (typeof id !== 'string' || id.length > 2048) throw new Error('Invalid conflict reference');
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid conflict reference');
  }
  if (!Array.isArray(parts) || parts.length !== 6) throw new Error('Invalid conflict reference');
  const [vaultId, epoch, kind, documentId, version, hash] = parts;
  if (vaultId !== scope.vaultId || epoch !== scope.epoch ||
      (kind !== 'note' && kind !== 'database') || typeof documentId !== 'string' ||
      !Number.isSafeInteger(version) || version < 0 ||
      typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) {
    throw new Error('Invalid conflict reference for this vault and epoch');
  }
  const key: Key = [kind, documentId, version, hash];
  if (encode(scope, key) !== id) throw new Error('Invalid conflict reference');
  return key;
}

export function conflictRevisionKey(scope: SyncIdentity, conflictId: string) {
  const [kind, id, version, contentHash] = decode(scope, conflictId);
  return { kind, id, version, contentHash };
}

export function conflictReference(scope: SyncIdentity, key: { kind: DocumentKind; id: string; version: number; contentHash: string }): string {
  return encode(validateScope(scope), [key.kind, key.id, key.version, key.contentHash]);
}

function keyParams(key: Key) {
  const [kind, id, version, contentHash] = key;
  return { kind, id, version, contentHash };
}

function validateScope(scope: SyncIdentity): SyncIdentity {
  if (typeof scope.vaultId !== 'string' || scope.vaultId.length === 0 ||
      !Number.isSafeInteger(scope.epoch) || scope.epoch < 1) {
    throw new Error('Invalid conflict vault or epoch');
  }
  return { vaultId: scope.vaultId, epoch: scope.epoch };
}

function summarize(scope: SyncIdentity, row: RegistryRow): ConflictSummary {
  const intent = row.intentJson === null ? null : JSON.parse(row.intentJson) as ApplyIntent | null;
  const blocked = row.blockedJson === null ? null : JSON.parse(row.blockedJson) as ChangeRecord | null;
  const change = blocked ?? intent?.change ?? null;
  const diagnostics: string[] = [];
  if (row.reason !== null && !['resolved-remote', 'resolved-local'].includes(row.status)) diagnostics.push(row.reason);
  if (row.applyStatus === null) diagnostics.push('Apply ledger entry is missing');
  if (row.copyId === null && (row.ledgerCopyId !== null || row.ledgerCopyPath !== null)) {
    diagnostics.push('Legacy copy reference has no verified reservation');
  }
  if (row.copyId !== null && (row.copyId !== row.ledgerCopyId || row.copyPath !== row.ledgerCopyPath)) {
    diagnostics.push('Copy reservation and apply ledger references differ');
  }
  if (change === null) diagnostics.push('Incoming revision path and operation are unavailable');
  if (row.published === 0) diagnostics.push('Copy publication is incomplete');
  if (row.hasIntent && intent?.change == null) diagnostics.push('Apply intent metadata is unreadable');
  if (row.hasBlock && blocked === null) diagnostics.push('Blocked change metadata is unreadable');
  if (row.applyStatus === 'conflict' && !row.hasBlock) diagnostics.push('Apply conflict has no recorded block reason');

  if (row.mergedCopyCount > 0) diagnostics.push('Merged copies were created. The original revisions have not been reconciled by that action.');
  const local = row.localPath !== null && row.localHash !== null ? { path: row.localPath, hash: row.localHash } :
    intent?.source ?? null;
  const type = change?.op === 'delete' ? 'incoming-delete' :
    local && change && local.path !== change.path ? 'path-divergence' :
    local && change && local.hash !== row.contentHash ? 'content-divergence' : 'unknown';
  const id = row.copyId ?? row.ledgerCopyId;
  const path = row.copyPath ?? row.ledgerCopyPath;
  return {
    ...scope,
    schemaVersion: 1,
    conflictId: encode(scope, [row.kind, row.id, row.version, row.contentHash]),
    document: { kind: row.kind, id: row.id },
    status: row.status,
    applyStatus: row.applyStatus,
    resolutionDecisionId: row.resolutionDecisionId,
    type,
    base: intent?.base ?? null,
    local,
    remote: { version: row.version, path: change?.path ?? null, hash: row.contentHash, operation: change?.op ?? null },
    target: intent?.target ?? null,
    copy: id === null && path === null ? null : {
      id, path, expectedHash: row.copyHash,
      publicationRecorded: row.published === null ? null : row.published === 1,
    },
    mergedCopyCount: row.mergedCopyCount,
    hasApplyIntent: row.hasIntent === 1,
    hasBlockedApply: row.hasBlock === 1,
    createdAt: [intent?.createdAt, row.blockedAt].filter((value): value is string => typeof value === 'string').sort()[0] ?? null,
    updatedAt: row.updatedAt,
    diagnostics,
  };
}

export function listConflicts(db: DatabaseSync, identity: SyncIdentity, options: ConflictPageOptions = {}): ConflictPage {
  const scope = validateScope(identity);
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid conflict page size');
  if (options.status !== undefined && options.status !== 'open' && options.status !== 'needs-recovery' && options.status !== 'resolved-remote' && options.status !== 'resolved-local') {
    throw new Error('Invalid conflict status');
  }
  const cursor = options.after === undefined ? undefined : keyParams(decode(scope, options.after));
  const rows = db.prepare(`${projection(cursor === undefined ? '' :
      'AND (kind, id, version, contentHash) > (:kind, :id, :version, :contentHash)')}
    WHERE (:status IS NULL OR status = :status)
    ORDER BY kind, id, version, contentHash LIMIT :limit`
  ).all({ ...scope, ...cursor, status: options.status ?? null, limit: limit + 1 }) as unknown as RegistryRow[];
  const conflicts = rows.slice(0, limit).map((row) => summarize(scope, row));
  return { conflicts, next: rows.length > limit ? conflicts[limit - 1]!.conflictId : null };
}

export function getConflictDetails(db: DatabaseSync, identity: SyncIdentity, conflictId: string): ConflictSummary | null {
  const scope = validateScope(identity);
  const key = keyParams(decode(scope, conflictId));
  const row = db.prepare(projection(
    'AND (kind, id, version, contentHash) = (:kind, :id, :version, :contentHash)',
  )).get({ ...scope, ...key }) as unknown as RegistryRow | undefined;
  return row === undefined ? null : summarize(scope, row);
}
