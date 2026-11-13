/**
 * Local sync state. Kept outside Markdown and outside the relay.
 *
 * SQLite is used for atomic outbox, apply-ledger, cursor, and document-base
 * transitions. The relay remains authoritative for remote revisions.
 */

import { DatabaseSync } from 'node:sqlite';
import { foldPath } from './paths.js';
import {
  RESOLUTION_SCHEMA, getResolutionDecision, listResolutionHistory, prepareResolutionDecision,
  transitionResolutionDecision, type ResolutionIntent, type ResolutionTransition, type ResolutionDecision, type ResolutionResult,
} from './resolution-decisions.js';
import { conflictRevisionKey, getConflictDetails, listConflicts, type ConflictPageOptions } from './conflict-registry.js';
import type { ChangeRecord, ChangeInput, DocumentKind, SyncIdentity, OperationResult } from './contracts.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS outbox (
    operationId TEXT PRIMARY KEY,
    deviceSeq INTEGER NOT NULL UNIQUE,
    payloadJson TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','applied','conflicted','failed')),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    lastError TEXT
  );

  CREATE TABLE IF NOT EXISTS apply_ledger (
    vaultId TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    contentHash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','committed','conflict')),
    conflictId TEXT,
    conflictPath TEXT,
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (vaultId, epoch, kind, id, version, contentHash)
  );

  CREATE INDEX IF NOT EXISTS apply_ledger_conflicts_v1
    ON apply_ledger (vaultId, epoch, kind, id, version, contentHash)
    WHERE conflictId IS NOT NULL OR conflictPath IS NOT NULL OR status = 'conflict';

  CREATE TABLE IF NOT EXISTS conflict_records_v1 (
    vaultId TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    contentHash TEXT NOT NULL,
    conflictId TEXT NOT NULL UNIQUE,
    conflictPath TEXT NOT NULL,
    localPath TEXT NOT NULL,
    localHash TEXT NOT NULL,
    copyHash TEXT NOT NULL,
    copyText TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
    PRIMARY KEY (vaultId, epoch, kind, id, version, contentHash)
  );

  CREATE TABLE IF NOT EXISTS blocked_apply_v1 (
    vaultId TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    contentHash TEXT NOT NULL,
    changeJson TEXT NOT NULL,
    reason TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    PRIMARY KEY (vaultId, epoch, kind, id, version, contentHash)
  );

  CREATE TABLE IF NOT EXISTS apply_intent_v1 (
    vaultId TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    contentHash TEXT NOT NULL,
    intentJson TEXT NOT NULL,
    PRIMARY KEY (vaultId, epoch, kind, id, version, contentHash)
  );

  CREATE TABLE IF NOT EXISTS document_state (
    vaultId TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    contentHash TEXT NOT NULL,
    path TEXT NOT NULL,
    lastVaultSeq INTEGER NOT NULL,
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (vaultId, epoch, kind, id)
  );
`;

export interface DocumentState {
  kind: DocumentKind;
  id: string;
  version: number;
  contentHash: string;
  path: string;
  lastVaultSeq: number;
}

export interface ApplyLedgerEntry {
  status: 'pending' | 'committed' | 'conflict';
  conflictId?: string;
  conflictPath?: string;
}

type ConflictKey = { kind: DocumentKind; id: string; version: number; contentHash: string };

export interface FileRevision {
  path: string;
  hash: string;
}

export interface ApplyIntent {
  change: ChangeRecord;
  base: DocumentState | null;
  source: FileRevision | null;
  target: FileRevision | null;
  createdAt: string;
}

export interface ConflictRecord {
  conflictId: string;
  conflictPath: string;
  localPath: string;
  localHash: string;
  copyHash: string;
  copyText: string;
  published: 0 | 1;
}

export interface OutboxOperation {
  operationId: string;
  deviceSeq: number;
  changes: ChangeInput[];
}

export interface ResolutionOutbox extends OutboxOperation {
  deviceId: string;
  stage: 'reserved' | 'sending';
  receipt: Pick<OperationResult, 'deviceSeq' | 'results'> | null;
  outboxStatus: 'pending' | 'applied' | 'conflicted' | 'failed';
}

export interface MergedPublication {
  kind: DocumentKind;
  id: string;
  path: string;
  contentHash: string;
  dev: string | null;
  ino: string | null;
  stagingPath: string | null;
}

export class SyncStateStore {
  private db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(path: string): SyncStateStore {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA journal_mode = WAL;');
    const store = new SyncStateStore(db);
    store.transaction(() => store.db.exec(SCHEMA + RESOLUTION_SCHEMA));
    return store;
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  getDocumentState(vaultId: string, epoch: number, kind: DocumentKind, id: string): DocumentState | undefined {
    const row = this.db
      .prepare(
        `SELECT kind, id, version, contentHash, path, lastVaultSeq
         FROM document_state WHERE vaultId = ? AND epoch = ? AND kind = ? AND id = ?`,
      )
      .get(vaultId, epoch, kind, id) as DocumentState | undefined;
    return row;
  }

  setDocumentState(vaultId: string, epoch: number, state: DocumentState): void {
    this.db
      .prepare(
        `INSERT INTO document_state
          (vaultId, epoch, kind, id, version, contentHash, path, lastVaultSeq, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(vaultId, epoch, kind, id) DO UPDATE SET
           version = excluded.version,
           contentHash = excluded.contentHash,
           path = excluded.path,
           lastVaultSeq = excluded.lastVaultSeq,
           updatedAt = excluded.updatedAt`,
      )
      .run(
        vaultId,
        epoch,
        state.kind,
        state.id,
        state.version,
        state.contentHash,
        state.path,
        state.lastVaultSeq,
        new Date().toISOString(),
      );
  }

  deleteDocumentState(vaultId: string, epoch: number, kind: DocumentKind, id: string): void {
    this.db
      .prepare('DELETE FROM document_state WHERE vaultId = ? AND epoch = ? AND kind = ? AND id = ?')
      .run(vaultId, epoch, kind, id);
  }

  nextDeviceSeq(): number {
    return this.transaction(() => {
      const current = Number.parseInt(this.getMeta('device_seq') ?? '0', 10);
      const next = Number.isInteger(current) && current > 0 ? current + 1 : 1;
      this.setMeta('device_seq', String(next));
      return next;
    });
  }

  enqueue(operationId: string, changes: ChangeInput[]): OutboxOperation {
    return this.transaction(() => this.enqueueUnlocked(operationId, changes));
  }

  private enqueueUnlocked(operationId: string, changes: ChangeInput[]): OutboxOperation {
    const current = Number.parseInt(this.getMeta('device_seq') ?? '0', 10);
    const deviceSeq = Number.isInteger(current) && current > 0 ? current + 1 : 1;
    this.setMeta('device_seq', String(deviceSeq));
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO outbox (operationId, deviceSeq, payloadJson, status, createdAt, updatedAt)
         VALUES (?, ?, ?, 'pending', ?, ?)`,
      )
      .run(operationId, deviceSeq, JSON.stringify(changes), now, now);
    return { operationId, deviceSeq, changes };
  }


  pendingOperations(): OutboxOperation[] {
    const rows = this.db
      .prepare(
        `SELECT operationId, deviceSeq, payloadJson FROM outbox
         WHERE status = 'pending' ORDER BY deviceSeq`,
      )
      .all() as Array<{ operationId: string; deviceSeq: number; payloadJson: string }>;
    return rows.map((row) => ({
      operationId: row.operationId,
      deviceSeq: row.deviceSeq,
      changes: JSON.parse(row.payloadJson) as ChangeInput[],
    }));
  }

  markApplied(operationId: string): void {
    this.markOutbox(operationId, 'applied', null);
  }

  markConflicted(operationId: string, reason: string): void {
    this.markOutbox(operationId, 'conflicted', reason);
  }

  markFailed(operationId: string, reason: string): void {
    this.markOutbox(operationId, 'failed', reason);
  }

  getResolutionForDocument(scope: SyncIdentity, kind: DocumentKind, id: string): ResolutionDecision | null {
    const row = this.db.prepare(
      `SELECT decisionId FROM resolution_decisions_v1 WHERE vaultId = ? AND epoch = ?
        AND json_extract(intentJson, '$.document.kind') = ? AND json_extract(intentJson, '$.document.id') = ?
        AND status IN ('prepared', 'applying', 'needs-recovery') ORDER BY decisionId LIMIT 1`,
    ).get(scope.vaultId, scope.epoch, kind, id) as { decisionId: string } | undefined;
    return row === undefined ? null : this.getResolutionDecision(scope, row.decisionId);
  }

  hasPendingDocument(kind: DocumentKind, id: string): boolean {
    return this.db.prepare(
      `SELECT 1 FROM outbox, json_each(outbox.payloadJson) change
        WHERE outbox.status = 'pending' AND json_extract(change.value, '$.kind') = ?
        AND json_extract(change.value, '$.id') = ? LIMIT 1`,
    ).get(kind, id) !== undefined;
  }

  isResolutionConsumed(scope: SyncIdentity, key: ConflictKey): boolean {
    return this.db.prepare(
      `SELECT 1 FROM resolution_consumed_v1 c JOIN resolution_decisions_v1 d
        ON d.vaultId = c.vaultId AND d.epoch = c.epoch AND d.decisionId = c.decisionId
        WHERE c.vaultId = ? AND c.epoch = ? AND c.kind = ? AND c.id = ? AND c.version = ?
        AND c.contentHash = ? AND d.status = 'completed' AND d.action IN ('keep-remote', 'keep-local')`,
    ).get(scope.vaultId, scope.epoch, key.kind, key.id, key.version, key.contentHash) !== undefined;
  }

  recordedChange(scope: SyncIdentity, key: ConflictKey): ChangeRecord | null {
    const block = this.db.prepare(
      `SELECT changeJson FROM blocked_apply_v1 WHERE vaultId = ? AND epoch = ?
        AND kind = ? AND id = ? AND version = ? AND contentHash = ?`,
    ).get(scope.vaultId, scope.epoch, key.kind, key.id, key.version, key.contentHash) as { changeJson: string } | undefined;
    return block === undefined ? this.getApplyIntent(scope.vaultId, scope.epoch, key)?.change ?? null :
      JSON.parse(block.changeJson) as ChangeRecord;
  }

  /** Caller holds the vault write session. No cursor is advanced here. */
  completeKeepRemote(scope: SyncIdentity, decisionId: string, revision: number, change: ChangeRecord, result: ResolutionResult | null) {
    return this.transaction(() => {
      const current = this.getResolutionDecision(scope, decisionId);
      if (current === null || current.intent.action !== 'keep-remote' || current.status !== 'applying') {
        throw new Error('Keep-remote completion requires an applying decision');
      }
      const key = conflictRevisionKey(scope, current.intent.conflictId);
      if (key.kind !== change.kind || key.id !== change.id || key.version !== change.version ||
          key.contentHash !== change.contentHash ||
          (result !== null && result.relayVersion !== change.version)) {
        throw new Error('Consumed revision differs from the resolution decision');
      }
      const completed = transitionResolutionDecision(this.db, scope, decisionId,
        { expectedRevision: revision, status: 'completed', result }, new Date().toISOString());
      this.db.prepare(
        `INSERT INTO resolution_consumed_v1 (vaultId, epoch, kind, id, version, contentHash, decisionId)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(scope.vaultId, scope.epoch, change.kind, change.id, change.version, change.contentHash, decisionId);
      this.beginApply(scope.vaultId, scope.epoch, change);
      this.markApplyCommitted(scope.vaultId, scope.epoch, change);
      if (change.op === 'delete') this.deleteDocumentState(scope.vaultId, scope.epoch, change.kind, change.id);
      else this.setDocumentState(scope.vaultId, scope.epoch, {
        kind: change.kind, id: change.id, version: change.version, path: change.path,
        contentHash: change.contentHash, lastVaultSeq: change.vaultSeq,
      });
      return completed;
    });
  }

  hasPendingOperations(): boolean {
    return this.db.prepare("SELECT 1 FROM outbox WHERE status = 'pending' LIMIT 1").get() !== undefined;
  }

  resolutionForOutbox(operationId: string): { vaultId: string; epoch: number; decisionId: string } | null {
    return this.db.prepare(
      'SELECT vaultId, epoch, decisionId FROM resolution_outbox_v1 WHERE operationId = ?',
    ).get(operationId) as { vaultId: string; epoch: number; decisionId: string } | undefined ?? null;
  }

  getResolutionOutbox(scope: SyncIdentity, decisionId: string): ResolutionOutbox | null {
    const row = this.db.prepare(
      `SELECT r.deviceId, r.stage, r.receiptJson, o.operationId, o.deviceSeq, o.payloadJson, o.status
       FROM resolution_outbox_v1 r JOIN outbox o ON o.operationId = r.operationId
       WHERE r.vaultId = ? AND r.epoch = ? AND r.decisionId = ?`,
    ).get(scope.vaultId, scope.epoch, decisionId) as {
      deviceId: string; stage: ResolutionOutbox['stage']; receiptJson: string | null;
      operationId: string; deviceSeq: number; payloadJson: string; status: ResolutionOutbox['outboxStatus'];
    } | undefined;
    return row === undefined ? null : {
      deviceId: row.deviceId, stage: row.stage,
      receipt: row.receiptJson === null ? null : JSON.parse(row.receiptJson),
      operationId: row.operationId, deviceSeq: row.deviceSeq,
      changes: JSON.parse(row.payloadJson), outboxStatus: row.status,
    };
  }

  reserveKeepLocalOutbox(scope: SyncIdentity, decisionId: string, deviceId: string, operationId: string): ResolutionOutbox {
    return this.transaction(() => {
      const prior = this.getResolutionOutbox(scope, decisionId);
      if (prior !== null) return prior;
      const decision = this.getResolutionDecision(scope, decisionId);
      if (decision === null || decision.intent.action !== 'keep-local' || decision.status !== 'applying' ||
          decision.intent.target === null || decision.intent.expectedRemote.operation === 'delete') {
        throw new Error('Conditional outbox reservation requires an applying live keep-local decision');
      }
      if (this.hasPendingOperations()) throw new Error('Reconcile earlier outbox operations before reserving a resolution');
      const { intent } = decision;
      const local = intent.target!;
      this.enqueueUnlocked(operationId, [{
        kind: intent.document.kind, id: intent.document.id, op: 'update',
        baseVersion: intent.expectedRemote.version, version: intent.expectedRemote.version + 1,
        path: local.path, contentHash: local.contentHash, content: local.content,
      }]);
      const now = new Date().toISOString();
      this.db.prepare(
        `INSERT INTO resolution_outbox_v1
          (vaultId, epoch, decisionId, operationId, deviceId, stage, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?)`,
      ).run(scope.vaultId, scope.epoch, decisionId, operationId, deviceId, now, now);
      return this.getResolutionOutbox(scope, decisionId)!;
    });
  }

  markResolutionSending(scope: SyncIdentity, decisionId: string): void {
    const update = this.db.prepare(
      `UPDATE resolution_outbox_v1 SET stage = 'sending', updatedAt = ?
        WHERE vaultId = ? AND epoch = ? AND decisionId = ? AND receiptJson IS NULL`,
    ).run(new Date().toISOString(), scope.vaultId, scope.epoch, decisionId);
    if (update.changes !== 1) throw new Error('Conditional outbox reservation is unavailable');
  }

  finishKeepLocalPush(scope: SyncIdentity, decisionId: string, receipt: NonNullable<ResolutionOutbox['receipt']>,
    consistent: boolean, diagnostic: string | null): ResolutionDecision {
    return this.transaction(() => {
      const decision = this.getResolutionDecision(scope, decisionId);
      const delivery = this.getResolutionOutbox(scope, decisionId);
      if (decision === null || delivery === null || delivery.stage !== 'sending' || decision.intent.action !== 'keep-local' ||
          !['applying', 'needs-recovery'].includes(decision.status)) throw new Error('Keep-local receipt has no active decision');
      if (delivery.receipt !== null && JSON.stringify(delivery.receipt) !== JSON.stringify(receipt)) {
        throw new Error('Conditional push receipt changed');
      }
      const result = receipt.results[0];
      const intent = decision.intent;
      const local = intent.target!;
      const incoming = conflictRevisionKey(scope, intent.conflictId);
      if (incoming.kind !== intent.document.kind || incoming.id !== intent.document.id ||
          incoming.version !== intent.expectedRemote.version || incoming.contentHash !== intent.expectedRemote.contentHash) {
        throw new Error('Keep-local consumed revision differs from its decision');
      }
      if (receipt.deviceSeq !== delivery.deviceSeq || receipt.results.length !== 1 ||
          result?.kind !== intent.document.kind || result.id !== intent.document.id ||
          !['applied', 'conflict', 'rejected'].includes(result.status) ||
          (result.status === 'applied' && (result.version !== intent.expectedRemote.version + 1 ||
            !Number.isSafeInteger(result.vaultSeq) || result.vaultSeq! < 1))) {
        throw new Error('Invalid conditional push receipt');
      }
      this.db.prepare(
        'UPDATE resolution_outbox_v1 SET receiptJson = ?, updatedAt = ? WHERE vaultId = ? AND epoch = ? AND decisionId = ?',
      ).run(JSON.stringify(receipt), new Date().toISOString(), scope.vaultId, scope.epoch, decisionId);
      if (result.status === 'applied') {
        this.markApplied(delivery.operationId);
        this.setDocumentState(scope.vaultId, scope.epoch, {
          kind: intent.document.kind, id: intent.document.id, version: result.version!,
          contentHash: local.contentHash, path: local.path, lastVaultSeq: result.vaultSeq!,
        });
      } else if (result.status === 'conflict') this.markConflicted(delivery.operationId, result.reason ?? 'Conditional push conflict');
      else this.markFailed(delivery.operationId, result.reason ?? result.code ?? 'Conditional push rejected');

      if (result.status !== 'applied' || !consistent) {
        if (decision.status === 'needs-recovery') return decision;
        return transitionResolutionDecision(this.db, scope, decisionId, {
          expectedRevision: decision.revision, status: 'needs-recovery',
          diagnostic: diagnostic ?? result.reason ?? result.code ?? 'Conditional push needs review',
        }, new Date().toISOString());
      }
      let applying = decision;
      if (decision.status === 'needs-recovery') applying = transitionResolutionDecision(this.db, scope, decisionId, {
        expectedRevision: decision.revision, status: 'applying',
      }, new Date().toISOString());
      const completed = transitionResolutionDecision(this.db, scope, decisionId, {
        expectedRevision: applying.revision, status: 'completed',
        result: { id: local.id, path: local.path, contentHash: local.contentHash, relayVersion: result.version! },
      }, new Date().toISOString());
      const key = conflictRevisionKey(scope, intent.conflictId);
      this.db.prepare(
        `INSERT INTO resolution_consumed_v1 (vaultId, epoch, kind, id, version, contentHash, decisionId)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(scope.vaultId, scope.epoch, key.kind, key.id, key.version, key.contentHash, decisionId);
      this.beginApply(scope.vaultId, scope.epoch, key);
      this.markApplyCommitted(scope.vaultId, scope.epoch, key);
      // The accepted echo is acknowledgement of these exact local bytes, not a new file write.
      const echo = { kind: intent.document.kind, id: intent.document.id, version: result.version!, contentHash: local.contentHash };
      this.beginApply(scope.vaultId, scope.epoch, echo);
      this.markApplyCommitted(scope.vaultId, scope.epoch, echo);
      return completed;
    });
  }

  hasSyncedIdentity(scope: SyncIdentity, kind: DocumentKind, id: string): boolean {
    return this.db.prepare(
      'SELECT 1 FROM document_state WHERE vaultId = ? AND epoch = ? AND kind = ? AND id = ? ' +
      'UNION ALL SELECT 1 FROM apply_ledger WHERE vaultId = ? AND epoch = ? AND kind = ? AND id = ? ' +
      'UNION ALL SELECT 1 FROM conflict_records_v1 WHERE vaultId = ? AND epoch = ? AND kind = ? AND conflictId = ? LIMIT 1',
    ).get(scope.vaultId, scope.epoch, kind, id, scope.vaultId, scope.epoch, kind, id,
      scope.vaultId, scope.epoch, kind, id) !== undefined;
  }

  getMergedPublication(scope: SyncIdentity, decisionId: string): MergedPublication | null {
    return this.db.prepare(
      'SELECT kind, id, path, contentHash, dev, ino, stagingPath FROM resolution_merged_v1 WHERE vaultId = ? AND epoch = ? AND decisionId = ?',
    ).get(scope.vaultId, scope.epoch, decisionId) as MergedPublication | undefined ?? null;
  }

  reserveMergedPublication(scope: SyncIdentity, decisionId: string): MergedPublication | null {
    return this.transaction(() => {
      const decision = this.getResolutionDecision(scope, decisionId);
      if (decision === null || decision.status !== 'applying' || decision.intent.action !== 'save-merged-copy' ||
          decision.intent.target === null) throw new Error('Merged publication requires an applying decision');
      const prior = this.getMergedPublication(scope, decisionId);
      if (prior !== null) return prior;
      const target = decision.intent.target;
      const kind = decision.intent.document.kind;
      const pathKey = foldPath(target.path);
      const occupied = this.db.prepare(
        'SELECT 1 FROM resolution_merged_v1 WHERE vaultId = ? AND epoch = ? AND ((kind = ? AND id = ?) OR pathKey = ?) LIMIT 1',
      ).get(scope.vaultId, scope.epoch, kind, target.id, pathKey);
      if (occupied !== undefined) return null;
      const source = conflictRevisionKey(scope, decision.intent.conflictId);
      const now = new Date().toISOString();
      this.db.prepare(
        'INSERT INTO resolution_merged_v1 (vaultId, epoch, decisionId, sourceKind, sourceId, sourceVersion, sourceHash, ' +
        'kind, id, path, pathKey, contentHash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(scope.vaultId, scope.epoch, decisionId, source.kind, source.id, source.version, source.contentHash,
        kind, target.id, target.path, pathKey, target.contentHash, now, now);
      return this.getMergedPublication(scope, decisionId)!;
    });
  }

  recordMergedPublicationIdentity(scope: SyncIdentity, decisionId: string, identity: { dev: string; ino: string; stagingPath: string }): void {
    const decision = this.getResolutionDecision(scope, decisionId);
    if (decision?.status !== 'applying' || !/^\d+$/.test(identity.dev) || !/^\d+$/.test(identity.ino) || identity.ino === '0' ||
        typeof identity.stagingPath !== 'string' || identity.stagingPath.length === 0) {
      throw new Error('Invalid merged publication identity');
    }
    const result = this.db.prepare(
      'UPDATE resolution_merged_v1 SET dev = ?, ino = ?, stagingPath = ?, updatedAt = ? WHERE vaultId = ? AND epoch = ? AND decisionId = ?',
    ).run(identity.dev, identity.ino, identity.stagingPath, new Date().toISOString(), scope.vaultId, scope.epoch, decisionId);
    if (result.changes !== 1) throw new Error('Merged publication reservation is missing');
  }

  completeMergedPublication(scope: SyncIdentity, decisionId: string, revision: number): ResolutionDecision {
    return this.transaction(() => {
      const decision = this.getResolutionDecision(scope, decisionId);
      const reservation = this.getMergedPublication(scope, decisionId);
      const target = decision?.intent.target;
      if (decision?.intent.action !== 'save-merged-copy' || decision.status !== 'applying' ||
          target == null || reservation?.dev == null || reservation.ino === null || reservation.stagingPath === null ||
          reservation.id !== target.id || reservation.path !== target.path || reservation.contentHash !== target.contentHash) {
        throw new Error('Merged publication evidence is incomplete');
      }
      // Creating a third document does not acknowledge or modify either original revision.
      return transitionResolutionDecision(this.db, scope, decisionId, {
        expectedRevision: revision, status: 'completed',
        result: { id: target.id, path: target.path, contentHash: target.contentHash, relayVersion: null },
      }, new Date().toISOString());
    });
  }

  prepareResolutionDecision(scope: SyncIdentity, intent: ResolutionIntent) {
    return this.transaction(() => prepareResolutionDecision(this.db, scope, intent, new Date().toISOString()));
  }

  getResolutionDecision(scope: SyncIdentity, decisionId: string) {
    return getResolutionDecision(this.db, scope, decisionId);
  }

  listResolutionHistory(scope: SyncIdentity, conflictId: string, limit?: number, after?: string) {
    return listResolutionHistory(this.db, scope, conflictId, limit, after);
  }

  /** Low-level journal CAS. The executor holds the vault writer lock. */
  transitionResolutionDecision(scope: SyncIdentity, decisionId: string, transition: ResolutionTransition) {
    return this.transaction(() => transitionResolutionDecision(this.db, scope, decisionId, transition, new Date().toISOString()));
  }

  listConflicts(scope: SyncIdentity, options?: ConflictPageOptions) {
    return listConflicts(this.db, scope, options);
  }

  getConflictDetails(scope: SyncIdentity, conflictId: string) {
    return getConflictDetails(this.db, scope, conflictId);
  }

  getApplyIntent(vaultId: string, epoch: number, change: ConflictKey): ApplyIntent | undefined {
    const row = this.db.prepare(
      `SELECT intentJson FROM apply_intent_v1 WHERE vaultId = ? AND epoch = ?
       AND kind = ? AND id = ? AND version = ? AND contentHash = ?`,
    ).get(vaultId, epoch, change.kind, change.id, change.version, change.contentHash) as
      { intentJson: string } | undefined;
    return row === undefined ? undefined : JSON.parse(row.intentJson) as ApplyIntent;
  }

  reserveApplyIntent(vaultId: string, epoch: number, intent: ApplyIntent): ApplyIntent {
    return this.transaction(() => {
      const { change } = intent;
      const prior = this.getApplyIntent(vaultId, epoch, change);
      if (prior !== undefined) return prior;
      this.db.prepare(
        `INSERT INTO apply_intent_v1 (vaultId, epoch, kind, id, version, contentHash, intentJson)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(vaultId, epoch, change.kind, change.id, change.version, change.contentHash, JSON.stringify(intent));
      this.beginApply(vaultId, epoch, change);
      return intent;
    });
  }

  discardCompletedNonConflictIntent(vaultId: string, epoch: number, change: ConflictKey): void {
    if (this.getConflict(vaultId, epoch, change) !== undefined) return;
    this.db.prepare(
      `DELETE FROM apply_intent_v1 WHERE vaultId = ? AND epoch = ?
       AND kind = ? AND id = ? AND version = ? AND contentHash = ?`,
    ).run(vaultId, epoch, change.kind, change.id, change.version, change.contentHash);
  }

  getBlockedApply(vaultId: string, epoch: number, change: ConflictKey): string | undefined {
    const row = this.db.prepare(
      `SELECT reason FROM blocked_apply_v1
       WHERE vaultId = ? AND epoch = ? AND kind = ? AND id = ? AND version = ? AND contentHash = ?`,
    ).get(vaultId, epoch, change.kind, change.id, change.version, change.contentHash) as
      { reason: string } | undefined;
    return row?.reason;
  }

  blockApply(vaultId: string, epoch: number, change: ChangeRecord, reason: string): void {
    this.transaction(() => {
      this.db.prepare(
        `INSERT OR IGNORE INTO blocked_apply_v1
          (vaultId, epoch, kind, id, version, contentHash, changeJson, reason, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(vaultId, epoch, change.kind, change.id, change.version, change.contentHash,
        JSON.stringify(change), reason, new Date().toISOString());
      this.beginApply(vaultId, epoch, change);
      this.markApplyConflict(vaultId, epoch, change);
    });
  }

  getConflict(vaultId: string, epoch: number, change: ConflictKey): ConflictRecord | undefined {
    return this.db.prepare(
      `SELECT conflictId, conflictPath, localPath, localHash, copyHash, copyText, published
       FROM conflict_records_v1 WHERE vaultId = ? AND epoch = ? AND kind = ? AND id = ?
         AND version = ? AND contentHash = ?`,
    ).get(vaultId, epoch, change.kind, change.id, change.version, change.contentHash) as
      ConflictRecord | undefined;
  }

  reserveConflict(vaultId: string, epoch: number, change: ConflictKey, record: Omit<ConflictRecord, 'published'>): ConflictRecord {
    return this.transaction(() => {
      const prior = this.getConflict(vaultId, epoch, change);
      if (prior !== undefined) return prior;
      this.db.prepare(
        `INSERT INTO conflict_records_v1
           (vaultId, epoch, kind, id, version, contentHash, conflictId, conflictPath, localPath, localHash, copyHash, copyText)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(vaultId, epoch, change.kind, change.id, change.version, change.contentHash,
        record.conflictId, record.conflictPath, record.localPath, record.localHash, record.copyHash, record.copyText);
      this.beginApply(vaultId, epoch, change, record);
      return { ...record, published: 0 };
    });
  }

  markConflictPublished(conflictId: string): void {
    this.db.prepare('UPDATE conflict_records_v1 SET published = 1 WHERE conflictId = ?').run(conflictId);
  }

  getApplyEntry(
    vaultId: string,
    epoch: number,
    kind: DocumentKind,
    id: string,
    version: number,
    contentHash: string,
  ): ApplyLedgerEntry | undefined {
    const row = this.db
      .prepare(
        `SELECT status, conflictId, conflictPath FROM apply_ledger
         WHERE vaultId = ? AND epoch = ? AND kind = ? AND id = ? AND version = ? AND contentHash = ?`,
      )
      .get(vaultId, epoch, kind, id, version, contentHash) as
      | { status: ApplyLedgerEntry['status']; conflictId: string | null; conflictPath: string | null }
      | undefined;
    if (row === undefined) return undefined;
    return {
      status: row.status,
      ...(row.conflictId === null ? {} : { conflictId: row.conflictId }),
      ...(row.conflictPath === null ? {} : { conflictPath: row.conflictPath }),
    };
  }

  beginApply(
    vaultId: string,
    epoch: number,
    change: { kind: DocumentKind; id: string; version: number; contentHash: string },
    conflict?: { conflictId: string; conflictPath: string },
  ): void {
    this.db
      .prepare(
        `INSERT INTO apply_ledger
          (vaultId, epoch, kind, id, version, contentHash, status, conflictId, conflictPath, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
         ON CONFLICT(vaultId, epoch, kind, id, version, contentHash) DO UPDATE SET
           status = excluded.status,
           conflictId = COALESCE(excluded.conflictId, apply_ledger.conflictId),
           conflictPath = COALESCE(excluded.conflictPath, apply_ledger.conflictPath),
           updatedAt = excluded.updatedAt`,
      )
      .run(
        vaultId,
        epoch,
        change.kind,
        change.id,
        change.version,
        change.contentHash,
        conflict?.conflictId ?? null,
        conflict?.conflictPath ?? null,
        new Date().toISOString(),
      );
  }

  markApplyCommitted(
    vaultId: string,
    epoch: number,
    change: { kind: DocumentKind; id: string; version: number; contentHash: string },
  ): void {
    this.updateApply(vaultId, epoch, change, 'committed');
  }

  markApplyConflict(
    vaultId: string,
    epoch: number,
    change: { kind: DocumentKind; id: string; version: number; contentHash: string },
  ): void {
    this.updateApply(vaultId, epoch, change, 'conflict');
  }

  private updateApply(
    vaultId: string,
    epoch: number,
    change: { kind: DocumentKind; id: string; version: number; contentHash: string },
    status: ApplyLedgerEntry['status'],
  ): void {
    this.db
      .prepare(
        `UPDATE apply_ledger SET status = ?, updatedAt = ?
         WHERE vaultId = ? AND epoch = ? AND kind = ? AND id = ? AND version = ? AND contentHash = ?`,
      )
      .run(
        status,
        new Date().toISOString(),
        vaultId,
        epoch,
        change.kind,
        change.id,
        change.version,
        change.contentHash,
      );
  }

  private markOutbox(operationId: string, status: string, error: string | null): void {
    this.db
      .prepare('UPDATE outbox SET status = ?, lastError = ?, updatedAt = ? WHERE operationId = ?')
      .run(status, error, new Date().toISOString(), operationId);
  }
}
