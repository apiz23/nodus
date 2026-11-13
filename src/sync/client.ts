/**
 * Phase 4 sync client.
 *
 * Remote ordering lives on the relay. Local files remain authoritative and are
 * applied through FileSystemVault. State lives in .nodus/sync.sqlite.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseDefinition } from '../database/schema.js';
import { parseDatabase, serializeDatabase } from '../database/schema.js';
import type { Note } from '../domain/note.js';
import { parseNote, serializeNote } from '../format/note-format.js';
import { isStorageError } from '../storage/errors.js';
import { FileSystemVault, type SyncWriteSession } from '../storage/fs/vault.js';
import { normalizeResolutionIntent, type ResolutionIntent, type ResolutionDecision } from './resolution-decisions.js';
import { conflictRevisionKey, type ConflictPage, type ConflictPageOptions, type ConflictSummary } from './conflict-registry.js';
import { conflictSuffix, makeConflictDatabase, makeConflictNote } from './conflicts.js';
import { foldPath } from './paths.js';
import { SyncStateStore, type ConflictRecord, type FileRevision, type ResolutionOutbox } from './state.js';
import type {
  ChangeRecord,
  ChangeInput,
  DocumentContent,
  DocumentHeader,
  DocumentKind,
  DocumentRef,
  OperationResult,
  PullResponse,
  SnapshotPage,
  SyncIdentity,
  VaultIdentity,
} from './contracts.js';

const PROTOCOL_VERSION = '1';
const DEFAULT_SNAPSHOT_LIMIT = 100;
const DEFAULT_MASS_DELETE_LIMIT = 10;

export interface PairResult {
  deviceId: string;
  token: string;
}

export interface SyncClientOptions {
  vault: FileSystemVault;
  baseUrl: string;
  token: string;
  deviceId?: string;
  statePath?: string;
  now?: () => string;
  massDeleteLimit?: number;
  fetchImpl?: typeof fetch;
}

export class SyncHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'SyncHttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class ResolutionEvidenceError extends Error {
  constructor(message: string, readonly stale = false) { super(message); }
}

class ConflictCopyMismatch extends Error {}

interface LocalDocument {
  kind: DocumentKind;
  id: string;
  path: string;
  raw?: string;
  hash: string;
  note?: Note;
  database?: DatabaseDefinition;
}

class SnapshotConflict extends Error {}

export class SyncClient {
  private readonly vault: FileSystemVault;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly state: SyncStateStore;
  private readonly now: () => string;
  private readonly massDeleteLimit: number;
  private readonly fetchImpl: typeof fetch;
  private readonly deviceId: string;

  constructor(options: SyncClientOptions) {
    this.vault = options.vault;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.now = options.now ?? (() => new Date().toISOString());
    this.massDeleteLimit = options.massDeleteLimit ?? DEFAULT_MASS_DELETE_LIMIT;
    this.fetchImpl = options.fetchImpl ?? fetch;

    const statePath =
      options.statePath ?? join(this.vault.root, '.nodus', 'sync.sqlite');
    mkdirSync(dirname(statePath), { recursive: true });
    this.state = SyncStateStore.open(statePath);
    if (options.deviceId !== undefined) this.state.setMeta('device_id', options.deviceId);
    this.deviceId = options.deviceId ?? this.state.getMeta('device_id') ?? 'device';
  }

  static async pair(
    baseUrl: string,
    pairingCode: string,
    deviceName: string,
    fetchImpl: typeof fetch = fetch,
  ): Promise<PairResult> {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode, deviceName }),
    });
    const body = await parseResponse<PairResult>(response);
    return body;
  }

  close(): void {
    this.state.close();
  }

  getCursor(): string | undefined {
    return this.state.getMeta('cursor');
  }

  getPendingOperationIds(): string[] {
    return this.state.pendingOperations().map((operation) => operation.operationId);
  }

  async identity(): Promise<VaultIdentity> {
    const result = await this.request<VaultIdentity & { protocolVersion?: number }>('/vault');
    return { vaultId: result.vaultId, epoch: result.epoch };
  }

  async enqueueChanges(changes: ChangeInput[]): Promise<string> {
    return this.vault.withSyncWrite(async () => this.enqueueChangesLocked(changes));
  }

  private enqueueChangesLocked(changes: ChangeInput[]): string {
    const operationId = randomUUID();
    this.state.enqueue(operationId, changes);
    return operationId;
  }

  async enqueueNoteChange(
    id: string,
    op: 'create' | 'update' | 'move' | 'delete' = 'update',
    options: { baseVersion?: number; path?: string } = {},
  ): Promise<string> {
    return this.vault.withSyncWrite(() => this.enqueueNoteChangeLocked(id, op, options));
  }

  private async enqueueNoteChangeLocked(
    id: string,
    op: 'create' | 'update' | 'move' | 'delete' = 'update',
    options: { baseVersion?: number; path?: string } = {},
  ): Promise<string> {
    const local = await this.readLocalDocument('note', id);
    if (local === null || local.note === undefined) {
      throw new Error(`Local note ${id} was not found`);
    }
    const epoch = Number.parseInt(this.state.getMeta('epoch') ?? '1', 10);
    const version =
      options.baseVersion ??
      this.state.getDocumentState(this.identityVaultId(), epoch, 'note', id)?.version ??
      (op === 'create' ? 0 : 1);
    const baseVersion = op === 'create' ? 0 : version;
    const path = options.path ?? local.path;
    return this.enqueueChangesLocked([
      {
        kind: 'note',
        id,
        op,
        baseVersion,
        version: baseVersion + 1,
        path,
        contentHash: op === 'delete' ? hashHex('') : local.hash,
        ...(op === 'delete'
          ? {}
          : { content: op === 'move' ? undefined : local.raw }),
        ...(op === 'move' ? { previousPath: local.path } : {}),
      },
    ]);
  }

  async bootstrap(): Promise<void> {
    return this.vault.withSyncWrite((writes) => this.bootstrapLocked(writes));
  }

  private async bootstrapLocked(writes: SyncWriteSession): Promise<void> {
    const identity = await this.identity();
    this.rememberIdentity(identity);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.bootstrapOnce(identity, writes);
        return;
      } catch (error) {
        const retryable =
          error instanceof SnapshotConflict ||
          (error instanceof SyncHttpError && (error.status === 409 || error.status === 410));
        if (!retryable || attempt === 2) throw error;
      }
    }
  }

  async pull(): Promise<void> {
    return this.vault.withSyncWrite((writes) => this.pullLocked(writes));
  }

  private async pullLocked(writes: SyncWriteSession): Promise<void> {
    if (this.getCursor() === undefined || this.getCursor() === '') {
      await this.bootstrapLocked(writes);
      return;
    }

    const identity = await this.identity();
    this.rememberIdentity(identity);
    const cursor = this.getCursor();
    let response: PullResponse;
    try {
      response = await this.request<PullResponse>(
        `/pull?limit=${DEFAULT_SNAPSHOT_LIMIT}${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
        { identity },
      );
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 410) {
        await this.bootstrapLocked(writes);
        return;
      }
      throw error;
    }

    if (response.bootstrapRequired || response.vaultId !== identity.vaultId || response.epoch !== identity.epoch) {
      await this.bootstrapLocked(writes);
      return;
    }

    const deletes = response.changes.filter((change) => change.op === 'delete').length;
    if (deletes > this.massDeleteLimit) {
      throw new Error(
        `Mass-delete guard: ${deletes} remote deletions exceed limit ${this.massDeleteLimit}`,
      );
    }

    for (const change of response.changes) {
      await this.applyRemoteChangeLocked(identity, change, writes);
      this.state.setMeta('cursor', encodeCursor(change.vaultSeq, identity));
    }
    if (response.changes.length === 0) {
      this.state.setMeta('cursor', response.cursor);
    }
  }

  async pushOutbox(): Promise<void> {
    return this.vault.withSyncWrite((writes) => this.pushOutboxLocked(writes));
  }

  private async pushOutboxLocked(writes: SyncWriteSession): Promise<void> {
    const identity = await this.identity();
    this.rememberIdentity(identity);
    await this.ensureDeviceSeq(identity);
    for (const operation of this.state.pendingOperations()) {
      const resolution = this.state.resolutionForOutbox(operation.operationId);
      if (resolution !== null) {
        this.assertResolutionScope(resolution);
        const outcome = await this.executeKeepLocalLocked(resolution, resolution.decisionId, writes);
        if (outcome.status !== 'completed') throw new Error('Keep-local reconciliation requires recovery: ' + outcome.diagnostic);
        continue;
      }
      for (const change of operation.changes) this.assertNoActiveResolution(identity, change);
      let response;
      try {
        response = await this.request<{ deviceSeq: number; results: Array<{ kind: DocumentKind; id: string; status: string; version?: number; vaultSeq?: number; code?: string; reason?: string }> }>(
          '/push',
          {
            method: 'POST',
            identity,
            body: {
              operationId: operation.operationId,
              deviceSeq: operation.deviceSeq,
              changes: operation.changes,
            },
          },
        );
      } catch (error) {
        if (error instanceof SyncHttpError && error.status === 410) {
          await this.bootstrapLocked(writes);
        }
        throw error;
      }

      let conflicted = false;
      let rejected = false;
      for (const [index, result] of response.results.entries()) {
        const change = operation.changes[index];
        if (change === undefined) continue;
        if (result.status === 'applied' && result.version !== undefined) {
          if (change.op === 'delete') {
            this.state.deleteDocumentState(identity.vaultId, identity.epoch, change.kind, change.id);
          } else {
            this.state.setDocumentState(identity.vaultId, identity.epoch, {
              kind: change.kind,
              id: change.id,
              version: result.version,
              contentHash: change.contentHash,
              path: change.path,
              lastVaultSeq: result.vaultSeq ?? this.state.getDocumentState(identity.vaultId, identity.epoch, change.kind, change.id)?.lastVaultSeq ?? 0,
            });
          }
        } else if (result.status === 'conflict') {
          conflicted = true;
        } else {
          rejected = true;
          if (result.code === 'DOCUMENT_RETIRED') {
            const local = await this.readLocalDocument(change.kind, change.id);
            if (local !== null) {
              const retired = {
                ...change,
                vaultSeq: 0,
                epoch: identity.epoch,
                timestamp: this.now(),
              };
              this.assertApplyUnblocked(identity, retired);
              await this.reserveConflict(identity, retired, local, writes);
              await this.guardApply(identity, retired, () => this.deleteLocalDocument(local, writes));
              this.state.deleteDocumentState(identity.vaultId, identity.epoch, change.kind, change.id);
            }
          }
        }
      }

      if (conflicted) this.state.markConflicted(operation.operationId, 'Remote conflict');
      else if (rejected) this.state.markFailed(operation.operationId, 'Relay rejected operation');
      else this.state.markApplied(operation.operationId);
    }
  }

  async sync(): Promise<void> {
    await this.pushOutbox();
    await this.pull();
  }

  private async bootstrapOnce(identity: SyncIdentity, writes: SyncWriteSession): Promise<void> {
    let after: string | undefined;
    let snapshotSeq: number | undefined;
    let tombstones: SnapshotPage['tombstones'] = [];
    let retiredIds: DocumentRef[] = [];

    do {
      const page = await this.request<SnapshotPage>(
        `/snapshot?limit=${DEFAULT_SNAPSHOT_LIMIT}${after === undefined ? '' : `&after=${encodeURIComponent(after)}`}`,
        { identity },
      );
      if (snapshotSeq === undefined) {
        snapshotSeq = page.snapshotSeq;
        tombstones = page.tombstones;
        retiredIds = page.retiredIds;
      } else if (snapshotSeq !== page.snapshotSeq) {
        throw new SnapshotConflict('Snapshot boundary moved during bootstrap');
      }

      for (const header of page.documents) {
        const content = await this.request<DocumentContent>(
          `/docs/${header.kind}/${encodeURIComponent(header.id)}?version=${header.version}`,
          { identity },
        );
        await this.applyRemoteChangeLocked(identity, {
          ...header,
          op: 'update',
          baseVersion: 0,
          content: content.content,
          vaultSeq: snapshotSeq,
          epoch: identity.epoch,
          timestamp: this.now(),
        }, writes);
      }
      after = page.nextCursor ?? undefined;
    } while (after !== undefined);

    const seen = new Set<string>();
    const refs: DocumentRef[] = [];
    for (const ref of [...tombstones, ...retiredIds]) {
      const key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }

    let localDeletions = 0;
    for (const ref of refs) {
      if ((await this.readLocalDocument(ref.kind, ref.id)) !== null) localDeletions += 1;
    }
    if (localDeletions > this.massDeleteLimit) {
      throw new Error(
        `Mass-delete guard: ${localDeletions} local documents would be deleted; limit ${this.massDeleteLimit}`,
      );
    }

    for (const ref of refs) {
      await this.applyRemoteDeleteLocked(identity, {
        kind: ref.kind,
        id: ref.id,
        op: 'delete',
        baseVersion: 0,
        version: 1,
        path: ref.kind === 'note' ? 'notes/unknown.md' : `databases/${ref.id}.json`,
        contentHash: hashHex(''),
        vaultSeq: snapshotSeq,
        epoch: identity.epoch,
        timestamp: this.now(),
      }, writes);
    }

    this.state.setMeta('cursor', encodeCursor(snapshotSeq ?? 0, identity));
    this.state.setMeta('snapshot_seq', String(snapshotSeq ?? 0));
  }

  private async applyRemoteChangeLocked(identity: SyncIdentity, change: ChangeRecord, writes: SyncWriteSession): Promise<void> {
    this.assertResolutionScope(identity);
    if (this.state.isResolutionConsumed(identity, change)) return;
    this.assertNoActiveResolution(identity, change);
    if (change.op === 'delete') {
      await this.applyRemoteDeleteLocked(identity, change, writes);
      return;
    }

    this.assertApplyUnblocked(identity, change);
    const existing = this.state.getApplyEntry(
      identity.vaultId,
      identity.epoch,
      change.kind,
      change.id,
      change.version,
      change.contentHash,
    );
    await this.recoverConflict(identity, change, writes);
    if (existing?.status === 'committed') {
      this.state.setDocumentState(identity.vaultId, identity.epoch, {
        kind: change.kind,
        id: change.id,
        version: change.version,
        contentHash: change.contentHash,
        path: change.path,
        lastVaultSeq: change.vaultSeq,
      });
      return;
    }

    const target = this.remoteTarget(change);
    const local = await this.readApplySource(identity, change);
    const base = this.state.getDocumentState(identity.vaultId, identity.epoch, change.kind, change.id);
    const prior = this.state.getApplyIntent(identity.vaultId, identity.epoch, change);
    if (prior === undefined) {
      if (local === null && base !== undefined) {
        this.stopApply(identity, change, 'The last synced document is missing locally');
      }
      if (local !== null && !sameRevision(local, target) &&
          (base === undefined || local.hash !== base.contentHash || local.path !== base.path)) {
        await this.reserveConflict(identity, change, local, writes);
      }
    }

    const intent = prior ?? this.state.reserveApplyIntent(identity.vaultId, identity.epoch, {
      change, base: base ?? null, source: fileRevision(local), target, createdAt: this.now(),
    });
    if (!sameRevision(intent.target, target)) {
      this.stopApply(identity, change, 'The incoming target differs from the recorded apply intent');
    }
    if (!sameRevision(local, intent.target)) {
      if (!sameRevision(local, intent.source)) {
        this.stopApply(identity, change, 'The local revision differs from the recorded source and target');
      }
      await this.guardApply(identity, change, () => this.writeRemoteChange(change, local, writes));
    }
    this.state.transaction(() => {
      this.state.markApplyCommitted(identity.vaultId, identity.epoch, change);
      this.state.discardCompletedNonConflictIntent(identity.vaultId, identity.epoch, change);
      this.state.setDocumentState(identity.vaultId, identity.epoch, {
        kind: change.kind,
        id: change.id,
        version: change.version,
        contentHash: change.contentHash,
        path: change.path,
        lastVaultSeq: change.vaultSeq,
      });
    });
  }

  private async applyRemoteDeleteLocked(identity: SyncIdentity, change: ChangeRecord, writes: SyncWriteSession): Promise<void> {
    this.assertResolutionScope(identity);
    if (this.state.isResolutionConsumed(identity, change)) return;
    this.assertNoActiveResolution(identity, change);
    this.assertApplyUnblocked(identity, change);
    await this.recoverConflict(identity, change, writes);
    const applied = this.state.getApplyEntry(
      identity.vaultId, identity.epoch, change.kind, change.id, change.version, change.contentHash,
    );
    if (applied?.status === 'committed') return;
    const local = await this.readApplySource(identity, change);
    const base = this.state.getDocumentState(identity.vaultId, identity.epoch, change.kind, change.id);
    const prior = this.state.getApplyIntent(identity.vaultId, identity.epoch, change);
    if (prior === undefined && local !== null &&
        (base === undefined || local.hash !== base.contentHash || local.path !== base.path)) {
      await this.reserveConflict(identity, change, local, writes);
    }

    const intent = prior ?? this.state.reserveApplyIntent(identity.vaultId, identity.epoch, {
      change, base: base ?? null, source: fileRevision(local), target: null, createdAt: this.now(),
    });
    if (intent.target !== null) {
      this.stopApply(identity, change, 'The recorded apply intent is for a live document');
    }
    if (local !== null) {
      if (!sameRevision(local, intent.source)) {
        this.stopApply(identity, change, 'The local revision differs from the recorded deletion source');
      }
      await this.guardApply(identity, change, () => this.deleteLocalDocument(local, writes));
    }
    this.state.transaction(() => {
      this.state.markApplyCommitted(identity.vaultId, identity.epoch, change);
      this.state.discardCompletedNonConflictIntent(identity.vaultId, identity.epoch, change);
      this.state.deleteDocumentState(identity.vaultId, identity.epoch, change.kind, change.id);
    });
  }

  private async reserveConflict(
    identity: SyncIdentity,
    change: ChangeRecord,
    local: LocalDocument,
    writes: SyncWriteSession,
  ): Promise<{ conflictId: string; conflictPath: string }> {
    let record = this.state.getConflict(identity.vaultId, identity.epoch, change);
    if (record === undefined) {
      const legacy = this.state.getApplyEntry(
        identity.vaultId, identity.epoch, change.kind, change.id, change.version, change.contentHash,
      );
      if (legacy?.conflictId !== undefined) {
        throw new Error(`Legacy conflict ${legacy.conflictId} requires manual inspection`);
      }

      const now = this.now();
      const suffix = conflictSuffix(now, this.deviceId);
      const note = local.note === undefined ? undefined : makeConflictNote(
        local.note, suffix, await this.allLocalPaths(), now.replace(/\.\d{3}Z$/, 'Z'),
      );
      const database = local.database === undefined ? undefined : makeConflictDatabase(local.database, suffix);
      const copy = note ?? database;
      if (copy === undefined) throw new Error('Cannot copy unknown sync document');
      const copyText = note !== undefined ? serializeNote(note.document) : serializeDatabase(database!.document);
      record = this.state.reserveConflict(identity.vaultId, identity.epoch, change, {
        conflictId: copy.document.id,
        conflictPath: copy.path,
        localPath: local.path,
        localHash: local.hash,
        copyHash: hashHex(copyText),
        copyText,
      });
    }

    await this.verifyConflictCopy(identity, change, record, writes);
    if (local.hash !== record.localHash || local.path !== record.localPath) {
      this.stopApply(identity, change, `Local revision changed after reserving conflict ${record.conflictId}`);
    }
    return record;
  }

  private async recoverConflict(identity: SyncIdentity, change: ChangeRecord, writes: SyncWriteSession): Promise<void> {
    const record = this.state.getConflict(identity.vaultId, identity.epoch, change);
    if (record !== undefined) await this.verifyConflictCopy(identity, change, record, writes);
  }

  private async verifyConflictCopy(identity: SyncIdentity, change: ChangeRecord, record: ConflictRecord, writes: SyncWriteSession): Promise<void> {
    try {
      await this.ensureConflictCopy(change.kind, record, writes);
    } catch (error) {
      if (error instanceof ConflictCopyMismatch ||
          (isStorageError(error) && ['DUPLICATE_ID', 'INVALID_CONTENT'].includes(error.code))) {
        this.stopApply(identity, change, error.message);
      }
      throw error;
    }
  }

  private async ensureConflictCopy(kind: DocumentKind, record: ConflictRecord, writes: SyncWriteSession): Promise<void> {
    let copy = await this.readLocalDocument(kind, record.conflictId);
    if (copy === null && record.published === 0) {
      if (hashHex(record.copyText) !== record.copyHash) {
        throw new ConflictCopyMismatch(`Staged conflict copy ${record.conflictId} is corrupt`);
      }
      if (kind === 'note') {
        await writes.createNote(parseNote(record.copyText, record.conflictPath));
      } else {
        await writes.createDatabase(parseDatabase(record.copyText));
      }
      copy = await this.readLocalDocument(kind, record.conflictId);
    }
    if (copy === null || copy.path !== record.conflictPath || copy.hash !== record.copyHash) {
      throw new ConflictCopyMismatch(`Conflict copy ${record.conflictId} is missing or modified`);
    }
    if (record.published === 0) this.state.markConflictPublished(record.conflictId);
  }

  private remoteTarget(change: ChangeRecord): FileRevision {
    const content = change.content ?? '';
    if (hashHex(content) !== change.contentHash) {
      throw new Error(`Content hash mismatch for ${change.kind} ${change.id}`);
    }
    const document = change.kind === 'note' ? parseNote(content, change.path) : parseDatabase(content);
    if (document.id !== change.id) throw new Error(`Remote document ID mismatch for ${change.id}`);
    const text = 'body' in document ? serializeNote(document) : serializeDatabase(document);
    const path = change.kind === 'note' ? change.path : `databases/${change.id}.json`;
    return { path, hash: hashHex(text) };
  }

  private stopApply(identity: SyncIdentity, change: ChangeRecord, reason: string): never {
    this.state.blockApply(identity.vaultId, identity.epoch, change, reason);
    throw new Error(`Remote apply needs recovery for ${change.id}: ${reason}`);
  }

  private async readApplySource(identity: SyncIdentity, change: ChangeRecord): Promise<LocalDocument | null> {
    try {
      return await this.readLocalDocument(change.kind, change.id);
    } catch (error) {
      if (this.state.getApplyIntent(identity.vaultId, identity.epoch, change) !== undefined &&
          isStorageError(error) && ['DUPLICATE_ID', 'INVALID_CONTENT'].includes(error.code)) {
        this.stopApply(identity, change, error.message);
      }
      throw error;
    }
  }

  private async writeRemoteChange(change: ChangeRecord, local: LocalDocument | null, writes: SyncWriteSession): Promise<void> {
    if (change.kind === 'note') {
      const content = change.content ?? '';
      if (hashHex(content) !== change.contentHash) {
        throw new Error(`Content hash mismatch for note ${change.id}`);
      }
      const note = parseNote(content, change.path);
      if (note.id !== change.id) throw new Error(`Remote note ID mismatch for ${change.id}`);
      if (local !== null && local.path !== change.path) {
        await writes.relocateNote(change.id, change.path, {
          expectedPath: local.path,
          expectedHash: local.hash,
        }, note);
      } else if (local === null) {
        await writes.createNote(note);
      } else {
        await writes.replaceNote(note, { expectedHash: local.hash, expectedPath: local.path });
      }
      return;
    }

    const content = change.content ?? '';
    if (hashHex(content) !== change.contentHash) {
      throw new Error(`Content hash mismatch for database ${change.id}`);
    }
    const database = parseDatabase(content);
    if (database.id !== change.id) throw new Error(`Remote database ID mismatch for ${change.id}`);
    if (local === null) {
      await writes.createDatabase(database);
    } else {
      await writes.replaceDatabase(database, { expectedHash: local.hash });
    }
  }

  private assertNoActiveResolution(scope: SyncIdentity, document: DocumentRef): void {
    const decision = this.state.getResolutionForDocument(scope, document.kind, document.id);
    if (decision !== null) throw new Error(`Resolution decision ${decision.intent.decisionId} requires execution or recovery`);
  }

  private assertApplyUnblocked(identity: SyncIdentity, change: ChangeRecord): void {
    const reason = this.state.getBlockedApply(identity.vaultId, identity.epoch, change);
    if (reason !== undefined) throw new Error(`Remote apply needs recovery for ${change.id}: ${reason}`);
  }

  private async guardApply(identity: SyncIdentity, change: ChangeRecord, write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error) {
      if (isStorageError(error) &&
          ['STALE_WRITE', 'NOT_FOUND', 'PARTIAL_WRITE', 'DUPLICATE_ID'].includes(error.code)) {
        this.state.blockApply(identity.vaultId, identity.epoch, change, error.message);
      }
      throw error;
    }
  }

  private async deleteLocalDocument(local: LocalDocument, writes: SyncWriteSession): Promise<void> {
    if (local.kind === 'note') {
      await writes.deleteNote(local.id, { expectedHash: local.hash, expectedPath: local.path });
    } else {
      await writes.deleteDatabase(local.id, { expectedHash: local.hash });
    }
  }

  private async readLocalDocument(kind: DocumentKind, id: string): Promise<LocalDocument | null> {
    try {
      if (kind === 'note') {
        const { note, hash, text } = await this.vault.readNoteWithHash(id);
        return { kind, id, path: note.path, raw: text, hash, note };
      }
      const { database, hash, text } = await this.vault.readDatabaseWithHash(id);
      return { kind, id, path: `databases/${id}.json`, hash, raw: text, database };
    } catch (error) {
      if (isStorageError(error) && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }

  private async allLocalPaths(): Promise<Set<string>> {
    const notes = await this.vault.listNotes();
    const databases = await this.vault.listDatabases();
    return new Set(
      [...notes.map((note) => note.path), ...databases.map((database) => database.path)].map(foldPath),
    );
  }

  private async ensureDeviceSeq(identity: SyncIdentity): Promise<void> {
    if (this.state.getMeta('device_seq') !== undefined) return;
    const state = await this.request<{ lastSeq: number }>('/device/state', { identity });
    this.state.setMeta('device_seq', String(state.lastSeq));
  }

  private rememberIdentity(identity: VaultIdentity): void {
    const previous = this.state.getMeta('vault_id');
    if (previous !== identity.vaultId) {
      this.state.setMeta('vault_id', identity.vaultId);
      this.state.setMeta('epoch', String(identity.epoch));
      this.state.setMeta('cursor', '');
    } else {
      this.state.setMeta('epoch', String(identity.epoch));
    }
  }

  /** Reads metadata for the vault lineage last recorded by this client. */
  listConflicts(options?: ConflictPageOptions): ConflictPage {
    const scope = this.conflictScope();
    return scope === null ? { conflicts: [], next: null } : this.state.listConflicts(scope, options);
  }

  getConflictDetails(conflictId: string): ConflictSummary | null {
    const scope = this.conflictScope();
    return scope === null ? null : this.state.getConflictDetails(scope, conflictId);
  }

  /** Exact locally recorded conflict evidence for read-only inspection. This never fetches or mutates remote content. */
  async inspectConflict(conflictId: string) {
    const scope = this.conflictScope();
    if (scope === null) return null;
    const summary = this.state.getConflictDetails(scope, conflictId);
    if (summary === null) return null;
    const change = this.state.recordedChange(scope, conflictRevisionKey(scope, conflictId));
    if (change === null) return { summary, local: null, remote: null, copy: null, diagnostics: ['Incoming revision evidence is unavailable'] };
    const local = await this.readLocalDocument(change.kind, change.id);
    const record = this.state.getConflict(scope.vaultId, scope.epoch, change);
    const diagnostics: string[] = [];
    if (summary.local !== null && (local === null || local.hash !== summary.local.hash || local.path !== summary.local.path)) {
      diagnostics.push('The current local document differs from the revision captured when this conflict was detected.');
    }
    let copy: { id: string; path: string; expectedHash: string; actualHash: string | null; actualPath: string | null; verified: boolean; content: string | null } | null = null;
    if (record !== undefined) {
      const published = record.published === 1 ? await this.readLocalDocument(change.kind, record.conflictId) : null;
      const content = published?.raw ?? null;
      const verified = published?.hash === record.copyHash && published.path === record.conflictPath;
      if (!verified) diagnostics.push('The preserved conflict copy is missing or differs from its reserved path or hash.');
      copy = {
        id: record.conflictId,
        path: record.conflictPath,
        expectedHash: record.copyHash,
        actualHash: published?.hash ?? null,
        actualPath: published?.path ?? null,
        verified,
        content: verified ? content : null,
      };
    }
    const remoteContent = change.content ?? null;
    const remoteVerified = remoteContent === null ? change.op === 'delete' : hashHex(remoteContent) === change.contentHash;
    if (!remoteVerified) diagnostics.push('The recorded incoming bytes do not match the relay revision hash.');
    return {
      summary,
      local: local === null ? null : { id: local.id, path: local.path, hash: local.hash, content: local.raw! },
      remote: {
        id: change.id, path: change.path, version: change.version, hash: change.contentHash,
        operation: change.op, timestamp: change.timestamp, content: remoteContent,
        verified: remoteVerified,
      },
      copy,
      diagnostics,
    };
  }

  async previewMergedCopy(
    conflictId: string,
    draftContent: string,
    reviewed: { localHash: string | null; remoteHash: string; copyHash: string | null },
  ) {
    return this.vault.withSyncWrite(async () => {
      const inspection = await this.inspectConflict(conflictId);
      if (inspection === null || inspection.remote === null || !inspection.remote.verified ||
          (inspection.summary.local?.hash ?? null) !== (inspection.local?.hash ?? null) ||
          (inspection.summary.local?.path ?? null) !== (inspection.local?.path ?? null) ||
          inspection.remote.hash !== reviewed.remoteHash || (inspection.local?.hash ?? null) !== reviewed.localHash ||
          (inspection.copy?.expectedHash ?? null) !== reviewed.copyHash ||
          (inspection.copy !== null && !inspection.copy.verified)) {
        throw new ResolutionEvidenceError('Conflict evidence changed since review', true);
      }
      if (typeof draftContent !== 'string' || draftContent.length > 2_000_000) throw new Error('Merged content is invalid or too large');
      const kind = inspection.summary.document.kind;
      const id = randomUUID();
      if (kind === 'note') {
        const sourcePath = inspection.local?.path ?? inspection.remote.path;
        const note = parseNote(draftContent, sourcePath);
        const filename = note.title.normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 64) || 'merged-note';
        const path = `notes/${filename}-${id.slice(0, 8)}.md`;
        const title = `${note.title.slice(0, 180).trimEnd()} (Merged)`;
        const content = serializeNote({ ...note, id, title, path, sourceFormat: undefined });
        return { id, path, content, contentHash: hashHex(content) };
      }
      const database = parseDatabase(draftContent);
      const content = serializeDatabase({ ...database, id });
      return { id, path: `databases/${id}.json`, content, contentHash: hashHex(content) };
    });
  }

  async previewRemoteResolution(
    conflictId: string,
    reviewed: { localHash: string | null; remoteHash: string; copyHash: string | null },
  ) {
    return this.vault.withSyncWrite(async () => {
      const inspection = await this.inspectConflict(conflictId);
      if (inspection === null || inspection.remote === null || !inspection.remote.verified || inspection.remote.content === null ||
          (inspection.summary.local?.hash ?? null) !== (inspection.local?.hash ?? null) ||
          (inspection.summary.local?.path ?? null) !== (inspection.local?.path ?? null) ||
          inspection.remote.hash !== reviewed.remoteHash || (inspection.local?.hash ?? null) !== reviewed.localHash ||
          (inspection.copy?.expectedHash ?? null) !== reviewed.copyHash ||
          (inspection.copy !== null && !inspection.copy.verified)) {
        throw new ResolutionEvidenceError('Conflict evidence changed since review', true);
      }
      const kind = inspection.summary.document.kind;
      const content = kind === 'note'
        ? serializeNote(parseNote(inspection.remote.content, inspection.remote.path))
        : serializeDatabase(parseDatabase(inspection.remote.content));
      return {
        id: inspection.remote.id,
        path: inspection.remote.path,
        content,
        contentHash: hashHex(content),
      };
    });
  }

  /** Records caller-supplied expectations. Filesystem verification belongs to execution. */
  async prepareResolutionDecision(scope: SyncIdentity, intent: ResolutionIntent) {
    return this.vault.withSyncWrite(async () => {
      this.assertResolutionScope(scope);
      return this.state.prepareResolutionDecision(scope, intent);
    });
  }

  async prepareReviewedResolutionDecision(
    scope: SyncIdentity,
    intent: ResolutionIntent,
    reviewed: { localHash: string | null; remoteHash: string; copyHash: string | null },
  ) {
    return this.vault.withSyncWrite(async () => {
      this.assertResolutionScope(scope);
      const inspection = await this.inspectConflict(intent.conflictId);
      if (inspection === null || inspection.remote === null || !inspection.remote.verified ||
          inspection.summary.document.kind !== intent.document.kind || inspection.summary.document.id !== intent.document.id ||
          (inspection.summary.local?.hash ?? null) !== (inspection.local?.hash ?? null) ||
          (inspection.summary.local?.path ?? null) !== (inspection.local?.path ?? null) ||
          inspection.remote.hash !== reviewed.remoteHash || (inspection.local?.hash ?? null) !== reviewed.localHash ||
          (inspection.copy?.expectedHash ?? null) !== reviewed.copyHash ||
          (inspection.copy !== null && !inspection.copy.verified)) {
        throw new ResolutionEvidenceError('Conflict evidence changed since review', true);
      }
      const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
      const expectedLocal = inspection.local === null ? null : {
        id: inspection.local.id, path: inspection.local.path, contentHash: inspection.local.hash, content: inspection.local.content,
      };
      const expectedCopy = inspection.copy?.content === null || inspection.copy === null ? null : {
        id: inspection.copy.id, path: inspection.copy.path, contentHash: inspection.copy.expectedHash, content: inspection.copy.content,
      };
      if (!same(intent.expectedLocal, expectedLocal) || !same(intent.expectedCopy, expectedCopy) ||
          intent.expectedRemote.path !== inspection.remote.path ||
          intent.expectedRemote.version !== inspection.remote.version || intent.expectedRemote.contentHash !== inspection.remote.hash ||
          intent.expectedRemote.operation !== inspection.remote.operation || intent.expectedRemote.content !== inspection.remote.content ||
          !same(intent.expectedBase, inspection.summary.base)) {
        throw new ResolutionEvidenceError('Decision intent does not match the reviewed local, remote, base, or copy snapshot', true);
      }
      return this.state.prepareResolutionDecision(scope, intent);
    });
  }

  async executeMergedCopyDecision(scope: SyncIdentity, decisionId: string): Promise<ResolutionDecision> {
    return this.vault.withSyncWrite(async (writes) => {
      this.assertResolutionScope(scope);
      let decision = this.state.getResolutionDecision(scope, decisionId);
      if (decision === null) throw new Error('Resolution decision is unavailable');
      if (decision.intent.action !== 'save-merged-copy') throw new Error('This executor supports save-merged-copy');
      if (decision.status === 'completed' || decision.status === 'rejected-stale') return decision;
      try {
        let intent: ResolutionIntent;
        try { intent = normalizeResolutionIntent(decision.intent); }
        catch (error) {
          throw new ResolutionEvidenceError('Invalid reviewed merged payload: ' + (error instanceof Error ? error.message : String(error)));
        }
        const target = intent.target!;
        const kind = intent.document.kind;
        const change = this.state.recordedChange(scope, conflictRevisionKey(scope, intent.conflictId));
        if (change === null || change.kind !== kind || change.id !== intent.document.id ||
            change.epoch !== scope.epoch || change.version !== intent.expectedRemote.version ||
            change.path !== intent.expectedRemote.path || change.op !== intent.expectedRemote.operation ||
            change.contentHash !== intent.expectedRemote.contentHash || (change.content ?? null) !== intent.expectedRemote.content) {
          throw new ResolutionEvidenceError('Merged-copy source revision differs from the recorded conflict');
        }
        await this.verifyResolutionRemote(scope, intent, change);
        await this.verifyMergedSources(scope, intent, change);
        // A new local document must not take an existing or retired relay identity.
        try {
          await this.request<DocumentContent>('/docs/' + kind + '/' + encodeURIComponent(target.id) + '?version=1', { identity: scope });
          throw new ResolutionEvidenceError('Merged identity already exists on the relay');
        } catch (error) {
          if (!(error instanceof SyncHttpError && error.status === 404 && error.code === 'NOT_FOUND')) {
            if (error instanceof SyncHttpError && (error.status === 409 || error.status === 410)) {
              throw new ResolutionEvidenceError('Merged identity is already used or retired');
            }
            throw error;
          }
        }
        let reservation = this.state.getMergedPublication(scope, decisionId);
        if (reservation === null) {
          if (this.state.hasSyncedIdentity(scope, kind, target.id) ||
              await this.readLocalDocument(kind, target.id) !== null ||
              await this.vault.inspectReviewedPublication(kind, target) !== null) {
            throw new ResolutionEvidenceError('Merged destination or identity already exists');
          }
          if (decision.status !== 'applying') decision = this.state.transitionResolutionDecision(scope, decisionId,
            { expectedRevision: decision.revision, status: 'applying' });
          reservation = this.state.reserveMergedPublication(scope, decisionId);
          if (reservation === null) throw new ResolutionEvidenceError('Merged identity or path is reserved by another decision');
        }
        if (reservation.kind !== kind || reservation.id !== target.id || reservation.path !== target.path ||
            reservation.contentHash !== target.contentHash) throw new ResolutionEvidenceError('Merged reservation differs from reviewed payload');
        if (decision.status !== 'applying') decision = this.state.transitionResolutionDecision(scope, decisionId,
          { expectedRevision: decision.revision, status: 'applying' });
        let published = await this.vault.inspectReviewedPublication(kind, target);
        if (published === null) {
          if (await this.readLocalDocument(kind, target.id) !== null) {
            throw new ResolutionEvidenceError('Merged document identity is stored at a different path');
          }
          if ((reservation.stagingPath === null && (reservation.dev !== null || reservation.ino !== null)) ||
              (reservation.stagingPath !== null && (reservation.dev === null || reservation.ino === null))) {
            throw new ResolutionEvidenceError('Merged publication anchor metadata is incomplete');
          }
          if (reservation.stagingPath !== null) {
            const staged = await this.vault.inspectReviewedPublicationAnchor(kind, target, reservation.stagingPath);
            if (staged === null || staged.dev !== reservation.dev || staged.ino !== reservation.ino || staged.hash !== target.contentHash) {
              throw new ResolutionEvidenceError('Reserved merged publication anchor is missing or changed');
            }
          }
          await writes.publishReviewedDocument(kind, target, async (identity) => {
            this.state.recordMergedPublicationIdentity(scope, decisionId, identity);
          }, reservation.stagingPath ?? undefined);
          published = await this.vault.inspectReviewedPublication(kind, target);
        }
        reservation = this.state.getMergedPublication(scope, decisionId)!;
        const anchor = reservation.stagingPath === null ? null :
          await this.vault.inspectReviewedPublicationAnchor(kind, target, reservation.stagingPath);
        const result = await this.readLocalDocument(kind, target.id);
        if (published === null || anchor === null || reservation.dev === null || reservation.ino === null || reservation.stagingPath === null ||
            anchor.dev !== reservation.dev || anchor.ino !== reservation.ino || anchor.hash !== target.contentHash ||
            published.dev !== reservation.dev || published.ino !== reservation.ino ||
            published.hash !== target.contentHash ||
            !sameRevision(result, { path: target.path, hash: target.contentHash })) {
          throw new ResolutionEvidenceError('Merged destination lacks matching publication ownership or bytes');
        }
        await this.verifyMergedSources(scope, intent, change);
        return this.state.completeMergedPublication(scope, decisionId, decision.revision);
      } catch (error) {
        if (error instanceof ResolutionEvidenceError || error instanceof ConflictCopyMismatch || isStorageError(error)) {
          const current = this.state.getResolutionDecision(scope, decisionId)!;
          if (current.status === 'needs-recovery') return current;
          return this.state.transitionResolutionDecision(scope, decisionId, {
            expectedRevision: current.revision,
            status: error instanceof ResolutionEvidenceError && error.stale && current.status === 'prepared'
              ? 'rejected-stale' : 'needs-recovery',
            diagnostic: error.message,
          });
        }
        throw error;
      }
    });
  }

  private async verifyMergedSources(scope: SyncIdentity, intent: ResolutionIntent, change: ChangeRecord): Promise<void> {
    const local = await this.readLocalDocument(change.kind, change.id);
    const expected = intent.expectedLocal === null ? null :
      { path: intent.expectedLocal.path, hash: intent.expectedLocal.contentHash };
    if (!sameRevision(local, expected)) throw new ResolutionEvidenceError('Merged local source changed or is missing', true);
    const record = this.state.getConflict(scope.vaultId, scope.epoch, change);
    if (intent.expectedCopy === null) {
      if (record !== undefined) throw new ResolutionEvidenceError('Conflict-copy evidence changed after merge review', true);
    } else {
      if (record === undefined || record.conflictId !== intent.expectedCopy.id || record.conflictPath !== intent.expectedCopy.path ||
          record.copyHash !== intent.expectedCopy.contentHash || record.published !== 1) {
        throw new ResolutionEvidenceError('Merged copy source reservation is incomplete or changed');
      }
      const copy = await this.readLocalDocument(change.kind, record.conflictId);
      if (!sameRevision(copy, { path: record.conflictPath, hash: record.copyHash })) {
        throw new ResolutionEvidenceError('Merged preserved source changed or is missing');
      }
    }
  }

  async executeKeepLocalDecision(scope: SyncIdentity, decisionId: string): Promise<ResolutionDecision> {
    return this.vault.withSyncWrite((writes) => this.executeKeepLocalLocked(scope, decisionId, writes));
  }

  getKeepLocalReconciliation(scope: SyncIdentity, decisionId: string) {
    this.assertResolutionScope(scope);
    if (this.state.getResolutionDecision(scope, decisionId) === null) return null;
    const delivery = this.state.getResolutionOutbox(scope, decisionId);
    if (delivery === null) return null;
    const result = delivery.receipt?.results[0] ?? null;
    return {
      operationId: delivery.operationId, deviceSeq: delivery.deviceSeq,
      delivery: result === null ? delivery.stage : result.status,
      relayAccepted: result === null ? null : result.status === 'applied',
      relayVersion: result?.version ?? null, vaultSeq: result?.vaultSeq ?? null,
      diagnostic: result?.reason ?? result?.code ?? null,
    };
  }

  private async executeKeepLocalLocked(scope: SyncIdentity, decisionId: string, writes: SyncWriteSession): Promise<ResolutionDecision> {
    this.assertResolutionScope(scope);
    let decision = this.state.getResolutionDecision(scope, decisionId);
    if (decision === null) throw new Error('Resolution decision is unavailable');
    if (decision.intent.action !== 'keep-local') throw new Error('This executor supports keep-local');
    if (decision.status === 'completed' || decision.status === 'rejected-stale') return decision;
    try {
      let intent: ResolutionIntent;
      try { intent = normalizeResolutionIntent(decision.intent); }
      catch (error) {
        throw new ResolutionEvidenceError('Invalid stored keep-local intent: ' + (error instanceof Error ? error.message : String(error)));
      }
      const key = conflictRevisionKey(scope, intent.conflictId);
      const change = this.state.recordedChange(scope, key);
      if (change === null || change.kind !== intent.document.kind || change.id !== intent.document.id ||
          change.version !== intent.expectedRemote.version || change.contentHash !== intent.expectedRemote.contentHash ||
          change.path !== intent.expectedRemote.path || change.op !== intent.expectedRemote.operation ||
          (change.content ?? null) !== intent.expectedRemote.content || change.epoch !== scope.epoch ||
          change.op === 'delete') throw new ResolutionEvidenceError('Live incoming revision differs from the decision');

      const identity = await this.identity();
      if (identity.vaultId !== scope.vaultId || identity.epoch !== scope.epoch) {
        throw new ResolutionEvidenceError('Relay vault or epoch has changed', true);
      }
      const device = await this.request<{ deviceId: string; lastSeq: number }>('/device/state', { identity: scope });
      if (typeof device.deviceId !== 'string' || !Number.isSafeInteger(device.lastSeq) || device.lastSeq < 0) {
        throw new ResolutionEvidenceError('Relay device sequence is invalid');
      }
      let delivery = this.state.getResolutionOutbox(scope, decisionId);
      if (delivery !== null && delivery.deviceId !== device.deviceId) {
        throw new ResolutionEvidenceError('Conditional outbox belongs to another relay device');
      }
      if (delivery === null) {
        if (this.state.hasPendingDocument(change.kind, change.id)) {
          throw new ResolutionEvidenceError('Pending outgoing edits for this document require a fresh decision', true);
        }
        if (this.state.hasPendingOperations()) {
          throw new ResolutionEvidenceError('Earlier pending outbox operations must be reconciled first');
        }
        await this.verifyResolutionRemote(scope, intent, change);
        const local = await this.readLocalDocument(change.kind, change.id);
        if (!sameRevision(local, { path: intent.target!.path, hash: intent.target!.contentHash })) {
          throw new ResolutionEvidenceError('Local source differs from the keep-local snapshot', true);
        }
        const sequence = this.state.getMeta('device_seq');
        if (sequence !== undefined && Number(sequence) !== device.lastSeq) {
          throw new ResolutionEvidenceError('Local and relay device sequences require reconciliation');
        }
        if (decision.status !== 'applying') decision = this.state.transitionResolutionDecision(scope, decisionId,
          { expectedRevision: decision.revision, status: 'applying' });
        if (sequence === undefined) this.state.setMeta('device_seq', String(device.lastSeq));
        await this.verifyKeepLocalFiles(scope, intent, change, writes, true);
        delivery = this.state.reserveKeepLocalOutbox(scope, decisionId, device.deviceId, randomUUID());
      }
      this.validateKeepLocalOutbox(intent, delivery);
      let receipt = delivery.receipt;
      if (receipt === null && delivery.stage === 'sending') {
        const history = await this.request<{ operations: OperationResult[] }>(
          '/operations?fromDeviceSeq=' + delivery.deviceSeq + '&toDeviceSeq=' + delivery.deviceSeq, { identity: scope },
        );
        if (!Array.isArray(history.operations)) throw new ResolutionEvidenceError('Relay operation history is invalid');
        const stored = history.operations.find((operation) => operation.deviceSeq === delivery!.deviceSeq);
        if (stored !== undefined) {
          if (stored.operationId !== delivery.operationId) {
            throw new ResolutionEvidenceError('Device sequence was used by a different operation');
          }
          receipt = { deviceSeq: stored.deviceSeq, results: stored.results };
        } else if (device.lastSeq >= delivery.deviceSeq) {
          throw new ResolutionEvidenceError('Relay consumed this sequence but its operation result is unavailable');
        }
      }
      if (receipt === null) {
        await this.verifyKeepLocalFiles(scope, intent, change, writes, false);
        if (device.lastSeq !== delivery.deviceSeq - 1) {
          throw new ResolutionEvidenceError('Conditional update is not the next relay device sequence');
        }
        const current = this.state.getResolutionDecision(scope, decisionId)!;
        if (current.status === 'needs-recovery') this.state.transitionResolutionDecision(scope, decisionId,
          { expectedRevision: current.revision, status: 'applying' });
        this.state.markResolutionSending(scope, decisionId);
        receipt = await this.request<Pick<OperationResult, 'deviceSeq' | 'results'>>('/push', {
          method: 'POST', identity: scope,
          body: { operationId: delivery.operationId, deviceSeq: delivery.deviceSeq, changes: delivery.changes },
        });
      }
      this.validateKeepLocalReceipt(intent, delivery, receipt);
      let diagnostic: string | null = null;
      if (receipt.results[0]!.status === 'applied') {
        try { await this.verifyKeepLocalFiles(scope, intent, change, writes, false); }
        catch (error) {
          if (error instanceof ResolutionEvidenceError || error instanceof ConflictCopyMismatch || isStorageError(error)) diagnostic = error.message;
          else throw error;
        }
      }
      return this.state.finishKeepLocalPush(scope, decisionId, receipt, diagnostic === null, diagnostic);
    } catch (error) {
      if (error instanceof ResolutionEvidenceError || error instanceof ConflictCopyMismatch || isStorageError(error)) {
        const current = this.state.getResolutionDecision(scope, decisionId)!;
        if (current.status === 'needs-recovery') return current;
        const reserved = this.state.getResolutionOutbox(scope, decisionId) !== null;
        return this.state.transitionResolutionDecision(scope, decisionId, {
          expectedRevision: current.revision,
          status: !reserved && error instanceof ResolutionEvidenceError && error.stale && current.status === 'prepared'
            ? 'rejected-stale' : 'needs-recovery',
          diagnostic: error.message,
        });
      }
      throw error;
    }
  }

  private async verifyKeepLocalFiles(scope: SyncIdentity, intent: ResolutionIntent, change: ChangeRecord,
    writes: SyncWriteSession, createPreservation: boolean): Promise<void> {
    const local = await this.readLocalDocument(change.kind, change.id);
    if (local === null || !sameRevision(local, { path: intent.target!.path, hash: intent.target!.contentHash })) {
      throw new ResolutionEvidenceError('Local source differs from the keep-local snapshot', true);
    }
    let record = this.state.getConflict(scope.vaultId, scope.epoch, change);
    if (intent.expectedCopy !== null && (record === undefined || record.conflictId !== intent.expectedCopy.id ||
        record.conflictPath !== intent.expectedCopy.path || record.copyHash !== intent.expectedCopy.contentHash)) {
      throw new ResolutionEvidenceError('Conflict-copy reservation differs from the keep-local decision');
    }
    if (record === undefined) {
      if (!createPreservation) throw new ResolutionEvidenceError('Keep-local preservation evidence is missing');
      await this.reserveConflict(scope, change, local, writes);
      record = this.state.getConflict(scope.vaultId, scope.epoch, change)!;
    }
    await this.ensureConflictCopy(change.kind, record, writes);
  }

  private validateKeepLocalOutbox(intent: ResolutionIntent, delivery: ResolutionOutbox): void {
    const local = intent.target!;
    const expected: ChangeInput = {
      kind: intent.document.kind, id: intent.document.id, op: 'update',
      baseVersion: intent.expectedRemote.version, version: intent.expectedRemote.version + 1,
      path: local.path, contentHash: local.contentHash, content: local.content,
    };
    if (JSON.stringify(delivery.changes) !== JSON.stringify([expected]) ||
        !Number.isSafeInteger(delivery.deviceSeq) || delivery.deviceSeq < 1) {
      throw new ResolutionEvidenceError('Conditional outbox differs from the immutable decision');
    }
  }

  private validateKeepLocalReceipt(intent: ResolutionIntent, delivery: ResolutionOutbox,
    receipt: Pick<OperationResult, 'deviceSeq' | 'results'>): void {
    const result = receipt.results?.[0];
    if (receipt.deviceSeq !== delivery.deviceSeq || !Array.isArray(receipt.results) || receipt.results.length !== 1 ||
        result?.kind !== intent.document.kind || result.id !== intent.document.id ||
        !['applied', 'conflict', 'rejected'].includes(result.status) ||
        (result.status === 'applied' && (result.version !== intent.expectedRemote.version + 1 ||
          !Number.isSafeInteger(result.vaultSeq) || result.vaultSeq! < 1))) {
      throw new ResolutionEvidenceError('Relay conditional push result is invalid');
    }
  }

  async executeKeepRemoteDecision(scope: SyncIdentity, decisionId: string): Promise<ResolutionDecision> {
    return this.vault.withSyncWrite(async (writes) => {
      this.assertResolutionScope(scope);
      let decision = this.state.getResolutionDecision(scope, decisionId);
      if (decision === null) throw new Error('Resolution decision is unavailable');
      if (decision.intent.action !== 'keep-remote') throw new Error('This executor supports keep-remote');
      if (decision.status === 'completed' || decision.status === 'rejected-stale') return decision;
      try {
        let intent: ResolutionIntent;
        try {
          intent = normalizeResolutionIntent(decision.intent);
        } catch (error) {
          throw new ResolutionEvidenceError('Invalid stored decision intent: ' +
            (error instanceof Error ? error.message : String(error)));
        }
        const key = conflictRevisionKey(scope, intent.conflictId);
        let change: ChangeRecord | null;
        try {
          change = this.state.recordedChange(scope, key);
        } catch {
          throw new ResolutionEvidenceError('Recorded incoming change is unreadable');
        }
        if (change === null || change.kind !== intent.document.kind || change.id !== intent.document.id ||
            change.version !== intent.expectedRemote.version || change.contentHash !== intent.expectedRemote.contentHash ||
            change.path !== intent.expectedRemote.path || change.op !== intent.expectedRemote.operation ||
            (change.content ?? null) !== intent.expectedRemote.content || change.epoch !== scope.epoch) {
          throw new ResolutionEvidenceError('Recorded incoming change differs from the decision');
        }
        if (this.state.hasPendingDocument(change.kind, change.id)) {
          throw new ResolutionEvidenceError('Pending outgoing edits must be reconciled before resolving', true);
        }
        await this.verifyResolutionRemote(scope, intent, change);
        const local = await this.readLocalDocument(change.kind, change.id);
        const source = intent.expectedLocal === null ? null :
          { path: intent.expectedLocal.path, hash: intent.expectedLocal.contentHash };
        const target = intent.target === null ? null :
          { path: intent.target.path, hash: intent.target.contentHash };
        const atTarget = sameRevision(local, target);
        if (decision.status === 'prepared' ? !sameRevision(local, source) :
            !atTarget && !sameRevision(local, source)) {
          throw new ResolutionEvidenceError('Local source differs from the decision snapshot', true);
        }
        if (atTarget && source !== null && target !== null && source.path !== target.path) {
          try {
            await this.vault.readNoteAtPath(source.path);
            throw new ResolutionEvidenceError('Both relocation paths are occupied');
          } catch (error) {
            if (!(isStorageError(error) && error.code === 'NOT_FOUND')) throw error;
          }
        }
        let record = this.state.getConflict(scope.vaultId, scope.epoch, change);
        if (intent.expectedCopy !== null && (record === undefined ||
            record.conflictId !== intent.expectedCopy.id || record.conflictPath !== intent.expectedCopy.path ||
            record.copyHash !== intent.expectedCopy.contentHash)) {
          throw new ResolutionEvidenceError('Conflict-copy reservation differs from the decision');
        }
        if (!atTarget && source !== null && record !== undefined &&
            (record.localHash !== source.hash || record.localPath !== source.path)) {
          throw new ResolutionEvidenceError('Preserved copy does not represent the selected local source');
        }
        if (decision.status === 'needs-recovery' || decision.status === 'prepared') {
          decision = this.state.transitionResolutionDecision(scope, decisionId,
            { expectedRevision: decision.revision, status: 'applying' });
        }
        if (record === undefined && intent.expectedLocal !== null) {
          // An absent source after publication is safe only with earlier preservation evidence.
          if (local === null || !sameRevision(local, source)) {
            throw new ResolutionEvidenceError('Local preservation evidence is missing');
          }
          await this.reserveConflict(scope, change, local, writes);
          record = this.state.getConflict(scope.vaultId, scope.epoch, change);
        }
        if (record !== undefined) await this.ensureConflictCopy(change.kind, record, writes);
        if (!atTarget) {
          if (change.op === 'delete') {
            if (local !== null) await this.deleteLocalDocument(local, writes);
          } else {
            await this.writeRemoteChange(change, local, writes);
          }
        }
        const result = await this.readLocalDocument(change.kind, change.id);
        if (!sameRevision(result, target)) throw new ResolutionEvidenceError('Published result differs from the decision target');
        return this.state.completeKeepRemote(scope, decisionId, decision.revision, change,
          intent.target === null ? null : {
            id: change.id, path: intent.target.path, contentHash: intent.target.contentHash,
            relayVersion: change.version,
          });
      } catch (error) {
        if (error instanceof ResolutionEvidenceError || error instanceof ConflictCopyMismatch || isStorageError(error)) {
          const current = this.state.getResolutionDecision(scope, decisionId)!;
          if (current.status === 'needs-recovery') return current;
          return this.state.transitionResolutionDecision(scope, decisionId, {
            expectedRevision: current.revision,
            status: error instanceof ResolutionEvidenceError && error.stale && current.status === 'prepared'
              ? 'rejected-stale' : 'needs-recovery',
            diagnostic: error.message,
          });
        }
        throw error;
      }
    });
  }

  private async verifyResolutionRemote(scope: SyncIdentity, intent: ResolutionIntent, change: ChangeRecord): Promise<void> {
    const identity = await this.identity();
    if (identity.vaultId !== scope.vaultId || identity.epoch !== scope.epoch) {
      throw new ResolutionEvidenceError('Relay vault or epoch has changed', true);
    }
    try {
      const remote = await this.request<DocumentContent>(
        `/docs/${change.kind}/${encodeURIComponent(change.id)}?version=${change.version}`, { identity: scope },
      );
      if (change.op === 'delete') throw new ResolutionEvidenceError('The intended remote deletion is no longer current', true);
      if (remote.kind !== change.kind || remote.id !== change.id || remote.version !== change.version ||
          remote.path !== intent.expectedRemote.path || remote.contentHash !== intent.expectedRemote.contentHash ||
          typeof remote.content !== 'string' || hashHex(remote.content) !== intent.expectedRemote.contentHash ||
          remote.content !== intent.expectedRemote.content) {
        throw new ResolutionEvidenceError('Remote bytes or revision differ from the decision', true);
      }
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 410 && error.code === 'DOCUMENT_RETIRED' &&
          change.op === 'delete' && change.baseVersion > 0 && change.version === change.baseVersion + 1) return;
      if (error instanceof SyncHttpError && (error.status === 409 || error.status === 410)) {
        throw new ResolutionEvidenceError('The selected remote revision is stale or unavailable', true);
      }
      throw error;
    }
  }

  getResolutionDecision(scope: SyncIdentity, decisionId: string) {
    this.assertResolutionScope(scope);
    return this.state.getResolutionDecision(scope, decisionId);
  }

  getResolutionDecisionFromId(decisionId: string) {
    const scope = this.conflictScope();
    return scope === null ? null : this.state.getResolutionDecision(scope, decisionId);
  }

  listResolutionHistory(scope: SyncIdentity, conflictId: string, limit?: number, after?: string) {
    this.assertResolutionScope(scope);
    return this.state.listResolutionHistory(scope, conflictId, limit, after);
  }

  private assertResolutionScope(scope: SyncIdentity): void {
    const current = this.conflictScope();
    if (current === null || scope.vaultId !== current.vaultId || scope.epoch !== current.epoch) {
      throw new Error('Resolution vault and epoch do not match this client');
    }
  }

  private conflictScope(): SyncIdentity | null {
    const vaultId = this.state.getMeta('vault_id');
    const epoch = Number(this.state.getMeta('epoch'));
    return vaultId === undefined || !Number.isSafeInteger(epoch) || epoch < 1 ? null : { vaultId, epoch };
  }

  private identityVaultId(): string {
    return this.state.getMeta('vault_id') ?? '';
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; identity?: SyncIdentity } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      'X-Nodus-Protocol-Version': PROTOCOL_VERSION,
    };
    if (options.identity !== undefined) {
      headers['X-Nodus-Vault-Id'] = options.identity.vaultId;
      headers['X-Nodus-Epoch'] = String(options.identity.epoch);
    }
    if (this.token !== '') headers.Authorization = `Bearer ${this.token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      throw new SyncHttpError(0, 'NETWORK_ERROR', 'Relay is unreachable', error);
    }
    return parseResponse<T>(response);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown;
  try {
    body = text.length === 0 ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const error = body as { error?: { code?: string; message?: string; details?: unknown } } | undefined;
    throw new SyncHttpError(
      response.status,
      error?.error?.code ?? 'HTTP_ERROR',
      error?.error?.message ?? `Relay request failed with ${response.status}`,
      error?.error?.details,
    );
  }
  return body as T;
}

function encodeCursor(seq: number, identity: VaultIdentity): string {
  return Buffer.from(
    JSON.stringify({ seq, vaultId: identity.vaultId, epoch: identity.epoch }),
  ).toString('base64url');
}

function fileRevision(local: LocalDocument | null): FileRevision | null {
  return local === null ? null : { path: local.path, hash: local.hash };
}

function sameRevision(left: FileRevision | null, right: FileRevision | null): boolean {
  return left === null || right === null ? left === right : left.path === right.path && left.hash === right.hash;
}

function hashHex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
