/**
 * Phase 4 sync client.
 *
 * Remote ordering lives on the relay. Local files remain authoritative and are
 * applied through FileSystemVault. State lives in .nodus/sync.sqlite.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DatabaseDefinition } from '../database/schema.js';
import { parseDatabase } from '../database/schema.js';
import type { Note } from '../domain/note.js';
import { parseNote } from '../format/note-format.js';
import { isStorageError } from '../storage/errors.js';
import { resolveInsideRoot, assertInsideRoot, assertNotSymlink } from '../storage/fs/safe-path.js';
import { FileSystemVault } from '../storage/fs/vault.js';
import { conflictSuffix, makeConflictDatabase, makeConflictNote } from './conflicts.js';
import { foldPath } from './paths.js';
import { SyncStateStore } from './state.js';
import type {
  ChangeRecord,
  ChangeInput,
  DocumentContent,
  DocumentHeader,
  DocumentKind,
  DocumentRef,
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

interface LocalDocument {
  kind: DocumentKind;
  id: string;
  path: string;
  raw: string;
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
    const operationId = randomUUID();
    this.state.enqueue(operationId, changes);
    return operationId;
  }

  async enqueueNoteChange(
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
    return this.enqueueChanges([
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
    const identity = await this.identity();
    this.rememberIdentity(identity);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.bootstrapOnce(identity);
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
    if (this.getCursor() === undefined || this.getCursor() === '') {
      await this.bootstrap();
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
        await this.bootstrap();
        return;
      }
      throw error;
    }

    if (response.bootstrapRequired || response.vaultId !== identity.vaultId || response.epoch !== identity.epoch) {
      await this.bootstrap();
      return;
    }

    const deletes = response.changes.filter((change) => change.op === 'delete').length;
    if (deletes > this.massDeleteLimit) {
      throw new Error(
        `Mass-delete guard: ${deletes} remote deletions exceed limit ${this.massDeleteLimit}`,
      );
    }

    for (const change of response.changes) {
      await this.applyRemoteChange(identity, change);
      this.state.setMeta('cursor', encodeCursor(change.vaultSeq, identity));
    }
    if (response.changes.length === 0) {
      this.state.setMeta('cursor', response.cursor);
    }
  }

  async pushOutbox(): Promise<void> {
    const identity = await this.identity();
    this.rememberIdentity(identity);
    await this.ensureDeviceSeq(identity);
    for (const operation of this.state.pendingOperations()) {
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
          await this.bootstrap();
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
              await this.reserveConflict(identity, {
                ...change,
                vaultSeq: 0,
                epoch: identity.epoch,
                timestamp: this.now(),
              }, local);
              await this.deleteLocalDocument(change.kind, change.id);
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

  private async bootstrapOnce(identity: SyncIdentity): Promise<void> {
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
        await this.applyRemoteChange(identity, {
          ...header,
          op: 'update',
          baseVersion: 0,
          content: content.content,
          vaultSeq: snapshotSeq,
          epoch: identity.epoch,
          timestamp: this.now(),
        });
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
      await this.applyRemoteDelete(identity, {
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
      });
    }

    this.state.setMeta('cursor', encodeCursor(snapshotSeq ?? 0, identity));
    this.state.setMeta('snapshot_seq', String(snapshotSeq ?? 0));
  }

  private async applyRemoteChange(identity: SyncIdentity, change: ChangeRecord): Promise<void> {
    if (change.op === 'delete') {
      await this.applyRemoteDelete(identity, change);
      return;
    }

    const existing = this.state.getApplyEntry(
      identity.vaultId,
      identity.epoch,
      change.kind,
      change.id,
      change.version,
      change.contentHash,
    );
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

    const local = await this.readLocalDocument(change.kind, change.id);
    const base = this.state.getDocumentState(identity.vaultId, identity.epoch, change.kind, change.id);
    const localEdited =
      local !== null &&
      local.hash !== change.contentHash &&
      (base === undefined || local.hash !== base.contentHash);

    let conflict: { conflictId: string; conflictPath: string } | undefined;
    if (localEdited) {
      conflict = await this.reserveConflict(identity, change, local);
    }

    this.state.beginApply(
      identity.vaultId,
      identity.epoch,
      change,
      conflict,
    );
    await this.writeRemoteChange(change, local);
    this.state.markApplyCommitted(identity.vaultId, identity.epoch, change);
    this.state.setDocumentState(identity.vaultId, identity.epoch, {
      kind: change.kind,
      id: change.id,
      version: change.version,
      contentHash: change.contentHash,
      path: change.path,
      lastVaultSeq: change.vaultSeq,
    });
  }

  private async applyRemoteDelete(identity: SyncIdentity, change: ChangeRecord): Promise<void> {
    const local = await this.readLocalDocument(change.kind, change.id);
    if (local === null) {
      this.state.deleteDocumentState(identity.vaultId, identity.epoch, change.kind, change.id);
      return;
    }

    const base = this.state.getDocumentState(identity.vaultId, identity.epoch, change.kind, change.id);
    if (base === undefined || local.hash !== base.contentHash) {
      await this.reserveConflict(identity, change, local);
    }

    this.state.beginApply(identity.vaultId, identity.epoch, change);
    await this.deleteLocalDocument(change.kind, change.id);
    this.state.markApplyCommitted(identity.vaultId, identity.epoch, change);
    this.state.deleteDocumentState(identity.vaultId, identity.epoch, change.kind, change.id);
  }

  private async reserveConflict(
    identity: SyncIdentity,
    change: ChangeRecord,
    local: LocalDocument,
  ): Promise<{ conflictId: string; conflictPath: string }> {
    const prior = this.state.getApplyEntry(
      identity.vaultId,
      identity.epoch,
      change.kind,
      change.id,
      change.version,
      change.contentHash,
    );
    if (prior?.conflictId !== undefined && prior.conflictPath !== undefined) {
      const existing = await this.readLocalDocument(change.kind, prior.conflictId);
      if (existing !== null) {
        return { conflictId: prior.conflictId, conflictPath: prior.conflictPath };
      }
      await this.writeConflictDocument(local, prior.conflictId, prior.conflictPath, change.kind);
      return { conflictId: prior.conflictId, conflictPath: prior.conflictPath };
    }

    const existingPaths = await this.allLocalPaths();
    const suffix = conflictSuffix(this.now(), this.deviceId);
    const noteNow = this.now().replace(/\.\d{3}Z$/, 'Z');
    const copy =
      change.kind === 'note' && local.note !== undefined
        ? makeConflictNote(local.note, suffix, existingPaths, noteNow)
        : change.kind === 'database' && local.database !== undefined
          ? makeConflictDatabase(local.database, suffix)
          : undefined;
    if (copy === undefined) throw new Error('Cannot create conflict copy for unknown document type');

    const conflictId = copy.document.id;
    const conflictPath = copy.path;
    this.state.beginApply(identity.vaultId, identity.epoch, change, {
      conflictId,
      conflictPath,
    });
    await this.writeConflictDocument(local, conflictId, conflictPath, change.kind, suffix);
    return { conflictId, conflictPath };
  }

  private async writeConflictDocument(
    local: LocalDocument,
    conflictId: string,
    conflictPath: string,
    kind: DocumentKind,
    suffix = conflictSuffix(this.now(), this.deviceId),
  ): Promise<void> {
    if (kind === 'note' && local.note !== undefined) {
      const noteNow = this.now().replace(/\.\d{3}Z$/, 'Z');
      await this.vault.createNote({
        ...local.note,
        id: conflictId,
        path: conflictPath,
        title: `${local.note.title} (conflict ${suffix})`,
        createdAt: noteNow,
        updatedAt: noteNow,
      });
      return;
    }
    if (kind === 'database' && local.database !== undefined) {
      await this.vault.createDatabase({
        ...local.database,
        id: conflictId,
        name: `${local.database.name} (conflict ${suffix})`,
      });
      return;
    }
    throw new Error('Cannot write conflict copy for unknown document type');
  }

  private async writeRemoteChange(change: ChangeRecord, local: LocalDocument | null): Promise<void> {
    if (change.kind === 'note') {
      const content = change.content ?? '';
      if (hashHex(content) !== change.contentHash) {
        throw new Error(`Content hash mismatch for note ${change.id}`);
      }
      const note = parseNote(content, change.path);
      if (note.id !== change.id) throw new Error(`Remote note ID mismatch for ${change.id}`);
      if (local !== null && local.path !== change.path) {
        await this.vault.moveNote(change.id, change.path);
      }
      if (local === null) {
        await this.vault.createNote(note);
      } else {
        await this.vault.replaceNote(note);
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
      await this.vault.createDatabase(database);
    } else {
      await this.vault.replaceDatabase(database);
    }
  }

  private async deleteLocalDocument(kind: DocumentKind, id: string): Promise<void> {
    try {
      if (kind === 'note') await this.vault.deleteNote(id);
      else await this.vault.deleteDatabase(id);
    } catch (error) {
      if (isStorageError(error) && error.code === 'NOT_FOUND') return;
      throw error;
    }
  }

  private async readLocalDocument(kind: DocumentKind, id: string): Promise<LocalDocument | null> {
    try {
      if (kind === 'note') {
        const note = await this.vault.readNote(id);
        const raw = await this.readRaw(note.path);
        return { kind, id, path: note.path, raw, hash: hashHex(raw), note };
      }
      const database = await this.vault.readDatabase(id);
      const path = `databases/${id}.json`;
      const raw = await this.readRaw(path);
      return { kind, id, path, raw, hash: hashHex(raw), database };
    } catch (error) {
      if (isStorageError(error) && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }

  private async readRaw(path: string): Promise<string> {
    const absolute = resolveInsideRoot(this.vault.root, path);
    await assertInsideRoot(this.vault.root, absolute, path);
    await assertNotSymlink(absolute, path);
    return readFile(absolute, 'utf8');
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

function hashHex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
