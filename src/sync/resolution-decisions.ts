import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { isUuidV4 } from '../domain/ids.js';
import { validateNotePath } from '../domain/paths.js';
import { parseNote, serializeNote } from '../format/note-format.js';
import { parseDatabase, serializeDatabase } from '../database/schema.js';
import type { DocumentKind, SyncIdentity } from './contracts.js';
import type { DocumentState } from './state.js';
import { foldPath } from './paths.js';
import { getConflictDetails } from './conflict-registry.js';

export const RESOLUTION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS resolution_decisions_v1 (
    vaultId TEXT NOT NULL,
    epoch INTEGER NOT NULL CHECK (epoch > 0),
    decisionId TEXT NOT NULL,
    conflictId TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('keep-local', 'keep-remote', 'save-merged-copy')),
    intentJson TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('prepared', 'applying', 'completed', 'needs-recovery', 'rejected-stale')),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    completedAt TEXT,
    resultJson TEXT,
    diagnostic TEXT,
    PRIMARY KEY (vaultId, epoch, decisionId)
  );
  DROP INDEX IF EXISTS resolution_one_active_v1;
  CREATE UNIQUE INDEX IF NOT EXISTS resolution_one_active_v2
    ON resolution_decisions_v1 (vaultId, epoch, conflictId)
    WHERE status IN ('prepared', 'applying', 'needs-recovery') OR (status = 'completed' AND action <> 'save-merged-copy');
  CREATE TABLE IF NOT EXISTS resolution_consumed_v1 (
    vaultId TEXT NOT NULL, epoch INTEGER NOT NULL,
    kind TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, contentHash TEXT NOT NULL,
    decisionId TEXT NOT NULL,
    PRIMARY KEY (vaultId, epoch, kind, id, version, contentHash),
    UNIQUE (vaultId, epoch, decisionId)
  );
  CREATE TABLE IF NOT EXISTS resolution_outbox_v1 (
    vaultId TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    decisionId TEXT NOT NULL,
    operationId TEXT NOT NULL UNIQUE,
    deviceId TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN ('reserved', 'sending')),
    receiptJson TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (vaultId, epoch, decisionId)
  );
  CREATE TABLE IF NOT EXISTS resolution_merged_v1 (
    vaultId TEXT NOT NULL, epoch INTEGER NOT NULL, decisionId TEXT NOT NULL,
    sourceKind TEXT NOT NULL, sourceId TEXT NOT NULL, sourceVersion INTEGER NOT NULL, sourceHash TEXT NOT NULL,
    kind TEXT NOT NULL, id TEXT NOT NULL, path TEXT NOT NULL, pathKey TEXT NOT NULL, contentHash TEXT NOT NULL,
    dev TEXT, ino TEXT, stagingPath TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    PRIMARY KEY (vaultId, epoch, decisionId),
    UNIQUE (vaultId, epoch, kind, id), UNIQUE (vaultId, epoch, pathKey)
  );
  CREATE INDEX IF NOT EXISTS resolution_merged_source_v1 ON resolution_merged_v1
    (vaultId, epoch, sourceKind, sourceId, sourceVersion, sourceHash);
  CREATE INDEX IF NOT EXISTS resolution_document_v1
    ON resolution_decisions_v1 (vaultId, epoch, json_extract(intentJson, '$.document.kind'), json_extract(intentJson, '$.document.id'));
  CREATE INDEX IF NOT EXISTS resolution_history_v1
    ON resolution_decisions_v1 (vaultId, epoch, conflictId, decisionId);
`;

export type ResolutionAction = 'keep-local' | 'keep-remote' | 'save-merged-copy';
export type ResolutionStatus = 'prepared' | 'applying' | 'completed' | 'needs-recovery' | 'rejected-stale';

/** Exact UTF-8 bytes retained for later verification and publication. */
export interface ResolutionSnapshot {
  id: string;
  path: string;
  contentHash: string;
  content: string;
}

export interface ResolutionIntent {
  schemaVersion: 1;
  decisionId: string;
  conflictId: string;
  document: { kind: DocumentKind; id: string };
  action: ResolutionAction;
  expectedBase: DocumentState | null;
  expectedLocal: ResolutionSnapshot | null;
  expectedRemote: {
    version: number;
    path: string;
    contentHash: string;
    operation: 'create' | 'update' | 'move' | 'delete';
    content: string | null;
  };
  expectedCopy: ResolutionSnapshot | null;
  target: ResolutionSnapshot | null;
}

export interface ResolutionResult {
  id: string;
  path: string;
  contentHash: string;
  relayVersion: number | null;
}

export interface ResolutionDecision extends SyncIdentity {
  intent: ResolutionIntent;
  status: ResolutionStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  result: ResolutionResult | null;
  diagnostic: string | null;
}

export interface ResolutionHistoryEntry extends SyncIdentity {
  decisionId: string;
  conflictId: string;
  action: ResolutionAction;
  status: ResolutionStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  result: ResolutionResult | null;
  diagnostic: string | null;
}

interface DecisionRow {
  vaultId: string;
  epoch: number;
  intentJson: string;
  status: ResolutionStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  resultJson: string | null;
  diagnostic: string | null;
}

function hash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function scopeParams(scope: SyncIdentity) {
  if (typeof scope.vaultId !== 'string' || scope.vaultId.length === 0 ||
      !Number.isSafeInteger(scope.epoch) || scope.epoch < 1) {
    throw new Error('Invalid resolution vault or epoch');
  }
  return { vaultId: scope.vaultId, epoch: scope.epoch };
}

function snapshot(kind: DocumentKind, value: ResolutionSnapshot | null): ResolutionSnapshot | null {
  if (value === null) return null;
  if (!isUuidV4(value.id) || typeof value.content !== 'string' || hash(value.content) !== value.contentHash) {
    throw new Error('Invalid resolution snapshot identity or content hash');
  }
  const parsed = kind === 'note' ? parseNote(value.content, value.path) : parseDatabase(value.content);
  if (parsed.id !== value.id) throw new Error('Resolution snapshot document ID mismatch');
  if (kind === 'note') validateNotePath(value.path);
  else if (value.path !== `databases/${value.id}.json`) throw new Error('Invalid database snapshot path');
  return { id: value.id, path: value.path, contentHash: value.contentHash, content: value.content };
}

export function normalizeResolutionIntent(input: ResolutionIntent): ResolutionIntent {
  if (input.schemaVersion !== 1 || !isUuidV4(input.decisionId) ||
      (input.document.kind !== 'note' && input.document.kind !== 'database') ||
      !isUuidV4(input.document.id) ||
      !['keep-local', 'keep-remote', 'save-merged-copy'].includes(input.action)) {
    throw new Error('Invalid resolution intent');
  }
  const kind = input.document.kind;
  const local = snapshot(kind, input.expectedLocal);
  const copy = snapshot(kind, input.expectedCopy);
  const target = snapshot(kind, input.target);
  if (local !== null && local.id !== input.document.id) throw new Error('Local snapshot identity mismatch');
  const remote = input.expectedRemote;
  if (!Number.isSafeInteger(remote.version) || remote.version < 1 ||
      !['create', 'update', 'move', 'delete'].includes(remote.operation)) {
    throw new Error('Invalid remote resolution revision');
  }
  if (remote.operation === 'delete') {
    if (remote.content !== null || remote.contentHash !== hash('')) throw new Error('Invalid deletion snapshot');
  } else {
    if (remote.content === null) throw new Error('Remote snapshot content is required');
    snapshot(kind, { id: input.document.id, path: remote.path, contentHash: remote.contentHash, content: remote.content });
  }
  if (input.action === 'keep-local') {
    if (remote.operation === 'delete') throw new Error('Keep-local for retired IDs requires explicit restore semantics');
    if (local === null || target === null || JSON.stringify(local) !== JSON.stringify(target)) {
      throw new Error('Keep-local must retain the exact observed local snapshot');
    }
  }
  if (input.action === 'keep-remote') {
    if (remote.operation === 'delete') {
      if (target !== null) throw new Error('Keep-remote deletion must have no target');
    } else {
      const expected = kind === 'note'
        ? serializeNote(parseNote(remote.content!, remote.path))
        : serializeDatabase(parseDatabase(remote.content!));
      if (target === null || target.id !== input.document.id || target.path !== remote.path ||
          target.content !== expected) throw new Error('Keep-remote target does not match the remote snapshot');
    }
  }
  if (input.action === 'save-merged-copy' &&
      (target === null || target.id === input.document.id || target.id === copy?.id ||
       [local?.path, copy?.path, remote.path].some((path) => path !== undefined && foldPath(path) === foldPath(target.path)))) {
    throw new Error('Merged copy requires a new document identity and destination');
  }
  const base = input.expectedBase;
  return {
    schemaVersion: 1,
    decisionId: input.decisionId,
    conflictId: input.conflictId,
    document: { kind, id: input.document.id },
    action: input.action,
    expectedBase: base === null ? null : {
      kind: base.kind, id: base.id, version: base.version, contentHash: base.contentHash,
      path: base.path, lastVaultSeq: base.lastVaultSeq,
    },
    expectedLocal: local,
    expectedRemote: {
      version: remote.version, path: remote.path, contentHash: remote.contentHash,
      operation: remote.operation, content: remote.content,
    },
    expectedCopy: copy,
    target,
  };
}

function decision(row: DecisionRow): ResolutionDecision {
  return {
    vaultId: row.vaultId, epoch: row.epoch, intent: JSON.parse(row.intentJson) as ResolutionIntent,
    status: row.status, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt,
    completedAt: row.completedAt, result: row.resultJson === null ? null : JSON.parse(row.resultJson) as ResolutionResult,
    diagnostic: row.diagnostic,
  };
}

export function getResolutionDecision(db: DatabaseSync, scope: SyncIdentity, decisionId: string): ResolutionDecision | null {
  if (!isUuidV4(decisionId)) throw new Error('Invalid resolution decision ID');
  const row = db.prepare(
    'SELECT * FROM resolution_decisions_v1 WHERE vaultId = :vaultId AND epoch = :epoch AND decisionId = :decisionId',
  ).get({ ...scopeParams(scope), decisionId }) as unknown as DecisionRow | undefined;
  return row === undefined ? null : decision(row);
}

/** Caller owns the SQLite transaction. This records intent and performs no filesystem writes. */
export function prepareResolutionDecision(
  db: DatabaseSync, scope: SyncIdentity, input: ResolutionIntent, now: string,
): ResolutionDecision {
  const intent = normalizeResolutionIntent(input);
  const prior = getResolutionDecision(db, scope, intent.decisionId);
  if (prior !== null) {
    if (JSON.stringify(prior.intent) !== JSON.stringify(intent)) throw new Error('Decision ID already has a different intent');
    return prior;
  }
  const conflict = getConflictDetails(db, scope, intent.conflictId);
  if (conflict === null || conflict.document.kind !== intent.document.kind || conflict.document.id !== intent.document.id) {
    throw new Error('Conflict is unavailable for this vault and epoch');
  }
  const remote = intent.expectedRemote;
  if (conflict.remote.version !== remote.version || conflict.remote.path !== remote.path ||
      conflict.remote.hash !== remote.contentHash || conflict.remote.operation !== remote.operation ||
      JSON.stringify(conflict.base) !== JSON.stringify(intent.expectedBase)) {
    throw new Error('Resolution expectations differ from the recorded conflict');
  }
  if (conflict.copy !== null &&
      (intent.expectedCopy === null || !conflict.copy.publicationRecorded ||
       conflict.copy.id !== intent.expectedCopy.id || conflict.copy.path !== intent.expectedCopy.path ||
       conflict.copy.expectedHash !== intent.expectedCopy.contentHash)) {
    throw new Error('The conflict copy requires verification before preparing this decision');
  }
  if (conflict.copy === null && intent.expectedCopy !== null) throw new Error('Conflict has no recorded copy');
  const occupied = db.prepare(
    `SELECT decisionId FROM resolution_decisions_v1 WHERE vaultId = :vaultId AND epoch = :epoch
      AND conflictId = :conflictId AND (status IN ('prepared', 'applying', 'needs-recovery') OR (status = 'completed' AND action <> 'save-merged-copy'))`,
  ).get({ ...scopeParams(scope), conflictId: intent.conflictId });
  if (occupied !== undefined) throw new Error('Conflict already has an active or completed resolution decision');
  db.prepare(
    `INSERT INTO resolution_decisions_v1
      (vaultId, epoch, decisionId, conflictId, action, intentJson, status, revision, createdAt, updatedAt)
     VALUES (:vaultId, :epoch, :decisionId, :conflictId, :action, :intentJson, 'prepared', 0, :now, :now)`,
  ).run({ ...scopeParams(scope), decisionId: intent.decisionId, conflictId: intent.conflictId,
    action: intent.action, intentJson: JSON.stringify(intent), now });
  return getResolutionDecision(db, scope, intent.decisionId)!;
}

export function listResolutionHistory(
  db: DatabaseSync, scope: SyncIdentity, conflictId: string, limit = 50, after?: string,
): { decisions: ResolutionHistoryEntry[]; next: string | null } {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (after !== undefined && !isUuidV4(after))) {
    throw new Error('Invalid resolution history pagination');
  }
  // Validate the opaque reference against the supplied lineage.
  getConflictDetails(db, scope, conflictId);
  const rows = db.prepare(
    `SELECT vaultId, epoch, decisionId, conflictId, action, status, revision, createdAt, updatedAt,
       completedAt, resultJson, diagnostic FROM resolution_decisions_v1
       WHERE vaultId = :vaultId AND epoch = :epoch AND conflictId = :conflictId
       AND decisionId > :after ORDER BY decisionId LIMIT :limit`,
  ).all({ ...scopeParams(scope), conflictId, after: after ?? '', limit: limit + 1 }) as unknown as
    Array<Omit<ResolutionHistoryEntry, 'result'> & { resultJson: string | null }>;
  const decisions = rows.slice(0, limit).map(({ resultJson, ...row }) => ({
    ...row, result: resultJson === null ? null : JSON.parse(resultJson) as ResolutionResult,
  }));
  return { decisions, next: rows.length > limit ? decisions[limit - 1]!.decisionId : null };
}

export interface ResolutionTransition {
  expectedRevision: number;
  status: Exclude<ResolutionStatus, 'prepared'>;
  result?: ResolutionResult | null;
  diagnostic?: string;
}

/** Journal transition only. The executor must verify filesystem evidence before calling. */
export function transitionResolutionDecision(
  db: DatabaseSync, scope: SyncIdentity, decisionId: string, transition: ResolutionTransition, now: string,
): ResolutionDecision {
  const current = getResolutionDecision(db, scope, decisionId);
  if (current === null) throw new Error('Resolution decision is unavailable');
  const suppliedResult = transition.result;
  const result = suppliedResult == null ? null : {
    id: suppliedResult.id, path: suppliedResult.path, contentHash: suppliedResult.contentHash,
    relayVersion: suppliedResult.relayVersion,
  };
  if (current.status === 'completed') {
    if (transition.status === 'completed' && JSON.stringify(current.result) === JSON.stringify(result)) return current;
    throw new Error('Completed resolution is immutable');
  }
  if (!Number.isSafeInteger(transition.expectedRevision) || current.revision !== transition.expectedRevision) {
    throw new Error('Resolution decision revision changed');
  }
  const allowed: Record<ResolutionStatus, ResolutionStatus[]> = {
    prepared: ['applying', 'rejected-stale', 'needs-recovery'],
    applying: ['completed', 'needs-recovery', 'rejected-stale'],
    'needs-recovery': ['applying', 'rejected-stale'],
    completed: [],
    'rejected-stale': [],
  };
  if (!allowed[current.status].includes(transition.status)) throw new Error('Invalid resolution lifecycle transition');
  if (transition.status === 'completed') {
    const target = current.intent.target;
    if (target === null ? result !== null :
      result === null || result.id !== target.id || result.path !== target.path ||
      result.contentHash !== target.contentHash ||
      (result.relayVersion !== null && (!Number.isSafeInteger(result.relayVersion) || result.relayVersion < 1))) {
      throw new Error('Resolution result differs from its recorded target');
    }
  } else if (result !== null) {
    throw new Error('An incomplete decision cannot have a completed result');
  }
  if (['needs-recovery', 'rejected-stale'].includes(transition.status) && !transition.diagnostic?.trim()) {
    throw new Error('Resolution recovery requires a diagnostic');
  }
  const update = db.prepare(
    `UPDATE resolution_decisions_v1 SET status = :status, revision = revision + 1,
      updatedAt = :now, completedAt = :completedAt, resultJson = :resultJson, diagnostic = :diagnostic
      WHERE vaultId = :vaultId AND epoch = :epoch AND decisionId = :decisionId AND revision = :revision`,
  ).run({ ...scopeParams(scope), decisionId, revision: current.revision, status: transition.status, now,
    completedAt: transition.status === 'completed' ? now : null,
    resultJson: result === null ? null : JSON.stringify(result), diagnostic: transition.diagnostic ?? null });
  if (update.changes !== 1) throw new Error('Resolution decision revision changed');
  return getResolutionDecision(db, scope, decisionId)!;
}
