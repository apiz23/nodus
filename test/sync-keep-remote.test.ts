import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { parseDatabase, serializeDatabase } from '../src/database/schema.js';
import { createNote } from '../src/domain/note.js';
import { parseNote, serializeNote } from '../src/format/note-format.js';
import { AuthService, hashHex } from '../src/relay/auth.js';
import { RelayDatabase } from '../src/relay/db.js';
import { SyncService } from '../src/relay/sync.js';
import { createRelayServer } from '../src/relay/server.js';
import { FileSystemVault, type SyncWriteSession } from '../src/storage/fs/vault.js';
import { StorageError } from '../src/storage/errors.js';
import { SyncClient } from '../src/sync/client.js';
import { SyncStateStore } from '../src/sync/state.js';
import { conflictRevisionKey } from '../src/sync/conflict-registry.js';
import type { ResolutionIntent, ResolutionSnapshot } from '../src/sync/resolution-decisions.js';

const now = '2026-11-11T00:00:00Z';
const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const scope = { vaultId: '00000000-0000-0000-0000-000000000001', epoch: 1 };

function intercept(vault: FileSystemVault, transform: (writes: SyncWriteSession) => SyncWriteSession) {
  const original = vault.withSyncWrite.bind(vault);
  return vi.spyOn(vault, 'withSyncWrite').mockImplementationOnce(
    <T>(operation: (writes: SyncWriteSession) => Promise<T>) => original((writes) => operation(transform(writes))),
  );
}

async function snapshot(vault: FileSystemVault, documentId: string): Promise<ResolutionSnapshot> {
  const { note, hash, text } = await vault.readNoteWithHash(documentId);
  return { id: note.id, path: note.path, content: text, contentHash: hash };
}

async function databaseSnapshot(vault: FileSystemVault, documentId: string): Promise<ResolutionSnapshot> {
  const path = 'databases/' + documentId + '.json';
  const content = await readFile(join(vault.root, path), 'utf8');
  return { id: documentId, path, content, contentHash: hashHex(content) };
}

async function fixture(mode: 'update' | 'move' | 'delete' = 'update', divergent = true, kind: 'note' | 'database' = 'note') {
  const root = await mkdtemp(join(tmpdir(), 'nodus-keep-remote-'));
  const db = RelayDatabase.open(join(root, 'relay.sqlite'));
  const auth = new AuthService(db);
  const sync = new SyncService(db, scope);
  const server: Server = createRelayServer({ db, auth, sync, identity: scope, adminToken: 'test-admin' });
  const clients: SyncClient[] = [];
  const cleanup = async () => {
    for (const client of clients) client.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    await rm(root, { recursive: true, force: true });
  };
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) throw new Error('No relay address');
    const baseUrl = 'http://127.0.0.1:' + address.port;
    const a = await FileSystemVault.open(join(root, 'a'));
    const b = await FileSystemVault.open(join(root, 'b'));
    const pair = async (name: string) => {
      const { code } = await auth.generatePairingCode(name);
      return SyncClient.pair(baseUrl, code, name);
    };
    const ca = new SyncClient({ vault: a, baseUrl, ...(await pair('A')), now: () => now });
    clients.push(ca);
    let corrupt = false;
    let gate: (() => Promise<void>) | null = null;
    const fetchImpl: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (String(input).includes('/docs/')) {
        if (gate !== null) await gate();
        if (corrupt && response.ok) {
          const value = await response.json() as Record<string, unknown>;
          return new Response(JSON.stringify({ ...value, content: 'corrupt remote bytes' }), { status: 200 });
        }
      }
      return response;
    };
    const options = { vault: b, baseUrl, ...(await pair('B')), now: () => now, fetchImpl };
    const cb = new SyncClient(options);
    clients.push(cb);
    await ca.bootstrap();
    const takeSnapshot = kind === 'note' ? snapshot : databaseSnapshot;
    if (kind === 'note') {
      await a.createNote(createNote({ id, path: 'notes/original.md', title: 'Original', body: 'Initial\n', now }));
      await ca.enqueueNoteChange(id, 'create');
    } else {
      await a.createDatabase({ id, name: 'Initial', properties: [] });
      const bytes = await takeSnapshot(a, id);
      await ca.enqueueChanges([{ kind, id, op: 'create', baseVersion: 0, version: 1, path: bytes.path,
        contentHash: bytes.contentHash, content: bytes.content }]);
    }
    await ca.pushOutbox();
    await cb.bootstrap();
    if (kind === 'note') {
      if (mode === 'move') await a.moveNote(id, 'notes/remote.md');
      if (mode === 'update') await a.replaceNote({ ...(await a.readNote(id)), body: 'Remote\n' });
      await ca.enqueueNoteChange(id, mode);
      if (mode === 'delete') await a.deleteNote(id);
    } else {
      if (mode === 'update') await a.replaceDatabase({ id, name: 'Remote', properties: [] });
      const bytes = await takeSnapshot(a, id);
      await ca.enqueueChanges([{ kind, id, op: mode, baseVersion: 1, version: 2, path: bytes.path,
        contentHash: mode === 'delete' ? hashHex('') : bytes.contentHash,
        ...(mode === 'delete' ? {} : { content: bytes.content }) }]);
      if (mode === 'delete') await a.deleteDatabase(id);
    }
    await ca.pushOutbox();
    if (divergent) {
      if (kind === 'note') await b.replaceNote({ ...(await b.readNote(id)), body: 'Local divergent\n' });
      else await b.replaceDatabase({ id, name: 'Local divergent', properties: [] });
    }
    const hook = intercept(b, (writes) => ({
      ...writes,
      replaceNote: async () => { throw new StorageError('STALE_WRITE', 'Injected guarded apply failure'); },
      relocateNote: async () => { throw new StorageError('STALE_WRITE', 'Injected guarded apply failure'); },
      deleteNote: async () => { throw new StorageError('STALE_WRITE', 'Injected guarded apply failure'); },
      replaceDatabase: async () => { throw new StorageError('STALE_WRITE', 'Injected guarded apply failure'); },
      deleteDatabase: async () => { throw new StorageError('STALE_WRITE', 'Injected guarded apply failure'); },
    }));
    try { await expect(cb.pull()).rejects.toMatchObject({ code: 'STALE_WRITE' }); }
    finally { hook.mockRestore(); }
    if (!divergent) await b.replaceNote({ ...(await b.readNote(id)), body: 'New local source\n' });
    const conflict = cb.listConflicts().conflicts[0]!;
    const store = SyncStateStore.open(join(b.root, '.nodus', 'sync.sqlite'));
    const change = store.recordedChange(scope, conflictRevisionKey(scope, conflict.conflictId))!;
    store.close();
    const local = await takeSnapshot(b, id);
    const copy = conflict.copy === null ? null : await takeSnapshot(b, conflict.copy.id!);
    const targetContent = mode === 'delete' ? null : kind === 'note'
      ? serializeNote(parseNote(change.content!, change.path)) : serializeDatabase(parseDatabase(change.content!));
    const target = targetContent === null ? null : {
      id, path: change.path, content: targetContent, contentHash: hashHex(targetContent),
    };
    const intent: ResolutionIntent = {
      schemaVersion: 1, decisionId: randomUUID(), conflictId: conflict.conflictId,
      document: { kind, id }, action: 'keep-remote',
      expectedBase: conflict.base, expectedLocal: local, expectedCopy: copy,
      expectedRemote: {
        version: change.version, path: change.path, operation: change.op,
        contentHash: change.contentHash, content: change.content ?? null,
      },
      target,
    };
    await cb.prepareResolutionDecision(scope, intent);
    return {
      a, b, ca, cb, options, intent, copy, local, cleanup,
      cursor: cb.getCursor(),
      corruptRemote: () => { corrupt = true; },
      setGate: (value: (() => Promise<void>) | null) => { gate = value; },
      restart: () => { const client = new SyncClient(options); clients.push(client); return client; },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

it.each(['update', 'move', 'delete'] as const)('executes keep-remote %s and consumes only the selected incoming revision', async (mode) => {
  const f = await fixture(mode);
  try {
    await f.a.createNote(createNote({ id: secondId, path: 'notes/unrelated.md', title: 'Unrelated', body: 'Later\n', now }));
    await f.ca.enqueueNoteChange(secondId, 'create');
    await f.ca.pushOutbox();
    const result = await f.cb.executeKeepRemoteDecision(scope, f.intent.decisionId);
    expect(result.status).toBe('completed');
    expect(result.completedAt).not.toBeNull();
    expect(result.result).toEqual(f.intent.target === null ? null : {
      id, path: f.intent.target.path, contentHash: f.intent.target.contentHash, relayVersion: 2,
    });
    expect(await snapshot(f.b, f.copy!.id)).toEqual(f.copy);
    expect(f.cb.getCursor()).toBe(f.cursor);
    await expect(f.b.readNote(secondId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    if (mode === 'delete') await expect(f.b.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    else expect(await snapshot(f.b, id)).toEqual(f.intent.target);
    expect(await f.cb.executeKeepRemoteDecision(scope, f.intent.decisionId)).toEqual(result);
    const listed = f.cb.listConflicts({ status: 'resolved-remote' }).conflicts;
    expect(listed).toHaveLength(1);
    expect(listed[0]!.resolutionDecisionId).toBe(f.intent.decisionId);
    expect(f.cb.listResolutionHistory(scope, f.intent.conflictId).decisions[0]).toMatchObject({ status: 'completed' });
    await f.cb.pull();
    expect((await f.b.readNote(secondId)).body).toBe('Later\n');
    expect(await snapshot(f.b, f.copy!.id)).toEqual(f.copy);
    expect(await f.b.listNotes()).toHaveLength(mode === 'delete' ? 2 : 3);
  } finally { await f.cleanup(); }
});

it.each(['before-write', 'after-write', 'sqlite-completion'] as const)('recovers after %s interruption and restart', async (boundary) => {
  const f = await fixture();
  try {
    const hook = boundary === 'sqlite-completion'
      ? vi.spyOn(SyncStateStore.prototype, 'setDocumentState').mockImplementationOnce(() => { throw new Error('interrupted'); })
      : intercept(f.b, (writes) => ({
          ...writes,
          replaceNote: async (...args) => {
            if (boundary === 'after-write') await writes.replaceNote(...args);
            throw new Error('interrupted');
          },
        }));
    try { await expect(f.cb.executeKeepRemoteDecision(scope, f.intent.decisionId)).rejects.toThrow('interrupted'); }
    finally { hook.mockRestore(); }
    expect(f.cb.getResolutionDecision(scope, f.intent.decisionId)!.status).toBe('applying');
    expect(f.cb.getCursor()).toBe(f.cursor);
    const retry = f.restart();
    const published = await retry.executeKeepRemoteDecision(scope, f.intent.decisionId);
    expect(published.status).toBe('completed');
    expect(await snapshot(f.b, id)).toEqual(f.intent.target);
    expect(await snapshot(f.b, f.copy!.id)).toEqual(f.copy);
    expect(await retry.executeKeepRemoteDecision(scope, f.intent.decisionId)).toEqual(published);
    await retry.pull();
    expect(await f.b.listNotes()).toHaveLength(2);
  } finally { await f.cleanup(); }
});

it.each(['source', 'remote', 'remote-bytes', 'copy', 'missing-copy'] as const)('preserves files when %s evidence differs', async (fault) => {
  const f = await fixture();
  try {
    if (fault === 'source') await f.b.replaceNote({ ...(await f.b.readNote(id)), body: 'New source\n' });
    if (fault === 'copy') await f.b.replaceNote({ ...(await f.b.readNote(f.copy!.id)), body: 'Changed copy\n' });
    if (fault === 'missing-copy') await f.b.deleteNote(f.copy!.id);
    if (fault === 'remote') {
      await f.a.replaceNote({ ...(await f.a.readNote(id)), body: 'Later remote\n' });
      await f.ca.enqueueNoteChange(id);
      await f.ca.pushOutbox();
    }
    if (fault === 'remote-bytes') f.corruptRemote();
    const before = await snapshot(f.b, id);
    const result = await f.cb.executeKeepRemoteDecision(scope, f.intent.decisionId);
    expect(result.status).toBe(['source', 'remote', 'remote-bytes'].includes(fault) ? 'rejected-stale' : 'needs-recovery');
    expect(result.diagnostic).toBeTruthy();
    expect(await snapshot(f.b, id)).toEqual(before);
    expect(f.cb.getCursor()).toBe(f.cursor);
    await expect(f.cb.pull()).rejects.toThrow();
  } finally { await f.cleanup(); }
});

it.each(['changed-target', 'both-paths', 'relocation-published'] as const)('replays conservatively with %s', async (fault) => {
  const f = await fixture(fault === 'changed-target' ? 'update' : 'move');
  try {
    const hook = intercept(f.b, (writes) => ({
      ...writes,
      replaceNote: async (...args) => { await writes.replaceNote(...args); throw new Error('interrupted'); },
      relocateNote: async (...args) => {
        if (fault === 'both-paths') {
          await writeFile(join(f.b.root, f.intent.target!.path), f.intent.target!.content, { flag: 'wx' });
        } else await writes.relocateNote(...args);
        throw new Error('interrupted');
      },
    }));
    try { await expect(f.cb.executeKeepRemoteDecision(scope, f.intent.decisionId)).rejects.toThrow('interrupted'); }
    finally { hook.mockRestore(); }
    if (fault === 'changed-target') await f.b.replaceNote({ ...(await f.b.readNote(id)), body: 'Edited after publication\n' });
    const retry = f.restart();
    const result = await retry.executeKeepRemoteDecision(scope, f.intent.decisionId);
    if (fault === 'relocation-published') {
      expect(result.status).toBe('completed');
      await expect(f.b.readNoteAtPath(f.local.path)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } else {
      expect(result.status).toBe('needs-recovery');
      if (fault === 'both-paths') {
        expect(await readFile(join(f.b.root, f.local.path), 'utf8')).toBe(f.local.content);
        expect(await readFile(join(f.b.root, f.intent.target!.path), 'utf8')).toBe(f.intent.target!.content);
      } else expect((await f.b.readNote(id)).body).toBe('Edited after publication\n');
    }
    expect(await snapshot(f.b, f.copy!.id)).toEqual(f.copy);
    expect(f.cb.getCursor()).toBe(f.cursor);
  } finally { await f.cleanup(); }
});

it('serializes an incoming pull and duplicate execution behind the same vault lock', async () => {
  const f = await fixture();
  const original = f.b.withSyncWrite.bind(f.b);
  let release!: () => void;
  let entered!: () => void;
  let queued!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const inside = new Promise<void>((resolve) => { entered = resolve; });
  const pending = new Promise<void>((resolve) => { queued = resolve; });
  try {
    f.setGate(async () => { entered(); await gate; });
    const executing = f.cb.executeKeepRemoteDecision(scope, f.intent.decisionId);
    await inside;
    let calls = 0;
    const observer = vi.spyOn(f.b, 'withSyncWrite').mockImplementation(
      <T>(operation: (writes: SyncWriteSession) => Promise<T>) => {
        if (++calls === 2) queued();
        return original(operation);
      },
    );
    const other = f.restart();
    const pulling = other.pull();
    const duplicate = other.executeKeepRemoteDecision(scope, f.intent.decisionId);
    await pending;
    release();
    try {
      const [first, , second] = await Promise.all([executing, pulling, duplicate]);
      expect(first).toEqual(second);
    } finally { observer.mockRestore(); }
    expect(await f.b.listNotes()).toHaveLength(2);
    expect(await snapshot(f.b, id)).toEqual(f.intent.target);
  } finally {
    release();
    f.setGate(null);
    await f.cleanup();
  }
});

it('rejects an execution request for another epoch', async () => {
  const f = await fixture();
  try {
    await expect(f.cb.executeKeepRemoteDecision({ ...scope, epoch: 2 }, f.intent.decisionId)).rejects.toThrow('vault and epoch');
    expect(await snapshot(f.b, id)).toEqual(f.local);
    expect(f.cb.getResolutionDecision(scope, f.intent.decisionId)!.status).toBe('prepared');
  } finally { await f.cleanup(); }
});

it('retains prepared state if applying cannot be recorded, and replays a committed result after a lost return', async () => {
  const f = await fixture();
  try {
    const first = vi.spyOn(SyncStateStore.prototype, 'transitionResolutionDecision').mockImplementationOnce(() => {
      throw new Error('applying transition interrupted');
    });
    try {
      await expect(f.cb.executeKeepRemoteDecision(scope, f.intent.decisionId)).rejects.toThrow('applying transition interrupted');
    } finally { first.mockRestore(); }
    expect(f.cb.getResolutionDecision(scope, f.intent.decisionId)!.status).toBe('prepared');
    expect(await snapshot(f.b, id)).toEqual(f.local);

    const complete = SyncStateStore.prototype.completeKeepRemote;
    const lostReturn = vi.spyOn(SyncStateStore.prototype, 'completeKeepRemote').mockImplementationOnce(function (
      this: SyncStateStore, ...args: Parameters<typeof complete>
    ) {
      complete.apply(this, args);
      throw new Error('return interrupted');
    });
    try {
      await expect(f.cb.executeKeepRemoteDecision(scope, f.intent.decisionId)).rejects.toThrow('return interrupted');
    } finally { lostReturn.mockRestore(); }
    const recorded = f.cb.getResolutionDecision(scope, f.intent.decisionId)!;
    expect(recorded.status).toBe('completed');
    f.corruptRemote();
    const retry = f.restart();
    expect(await retry.executeKeepRemoteDecision(scope, f.intent.decisionId)).toEqual(recorded);
    expect(await snapshot(f.b, id)).toEqual(f.intent.target);
  } finally { await f.cleanup(); }
});

it('finishes a deletion after the source was removed but completion was interrupted', async () => {
  const f = await fixture('delete');
  try {
    const hook = intercept(f.b, (writes) => ({
      ...writes,
      deleteNote: async (...args) => { await writes.deleteNote(...args); throw new Error('after unlink'); },
    }));
    try {
      await expect(f.cb.executeKeepRemoteDecision(scope, f.intent.decisionId)).rejects.toThrow('after unlink');
    } finally { hook.mockRestore(); }
    await expect(f.b.readNote(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await f.restart().executeKeepRemoteDecision(scope, f.intent.decisionId)).status).toBe('completed');
    expect(await snapshot(f.b, f.copy!.id)).toEqual(f.copy);
  } finally { await f.cleanup(); }
});

it('preserves a relocation destination occupied by a different document', async () => {
  const f = await fixture('move');
  try {
    await f.b.createNote(createNote({
      id: secondId, path: f.intent.target!.path, title: 'Existing', body: 'User destination\n', now,
    }));
    const occupied = await snapshot(f.b, secondId);
    const result = await f.cb.executeKeepRemoteDecision(scope, f.intent.decisionId);
    expect(result.status).toBe('needs-recovery');
    expect(await snapshot(f.b, secondId)).toEqual(occupied);
    expect(await snapshot(f.b, id)).toEqual(f.local);
    expect(await snapshot(f.b, f.copy!.id)).toEqual(f.copy);
  } finally { await f.cleanup(); }
});

it('blocks source writes from a second vault instance until the write session completes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nodus-sync-session-'));
  let release!: () => void;
  let entered!: () => void;
  try {
    const first = await FileSystemVault.open(root);
    const second = await FileSystemVault.open(root);
    await first.createNote(createNote({ id, path: 'notes/session.md', title: 'Session', body: 'Before\n', now }));
    const revision = await first.readNoteWithHash(id);
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inside = new Promise<void>((resolve) => { entered = resolve; });
    let escaped: SyncWriteSession | undefined;
    const session = first.withSyncWrite(async (writes) => {
      escaped = writes;
      entered();
      await gate;
      await writes.replaceNote({ ...revision.note, body: 'Session write\n' }, { expectedHash: revision.hash });
    });
    await inside;
    const writer = second.replaceNote({ ...revision.note, body: 'Concurrent stale write\n' }, { expectedHash: revision.hash });
    // Attach a rejection observer before releasing the first writer.
    const stale = expect(writer).rejects.toMatchObject({ code: 'STALE_WRITE' });
    release();
    await session;
    await stale;
    expect((await first.readNote(id)).body).toBe('Session write\n');
    await expect(escaped!.deleteNote(id)).rejects.toThrow('session has ended');
    expect((await first.readNote(id)).body).toBe('Session write\n');
  } finally {
    release?.();
    await rm(root, { recursive: true, force: true });
  }
});

it('durably preserves a previously uncopied local source before remote publication', async () => {
  const f = await fixture('update', false);
  try {
    expect(f.intent.expectedCopy).toBeNull();
    const hook = intercept(f.b, (writes) => ({
      ...writes,
      createNote: async (...args) => { await writes.createNote(...args); throw new Error('copy publication interrupted'); },
    }));
    try {
      await expect(f.cb.executeKeepRemoteDecision(scope, f.intent.decisionId)).rejects.toThrow('copy publication interrupted');
    } finally { hook.mockRestore(); }
    const reserved = f.cb.getConflictDetails(f.intent.conflictId)!.copy!;
    expect(reserved.publicationRecorded).toBe(false);
    expect(await snapshot(f.b, id)).toEqual(f.local);
    const retry = f.restart();
    expect((await retry.executeKeepRemoteDecision(scope, f.intent.decisionId)).status).toBe('completed');
    expect(retry.getConflictDetails(f.intent.conflictId)!.copy!.id).toBe(reserved.id);
    expect((await f.b.readNote(reserved.id!)).body).toBe('New local source\n');
    expect(await f.b.listNotes()).toHaveLength(2);
  } finally { await f.cleanup(); }
});

it.each(['update', 'delete'] as const)('executes keep-remote database %s with a preserved definition', async (mode) => {
  const f = await fixture(mode, true, 'database');
  try {
    const result = await f.cb.executeKeepRemoteDecision(scope, f.intent.decisionId);
    expect(result.status).toBe('completed');
    expect(await databaseSnapshot(f.b, f.copy!.id)).toEqual(f.copy);
    if (mode === 'delete') await expect(f.b.readDatabase(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    else expect(await databaseSnapshot(f.b, id)).toEqual(f.intent.target);
    expect(f.cb.getCursor()).toBe(f.cursor);
    await f.cb.pull();
    expect(await f.b.listDatabases()).toHaveLength(mode === 'delete' ? 1 : 2);
  } finally { await f.cleanup(); }
});
