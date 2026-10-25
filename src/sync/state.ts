/**
 * Local sync state. Kept outside Markdown and outside the relay.
 *
 * SQLite is used for atomic outbox, apply-ledger, cursor, and document-base
 * transitions. The relay remains authoritative for remote revisions.
 */

import { DatabaseSync } from 'node:sqlite';
import type { ChangeInput, DocumentKind } from './contracts.js';

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

export interface OutboxOperation {
  operationId: string;
  deviceSeq: number;
  changes: ChangeInput[];
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
    store.db.exec(SCHEMA);
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
    return this.transaction(() => {
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
    });
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
