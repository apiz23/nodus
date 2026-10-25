/**
 * Core sync protocol service.
 *
 * Implements document versioning, the change feed, conditional writes,
 * idempotent operations, tombstones, and retired IDs on top of the SQLite
 * relay database.
 */

import { createHash } from 'node:crypto';
import type { RelayDatabase } from './db.js';
import { RelayError } from './errors.js';
import type {
  ChangeInput,
  DocumentContent,
  DocumentHeader,
  DocumentKind,
  DocumentRef,
  MutationResult,
  OperationResult,
  PullResponse,
  SnapshotPage,
  SyncIdentity,
  VaultIdentity,
} from '../sync/contracts.js';
import type { PushRequest, PushResponse } from './contracts.js';
import { foldPath } from '../sync/paths.js';
import { validateNotePath } from '../domain/paths.js';
import { NodusError } from '../domain/errors.js';
import type { ChangeRecord } from '../sync/contracts.js';

const DEFAULT_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 30;

interface CurrentDoc {
  kind: DocumentKind;
  id: string;
  path: string;
  version: number;
  contentHash: string;
  content: string;
  vaultSeq: number;
}

/** Workspace-relative path of a database definition. */
function databasePath(id: string): string {
  return `databases/${id}.json`;
}

export class SyncService {
  private db: RelayDatabase;
  private identity: VaultIdentity;
  private retentionDays: number;

  constructor(db: RelayDatabase, identity: VaultIdentity, options?: { tombstoneRetentionDays?: number }) {
    this.db = db;
    this.identity = identity;
    this.retentionDays = Math.max(
      MIN_RETENTION_DAYS,
      options?.tombstoneRetentionDays ?? DEFAULT_RETENTION_DAYS,
    );
  }

  /**
   * Apply a push operation from a device.
   *
   * - Duplicate operationId returns the stored result without mutation.
   * - deviceSeq must be exactly current + 1, otherwise the client must reconcile.
   * - All accepted changes commit in one transaction.
   */
  push(deviceId: string, req: PushRequest, identity?: SyncIdentity): PushResponse {
    this.assertIdentity(identity);
    this.validatePushRequest(deviceId, req);

    const stored = this.findStoredOperation(deviceId, req.operationId);
    if (stored !== undefined) {
      return stored;
    }

    const currentDeviceSeq = this.getDeviceSeq(deviceId);
    if (req.deviceSeq !== currentDeviceSeq + 1) {
      throw new RelayError(
        'CONFLICT',
        `Out-of-order device sequence: expected deviceSeq ${currentDeviceSeq + 1}, received ${req.deviceSeq}`,
        { requestId: 'sync', details: { expected: currentDeviceSeq + 1, received: req.deviceSeq } },
      );
    }

    return this.db.transaction(() => {
      // Re-check idempotency inside the transaction.
      const innerStored = this.findStoredOperation(deviceId, req.operationId);
      if (innerStored !== undefined) return innerStored;

      const now = new Date().toISOString();
      const startingVaultSeq = this.db.getNextVaultSeq();
      let nextVaultSeq = startingVaultSeq;
      const results: MutationResult[] = [];

      // Pre-load current documents and paths for collision checks.
      const docs = this.loadDocuments();
      const paths = new Map<string, CurrentDoc>();
      for (const doc of docs.values()) {
        paths.set(foldPath(doc.path), doc);
      }

      for (const change of req.changes) {
        const result = this.applyChange(change, docs, paths, nextVaultSeq, now);
        results.push(result);
        if (result.status === 'applied') {
          nextVaultSeq += 1;
        }
      }

      if (nextVaultSeq !== startingVaultSeq) {
        this.db.setNextVaultSeq(nextVaultSeq);
      }

      this.db
        .prepare(
          'INSERT INTO operations (operationId, deviceId, deviceSeq, resultJson, createdAt) VALUES (?, ?, ?, ?, ?)',
        )
        .run(req.operationId, deviceId, req.deviceSeq, JSON.stringify(results), now);

      this.setDeviceSeq(deviceId, req.deviceSeq);

      return { deviceSeq: req.deviceSeq, results };
    });
  }

  /**
   * Return ordered changes after the given cursor.
   */
  pull(cursor?: string, limit = 100, identity?: SyncIdentity): PullResponse {
    this.assertIdentity(identity);

    const decoded = cursor === undefined || cursor === '' ? { seq: 0 } : decodeCursor(cursor);
    if (
      (decoded.vaultId !== undefined && decoded.vaultId !== this.identity.vaultId) ||
      (decoded.epoch !== undefined && decoded.epoch !== this.identity.epoch)
    ) {
      return this.bootstrapResponse(decoded.seq);
    }

    const cursorSeq = decoded.seq;
    const oldestSeq = this.oldestChangeSeq();
    const latestSeq = this.maxVaultSeq();

    if (cursorSeq > latestSeq) return this.bootstrapResponse(cursorSeq);
    if (oldestSeq !== null && cursorSeq + 1 < oldestSeq) {
      return this.bootstrapResponse(cursorSeq);
    }
    if (oldestSeq === null && cursorSeq < latestSeq) {
      return this.bootstrapResponse(cursorSeq);
    }

    const rows = this.db
      .prepare(
        'SELECT vaultSeq, kind, id, op, baseVersion, version, path, previousPath, contentHash, content, epoch, timestamp FROM change_log WHERE vaultSeq > ? ORDER BY vaultSeq LIMIT ?',
      )
      .all(cursorSeq, limit + 1) as Array<{
      vaultSeq: number;
      kind: DocumentKind;
      id: string;
      op: string;
      baseVersion: number;
      version: number;
      path: string;
      previousPath: string | null;
      contentHash: string;
      content: string | null;
      epoch: number;
      timestamp: string;
    }>;

    const changes: ChangeRecord[] = rows.slice(0, limit).map((row) => ({
      kind: row.kind,
      id: row.id,
      vaultSeq: row.vaultSeq,
      op: row.op as ChangeRecord['op'],
      baseVersion: row.baseVersion,
      version: row.version,
      path: row.path,
      previousPath: row.previousPath ?? undefined,
      contentHash: row.contentHash,
      content: row.content ?? undefined,
      epoch: row.epoch,
      timestamp: row.timestamp,
    }));

    const newCursor =
      changes.length > 0
        ? encodeCursor(changes[changes.length - 1]!.vaultSeq, this.identity)
        : cursor ?? encodeCursor(cursorSeq, this.identity);

    return {
      vaultId: this.identity.vaultId,
      epoch: this.identity.epoch,
      cursor: newCursor,
      changes,
      bootstrapRequired: false,
      earliestRetainedSeq: oldestSeq,
      latestSeq,
    };
  }

  private bootstrapResponse(cursorSeq: number): PullResponse {
    return {
      vaultId: this.identity.vaultId,
      epoch: this.identity.epoch,
      cursor: encodeCursor(cursorSeq, this.identity),
      changes: [],
      bootstrapRequired: true,
      earliestRetainedSeq: this.oldestChangeSeq(),
      latestSeq: this.maxVaultSeq(),
    };
  }

  deviceState(deviceId: string, identity?: SyncIdentity): {
    deviceId: string;
    lastSeq: number;
    oldestOperationSeq: number | null;
  } {
    this.assertIdentity(identity);
    const oldest = this.db
      .prepare('SELECT MIN(deviceSeq) AS seq FROM operations WHERE deviceId = ?')
      .get(deviceId) as { seq: number | null } | undefined;
    return {
      deviceId,
      lastSeq: this.getDeviceSeq(deviceId),
      oldestOperationSeq: oldest?.seq ?? null,
    };
  }

  /**
   * Fetch stored operation results for a device sequence range.
   */
  operations(
    deviceId: string,
    fromDeviceSeq: number,
    toDeviceSeq?: number,
    identity?: SyncIdentity,
  ): OperationResult[] {
    this.assertIdentity(identity);
    const upper = toDeviceSeq ?? fromDeviceSeq;
    const rows = this.db
      .prepare(
        'SELECT operationId, deviceSeq, resultJson FROM operations WHERE deviceId = ? AND deviceSeq BETWEEN ? AND ? ORDER BY deviceSeq',
      )
      .all(deviceId, fromDeviceSeq, upper) as {
      operationId: string;
      deviceSeq: number;
      resultJson: string;
    }[];

    return rows.map((row) => ({
      operationId: row.operationId,
      deviceSeq: row.deviceSeq,
      results: JSON.parse(row.resultJson) as MutationResult[],
    }));
  }

  /**
   * Return one deterministic page of the current snapshot boundary.
   *
   * The stable boundary is snapshotSeq. A document that changes during
   * bootstrap will fail its versioned content read and must be retried.
   */
  snapshot(after?: string, limit = 50, identity?: SyncIdentity): SnapshotPage {
    this.assertIdentity(identity);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new RelayError('INVALID_INPUT', 'Snapshot limit must be between 1 and 1000', {
        requestId: 'sync',
      });
    }

    const afterRef = after === undefined || after === '' ? undefined : decodePageCursor(after);

    return this.db.transaction(() => {
      const snapshotSeq = this.maxVaultSeq();
      const rows = afterRef === undefined
        ? (this.db
            .prepare(
              'SELECT kind, id, path, version, contentHash FROM documents ORDER BY kind, id LIMIT ?',
            )
            .all(limit + 1) as unknown as DocumentHeader[])
        : (this.db
            .prepare(
              `SELECT kind, id, path, version, contentHash
               FROM documents
               WHERE kind > ? OR (kind = ? AND id > ?)
               ORDER BY kind, id LIMIT ?`,
            )
            .all(afterRef.kind, afterRef.kind, afterRef.id, limit + 1) as unknown as DocumentHeader[]);

      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor =
        rows.length > limit && last !== undefined ? encodePageCursor(last) : null;

      const tombstones = afterRef === undefined
        ? (this.db
            .prepare('SELECT kind, id, deletedAt, retainedUntil FROM tombstones ORDER BY kind, id')
            .all() as Array<{
            kind: DocumentKind;
            id: string;
            deletedAt: string;
            retainedUntil: string;
          }>)
        : [];

      const retiredIds = afterRef === undefined
        ? (this.db
            .prepare('SELECT kind, id FROM retired_ids ORDER BY kind, id')
            .all() as unknown as DocumentRef[])
        : [];

      return {
        vaultId: this.identity.vaultId,
        epoch: this.identity.epoch,
        cursor: encodeCursor(snapshotSeq, this.identity),
        snapshotSeq,
        nextCursor,
        documents: page.map((row) => ({
          kind: row.kind,
          id: row.id,
          path: row.path,
          version: row.version,
          contentHash: row.contentHash,
        })),
        tombstones,
        retiredIds,
      };
    });
  }

  /** Read one document only when it still matches the requested snapshot version. */
  document(kind: DocumentKind, id: string, version?: number, identity?: SyncIdentity): DocumentContent {
    this.assertIdentity(identity);
    const row = this.db
      .prepare(
        'SELECT kind, id, path, version, contentHash, content FROM documents WHERE kind = ? AND id = ?',
      )
      .get(kind, id) as
      | { kind: DocumentKind; id: string; path: string; version: number; contentHash: string; content: string }
      | undefined;

    if (row === undefined) {
      if (this.isRetired(kind, id)) {
        throw new RelayError('DOCUMENT_RETIRED', 'Document ID has been retired', {
          requestId: 'sync',
          details: { kind, id },
        });
      }
      throw new RelayError('NOT_FOUND', 'Document not found', {
        requestId: 'sync',
        details: { kind, id },
      });
    }

    if (version !== undefined && version !== row.version) {
      throw new RelayError('STALE_SNAPSHOT', 'Document changed during bootstrap', {
        requestId: 'sync',
        details: { kind, id, expectedVersion: version, currentVersion: row.version },
      });
    }

    return {
      kind: row.kind,
      id: row.id,
      path: row.path,
      version: row.version,
      contentHash: row.contentHash,
      content: row.content,
    };
  }

  pruneChanges(olderThanVaultSeq: number): void {
    this.db.prepare('DELETE FROM change_log WHERE vaultSeq < ?').run(olderThanVaultSeq);
  }

  pruneTombstones(): void {
    const now = new Date().toISOString();
    this.db.prepare('DELETE FROM tombstones WHERE retainedUntil < ?').run(now);
  }

  private applyChange(
    change: ChangeInput,
    docs: Map<string, CurrentDoc>,
    paths: Map<string, CurrentDoc>,
    vaultSeq: number,
    now: string,
  ): MutationResult {
    const base = docs.get(`${change.kind}:${change.id}`);

    // Retired IDs can never be reused.
    if (this.isRetired(change.kind, change.id)) {
      return {
        kind: change.kind,
        id: change.id,
        status: 'rejected',
        code: 'DOCUMENT_RETIRED',
        reason: 'ID has been retired',
      };
    }

    const validation = this.validateChange(change, base);
    if (validation !== undefined) {
      return { kind: change.kind, id: change.id, status: 'rejected', reason: validation };
    }

    switch (change.op) {
      case 'create': {
        if (base !== undefined) {
          return { kind: change.kind, id: change.id, status: 'conflict', reason: 'Document already exists' };
        }
        const pathCollision = paths.get(foldPath(change.path));
        if (pathCollision !== undefined) {
          return { kind: change.kind, id: change.id, status: 'conflict', reason: 'Path collision' };
        }
        const content = change.content ?? '';
        const contentHash = hashHex(content);
        if (contentHash !== change.contentHash) {
          return { kind: change.kind, id: change.id, status: 'rejected', reason: 'Content hash mismatch' };
        }
        this.db
          .prepare(
            'INSERT INTO documents (kind, id, path, version, contentHash, content, vaultSeq, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(change.kind, change.id, change.path, 1, contentHash, content, vaultSeq, now);
        this.insertChangeLog({ ...change, version: 1, contentHash, content, vaultSeq, now });
        const doc: CurrentDoc = { kind: change.kind, id: change.id, path: change.path, version: 1, contentHash, content, vaultSeq };
        docs.set(`${change.kind}:${change.id}`, doc);
        paths.set(foldPath(change.path), doc);
        return { kind: change.kind, id: change.id, status: 'applied', version: 1, vaultSeq };
      }
      case 'update': {
        if (base === undefined) {
          return { kind: change.kind, id: change.id, status: 'conflict', reason: 'Document does not exist' };
        }
        if (base.version !== change.baseVersion) {
          return { kind: change.kind, id: change.id, status: 'conflict', reason: 'Stale base version' };
        }
        const content = change.content ?? '';
        const contentHash = hashHex(content);
        if (contentHash !== change.contentHash) {
          return { kind: change.kind, id: change.id, status: 'rejected', reason: 'Content hash mismatch' };
        }
        if (base.path !== change.path) {
          paths.delete(foldPath(base.path));
        }
        const pathCollision = paths.get(foldPath(change.path));
        if (pathCollision !== undefined && pathCollision.id !== change.id) {
          paths.set(foldPath(base.path), base);
          return { kind: change.kind, id: change.id, status: 'conflict', reason: 'Path collision' };
        }
        const nextVersion = base.version + 1;
        this.db
          .prepare(
            'UPDATE documents SET path = ?, version = ?, contentHash = ?, content = ?, vaultSeq = ?, updatedAt = ? WHERE kind = ? AND id = ?',
          )
          .run(change.path, nextVersion, contentHash, content, vaultSeq, now, change.kind, change.id);
        this.insertChangeLog({ ...change, version: nextVersion, contentHash, content, vaultSeq, now });
        const doc: CurrentDoc = { ...base, path: change.path, version: nextVersion, contentHash, content, vaultSeq };
        docs.set(`${change.kind}:${change.id}`, doc);
        paths.set(foldPath(change.path), doc);
        return { kind: change.kind, id: change.id, status: 'applied', version: nextVersion, vaultSeq };
      }
      case 'move': {
        if (base === undefined) {
          return { kind: change.kind, id: change.id, status: 'conflict', reason: 'Document does not exist' };
        }
        if (base.version !== change.baseVersion) {
          return { kind: change.kind, id: change.id, status: 'conflict', reason: 'Stale base version' };
        }
        if (base.path !== change.path) {
          paths.delete(foldPath(base.path));
        }
        const pathCollision = paths.get(foldPath(change.path));
        if (pathCollision !== undefined && pathCollision.id !== change.id) {
          paths.set(foldPath(base.path), base);
          return { kind: change.kind, id: change.id, status: 'conflict', reason: 'Path collision' };
        }
        const nextVersion = base.version + 1;
        this.db
          .prepare(
            'UPDATE documents SET path = ?, version = ?, vaultSeq = ?, updatedAt = ? WHERE kind = ? AND id = ?',
          )
          .run(change.path, nextVersion, vaultSeq, now, change.kind, change.id);
        this.insertChangeLog({
          ...change,
          version: nextVersion,
          contentHash: base.contentHash,
          content: base.content,
          previousPath: base.path,
          vaultSeq,
          now,
        });
        const doc: CurrentDoc = { ...base, path: change.path, version: nextVersion, vaultSeq };
        docs.set(`${change.kind}:${change.id}`, doc);
        paths.set(foldPath(change.path), doc);
        return { kind: change.kind, id: change.id, status: 'applied', version: nextVersion, vaultSeq };
      }
      case 'delete': {
        if (base === undefined) {
          return { kind: change.kind, id: change.id, status: 'conflict', reason: 'Document does not exist' };
        }
        if (base.version !== change.baseVersion) {
          return { kind: change.kind, id: change.id, status: 'conflict', reason: 'Stale base version' };
        }
        const nextVersion = base.version + 1;
        this.db.prepare('DELETE FROM documents WHERE kind = ? AND id = ?').run(change.kind, change.id);
        const retainedUntil = new Date(Date.now() + this.retentionDays * 24 * 60 * 60 * 1000).toISOString();
        this.db
          .prepare('INSERT OR REPLACE INTO tombstones (kind, id, deletedAt, retainedUntil) VALUES (?, ?, ?, ?)')
          .run(change.kind, change.id, now, retainedUntil);
        this.db
          .prepare('INSERT OR IGNORE INTO retired_ids (kind, id, retiredAt) VALUES (?, ?, ?)')
          .run(change.kind, change.id, now);
        this.insertChangeLog({
          ...change,
          version: nextVersion,
          contentHash: hashHex(''),
          content: undefined,
          vaultSeq,
          now,
        });
        docs.delete(`${change.kind}:${change.id}`);
        paths.delete(foldPath(base.path));
        return { kind: change.kind, id: change.id, status: 'applied', version: nextVersion, vaultSeq };
      }
      default:
        return { kind: change.kind, id: change.id, status: 'rejected', reason: 'Invalid operation' };
    }
  }

  private validateChange(change: ChangeInput, base: CurrentDoc | undefined): string | undefined {
    if (!change.kind || (change.kind !== 'note' && change.kind !== 'database')) {
      return 'Invalid document kind';
    }
    if (!change.id) return 'Missing document id';
    if (!change.path) return 'Missing document path';
    if (change.op !== 'create' && change.op !== 'update' && change.op !== 'move' && change.op !== 'delete') {
      return 'Invalid operation';
    }
    if (!Number.isInteger(change.baseVersion) || change.baseVersion < 0) {
      return 'Invalid baseVersion';
    }
    if (!Number.isInteger(change.version) || change.version < 1) {
      return 'Invalid version';
    }
    if (change.op === 'create' && change.baseVersion !== 0) {
      return 'Create must have baseVersion 0';
    }
    if (change.op !== 'create' && change.baseVersion === 0) {
      return 'Non-create must have a positive baseVersion';
    }

    try {
      if (change.kind === 'note') {
        validateNotePath(change.path);
      } else {
        const expected = databasePath(change.id);
        if (change.path !== expected) {
          return `Database path must be ${expected}`;
        }
      }
    } catch (error) {
      return error instanceof NodusError ? error.message : String(error);
    }

    return undefined;
  }

  private insertChangeLog(params: {
    kind: DocumentKind;
    id: string;
    op: ChangeRecord['op'];
    baseVersion: number;
    version: number;
    path: string;
    previousPath?: string;
    contentHash: string;
    content?: string;
    vaultSeq: number;
    now: string;
  }): void {
    this.db
      .prepare(
        'INSERT INTO change_log (vaultSeq, kind, id, op, baseVersion, version, path, previousPath, contentHash, content, epoch, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        params.vaultSeq,
        params.kind,
        params.id,
        params.op,
        params.baseVersion,
        params.version,
        params.path,
        params.previousPath ?? null,
        params.contentHash,
        params.content ?? null,
        this.identity.epoch,
        params.now,
      );
  }

  private loadDocuments(): Map<string, CurrentDoc> {
    const rows = this.db
      .prepare('SELECT kind, id, path, version, contentHash, content, vaultSeq FROM documents')
      .all() as Array<{
      kind: DocumentKind;
      id: string;
      path: string;
      version: number;
      contentHash: string;
      content: string;
      vaultSeq: number;
    }>;
    const map = new Map<string, CurrentDoc>();
    for (const row of rows) {
      map.set(`${row.kind}:${row.id}`, row);
    }
    return map;
  }

  private isRetired(kind: DocumentKind, id: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM retired_ids WHERE kind = ? AND id = ?').get(kind, id);
    return row !== undefined;
  }

  private maxVaultSeq(): number {
    return this.db.getNextVaultSeq() - 1;
  }

  private oldestChangeSeq(): number | null {
    const row = this.db.prepare('SELECT COALESCE(MIN(vaultSeq), NULL) as seq FROM change_log').get() as
      | { seq: number | null }
      | undefined;
    return row?.seq ?? null;
  }

  private findStoredOperation(deviceId: string, operationId: string): PushResponse | undefined {
    const row = this.db
      .prepare('SELECT deviceSeq, resultJson FROM operations WHERE operationId = ? AND deviceId = ?')
      .get(operationId, deviceId) as
      | { deviceSeq: number; resultJson: string }
      | undefined;
    if (row === undefined) return undefined;
    return { deviceSeq: row.deviceSeq, results: JSON.parse(row.resultJson) as MutationResult[] };
  }

  private getDeviceSeq(deviceId: string): number {
    const row = this.db
      .prepare('SELECT deviceSeq FROM device_sequences WHERE deviceId = ?')
      .get(deviceId) as { deviceSeq: number } | undefined;
    return row?.deviceSeq ?? 0;
  }

  private setDeviceSeq(deviceId: string, deviceSeq: number): void {
    this.db
      .prepare('INSERT INTO device_sequences (deviceId, deviceSeq) VALUES (?, ?) ON CONFLICT(deviceId) DO UPDATE SET deviceSeq = excluded.deviceSeq')
      .run(deviceId, deviceSeq);
  }

  private assertIdentity(identity?: SyncIdentity): void {
    if (identity === undefined) return;
    if (identity.vaultId !== this.identity.vaultId || identity.epoch !== this.identity.epoch) {
      throw new RelayError('BOOTSTRAP_REQUIRED', 'Vault identity or epoch changed; bootstrap required', {
        requestId: 'sync',
        details: {
          expectedVaultId: this.identity.vaultId,
          expectedEpoch: this.identity.epoch,
          receivedVaultId: identity.vaultId,
          receivedEpoch: identity.epoch,
        },
      });
    }
  }

  private validatePushRequest(deviceId: string, req: PushRequest): void {
    if (!deviceId) throw new RelayError('INVALID_INPUT', 'deviceId is required', { requestId: 'sync' });
    if (!req.operationId) throw new RelayError('INVALID_INPUT', 'operationId is required', { requestId: 'sync' });
    if (!Number.isInteger(req.deviceSeq) || req.deviceSeq < 1) {
      throw new RelayError('INVALID_INPUT', 'deviceSeq must be a positive integer', { requestId: 'sync' });
    }
    if (!Array.isArray(req.changes)) {
      throw new RelayError('INVALID_INPUT', 'changes must be an array', { requestId: 'sync' });
    }
  }
}

function hashHex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

interface CursorValue {
  seq: number;
  vaultId?: string;
  epoch?: number;
}

interface PageCursorValue {
  kind: DocumentKind;
  id: string;
}

function encodeCursor(seq: number, identity: VaultIdentity): string {
  return Buffer.from(
    JSON.stringify({ seq, vaultId: identity.vaultId, epoch: identity.epoch }),
  ).toString('base64url');
}

function decodeCursor(cursor: string): CursorValue {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorValue;
    if (
      typeof parsed.seq === 'number' &&
      Number.isInteger(parsed.seq) &&
      parsed.seq >= 0 &&
      (parsed.vaultId === undefined || typeof parsed.vaultId === 'string') &&
      (parsed.epoch === undefined || typeof parsed.epoch === 'number')
    ) {
      return parsed;
    }
  } catch {}
  throw new RelayError('INVALID_INPUT', 'Invalid cursor', { requestId: 'sync' });
}

function encodePageCursor(ref: DocumentRef): string {
  return Buffer.from(JSON.stringify({ kind: ref.kind, id: ref.id })).toString('base64url');
}

function decodePageCursor(cursor: string): PageCursorValue {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as PageCursorValue;
    if (
      (parsed.kind === 'note' || parsed.kind === 'database') &&
      typeof parsed.id === 'string' &&
      parsed.id.length > 0
    ) {
      return parsed;
    }
  } catch {}
  throw new RelayError('INVALID_INPUT', 'Invalid snapshot cursor', { requestId: 'sync' });
}
