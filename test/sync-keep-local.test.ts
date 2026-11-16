import { DatabaseSync } from 'node:sqlite';
import { serializeNote } from '../src/format/note-format.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
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
import type { ChangeInput } from '../src/sync/contracts.js';

const now = '2026-11-11T00:00:00Z';
const id = '11111111-1111-4111-8111-111111111111';
const beforeId = '22222222-2222-4222-8222-222222222222';
const afterId = '33333333-3333-4333-8333-333333333333';
const scope = { vaultId: '00000000-0000-0000-0000-000000000001', epoch: 1 };

function intercept(vault: FileSystemVault, transform: (writes: SyncWriteSession) => SyncWriteSession) {
  const original = vault.withSyncWrite.bind(vault);
  return vi.spyOn(vault, 'withSyncWrite').mockImplementationOnce(
    <T>(operation: (writes: SyncWriteSession) => Promise<T>) => original((writes) => operation(transform(writes))),
  );
}

async function fixture(mode: 'edit' | 'move' | 'database' | 'raw' = 'edit', unrelated = false) {
  const root = await mkdtemp(join(tmpdir(), 'nodus-keep-local-'));
  const db = RelayDatabase.open(join(root, 'relay.sqlite'));
  const auth = new AuthService(db);
  const server = createRelayServer({ db, auth, sync: new SyncService(db, scope), identity: scope, adminToken: 'test' });
  const clients = new Set<SyncClient>();
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
    if (typeof address !== 'object' || address === null) throw new Error('Missing relay address');
    const baseUrl = 'http://127.0.0.1:' + address.port;
    const a = await FileSystemVault.open(join(root, 'a'));
    const b = await FileSystemVault.open(join(root, 'b'));
    const pair = async (name: string) => {
      const { code } = await auth.generatePairingCode(name);
      return SyncClient.pair(baseUrl, code, name);
    };
    const ca = new SyncClient({ vault: a, baseUrl, ...(await pair('A')), now: () => now });
    clients.add(ca);
    const control = {
      beforePush: null as (() => Promise<void>) | null,
      afterPush: null as (() => Promise<void>) | null,
      hideHistory: false,
      attempts: [] as Array<{ operationId: string; deviceSeq: number; changes: ChangeInput[] }>,
    };
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/push')) {
        control.attempts.push(JSON.parse(init!.body as string));
        await control.beforePush?.();
        const response = await fetch(input, init);
        await control.afterPush?.();
        return response;
      }
      if (String(input).includes('/operations?') && control.hideHistory) {
        return new Response(JSON.stringify({ operations: [] }), { status: 200 });
      }
      return fetch(input, init);
    };
    const options = { vault: b, baseUrl, ...(await pair('B')), now: () => now, fetchImpl };
    let cb = new SyncClient(options);
    clients.add(cb);
    const kind = mode === 'database' ? 'database' : 'note';
    const take = async (vault: FileSystemVault, documentId = id): Promise<ResolutionSnapshot> => {
      const path = kind === 'database' ? 'databases/' + documentId + '.json' : (await vault.readNote(documentId)).path;
      const content = await readFile(join(vault.root, path), 'utf8');
      return { id: documentId, path, content, contentHash: hashHex(content) };
    };
    const enqueue = async (op: 'create' | 'update' | 'delete', baseVersion: number) => {
      const bytes = await take(a);
      await ca.enqueueChanges([{
        kind, id, op, baseVersion, version: baseVersion + 1, path: bytes.path,
        contentHash: op === 'delete' ? hashHex('') : bytes.contentHash,
        ...(op === 'delete' ? {} : { content: bytes.content }),
      }]);
    };
    const otherNote = async (documentId: string, path: string) => {
      await a.createNote(createNote({ id: documentId, path, title: 'Other', body: 'Unrelated\n', now }));
      await ca.enqueueNoteChange(documentId, 'create');
      await ca.pushOutbox();
    };
    await ca.bootstrap();
    if (kind === 'note') await a.createNote(createNote({ id, path: 'notes/original.md', title: 'Original', body: 'Initial\n', now }));
    else await a.createDatabase({ id, name: 'Initial', properties: [] });
    await enqueue('create', 0);
    await ca.pushOutbox();
    await cb.bootstrap();
    if (unrelated) await otherNote(beforeId, 'notes/before.md');
    if (mode === 'move') {
      await a.moveNote(id, 'notes/remote.md');
      await b.moveNote(id, 'notes/local.md');
    } else if (kind === 'note') {
      await a.replaceNote({ ...(await a.readNote(id)), body: 'Remote\n' });
      await b.replaceNote({ ...(await b.readNote(id)), body: 'Selected local\n' });
      if (mode === 'raw') {
        const bytes = await take(b);
        await writeFile(join(b.root, bytes.path), bytes.content.replaceAll('\n', '\r\n'));
      }
    } else {
      await a.replaceDatabase({ id, name: 'Remote', properties: [] });
      await b.replaceDatabase({ id, name: 'Selected local', properties: [] });
    }
    await enqueue('update', 1);
    await ca.pushOutbox();
    if (unrelated) await otherNote(afterId, 'notes/after.md');
    const hook = intercept(b, (writes) => ({
      ...writes,
      replaceNote: async () => { throw new StorageError('STALE_WRITE', 'Injected apply boundary'); },
      relocateNote: async () => { throw new StorageError('STALE_WRITE', 'Injected apply boundary'); },
      replaceDatabase: async () => { throw new StorageError('STALE_WRITE', 'Injected apply boundary'); },
    }));
    try { await expect(cb.pull()).rejects.toMatchObject({ code: 'STALE_WRITE' }); }
    finally { hook.mockRestore(); }
    const conflict = cb.listConflicts().conflicts[0]!;
    const state = SyncStateStore.open(join(b.root, '.nodus', 'sync.sqlite'));
    const change = state.recordedChange(scope, conflictRevisionKey(scope, conflict.conflictId))!;
    state.close();
    const local = await take(b);
    const copy = await take(b, conflict.copy!.id!);
    const intent: ResolutionIntent = {
      schemaVersion: 1, decisionId: randomUUID(), conflictId: conflict.conflictId,
      document: { kind, id }, action: 'keep-local', expectedBase: conflict.base,
      expectedLocal: local, expectedCopy: copy,
      expectedRemote: { version: change.version, path: change.path, operation: change.op,
        contentHash: change.contentHash, content: change.content! },
      target: local,
    };
    await cb.prepareResolutionDecision(scope, intent);
    const stateRead = <T>(read: (store: SyncStateStore) => T): T => {
      const store = SyncStateStore.open(join(b.root, '.nodus', 'sync.sqlite'));
      try { return read(store); } finally { store.close(); }
    };
    const advanceRemote = async (retire = false) => {
      if (!retire) {
        if (kind === 'note') await a.replaceNote({ ...(await a.readNote(id)), body: 'New remote\n' });
        else await a.replaceDatabase({ id, name: 'New remote', properties: [] });
      }
      await enqueue(retire ? 'delete' : 'update', 2);
      if (retire) {
        if (kind === 'note') await a.deleteNote(id);
        else await a.deleteDatabase(id);
      }
      await ca.pushOutbox();
    };
    return {
      a, b, ca, cb, control, intent, local, copy, take, stateRead, advanceRemote, cleanup, change,
      cursor: cb.getCursor(),
      restart: () => {
        cb.close(); clients.delete(cb);
        cb = new SyncClient(options); clients.add(cb);
        return cb;
      },
      anotherClient: () => { const client = new SyncClient(options); clients.add(client); return client; },
      relayContent: async () => {
        const response = await fetch(baseUrl + '/docs/' + kind + '/' + id + '?version=3', {
          headers: { Authorization: 'Bearer ' + options.token, 'X-Nodus-Vault-Id': scope.vaultId,
            'X-Nodus-Epoch': '1', 'X-Nodus-Protocol-Version': '1' },
        });
        return response;
      },
    };
  } catch (error) { await cleanup(); throw error; }
}

it.each(['edit', 'move', 'database', 'raw'] as const)('conditionally publishes the exact selected %s snapshot once', async (mode) => {
  const f = await fixture(mode);
  try {
    const result = await f.cb.executeKeepLocalDecision(scope, f.intent.decisionId);
    expect(result.status).toBe('completed');
    expect(result.result).toEqual({ id, path: f.local.path, contentHash: f.local.contentHash, relayVersion: 3 });
    expect(f.control.attempts).toHaveLength(1);
    expect(f.control.attempts[0]!.changes).toEqual([{
      kind: f.intent.document.kind, id, op: 'update', baseVersion: 2, version: 3,
      path: f.local.path, contentHash: f.local.contentHash, content: f.local.content,
    }]);
    expect(await f.take(f.b)).toEqual(f.local);
    expect(await f.take(f.b, f.copy.id)).toEqual(f.copy);
    expect(f.cb.getCursor()).toBe(f.cursor);
    const response = await f.relayContent();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ content: f.local.content, contentHash: f.local.contentHash, version: 3 });
    expect(f.cb.getKeepLocalReconciliation(scope, f.intent.decisionId)).toMatchObject({ relayAccepted: true, relayVersion: 3 });
    expect(await f.cb.executeKeepLocalDecision(scope, f.intent.decisionId)).toEqual(result);
    expect(f.control.attempts).toHaveLength(1);
    expect(f.cb.listConflicts({ status: 'resolved-local' }).conflicts).toHaveLength(1);
    await f.cb.pull();
    expect(await f.take(f.b)).toEqual(f.local);
    expect(await f.take(f.b, f.copy.id)).toEqual(f.copy);
    expect(f.cb.listResolutionHistory(scope, f.intent.conflictId).decisions[0]!.status).toBe('completed');
  } finally { await f.cleanup(); }
});

it.each(['before-send', 'lost-response'] as const)('recovers %s uncertainty with the same durable operation', async (fault) => {
  const f = await fixture();
  try {
    const fail = async () => {
      f.control.beforePush = null; f.control.afterPush = null;
      throw new Error('simulated timeout');
    };
    if (fault === 'before-send') f.control.beforePush = fail;
    else f.control.afterPush = fail;
    await expect(f.cb.executeKeepLocalDecision(scope, f.intent.decisionId)).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
    const reserved = f.cb.getKeepLocalReconciliation(scope, f.intent.decisionId)!;
    expect(reserved).toMatchObject({ delivery: 'sending', relayAccepted: null });
    expect(f.cb.getResolutionDecision(scope, f.intent.decisionId)!.status).toBe('applying');
    expect(f.cb.getCursor()).toBe(f.cursor);
    const retry = f.restart();
    const result = await retry.executeKeepLocalDecision(scope, f.intent.decisionId);
    expect(result.status).toBe('completed');
    expect(retry.getKeepLocalReconciliation(scope, f.intent.decisionId)!.operationId).toBe(reserved.operationId);
    expect(f.control.attempts).toHaveLength(fault === 'before-send' ? 2 : 1);
    if (fault === 'before-send') expect(f.control.attempts[1]).toEqual(f.control.attempts[0]);
    expect(f.stateRead((state) => state.pendingOperations())).toEqual([]);
    expect(await f.take(f.b)).toEqual(f.local);
  } finally { await f.cleanup(); }
});

it.each(['remote-update', 'retired'] as const)('retains local content and a diagnostic after %s conditional rejection', async (fault) => {
  const f = await fixture();
  try {
    f.control.beforePush = async () => {
      f.control.beforePush = null;
      await f.advanceRemote(fault === 'retired');
    };
    const result = await f.cb.executeKeepLocalDecision(scope, f.intent.decisionId);
    expect(result.status).toBe('needs-recovery');
    expect(result.diagnostic).toBeTruthy();
    expect(result.result).toBeNull();
    expect(f.cb.getKeepLocalReconciliation(scope, f.intent.decisionId)).toMatchObject({
      relayAccepted: false, delivery: fault === 'retired' ? 'rejected' : 'conflict',
    });
    expect(await f.take(f.b)).toEqual(f.local);
    expect(await f.take(f.b, f.copy.id)).toEqual(f.copy);
    expect(f.cb.getCursor()).toBe(f.cursor);
    const retry = f.restart();
    expect((await retry.executeKeepLocalDecision(scope, f.intent.decisionId)).status).toBe('needs-recovery');
    expect(f.control.attempts).toHaveLength(1);
    await expect(retry.pull()).rejects.toThrow('requires execution or recovery');
    await retry.pushOutbox();
    expect(await f.take(f.b)).toEqual(f.local);
    if (fault === 'retired') expect((await f.relayContent()).status).toBe(410);
  } finally { await f.cleanup(); }
});

it.each(['applying', 'reservation', 'before-publication', 'completion', 'lost-return'] as const)(
  'replays the journal and outbox after %s interruption', async (fault) => {
    const f = await fixture();
    try {
      // Avoid faulting the first-time authoritative device-sequence initialization.
      f.stateRead((state) => state.setMeta('device_seq', '0'));
      const originalMeta = SyncStateStore.prototype.setMeta;
      const originalFinish = SyncStateStore.prototype.finishKeepLocalPush;
      const hook = fault === 'applying'
        ? vi.spyOn(SyncStateStore.prototype, 'transitionResolutionDecision').mockImplementationOnce(() => { throw new Error('interrupted'); })
        : fault === 'reservation'
          ? vi.spyOn(SyncStateStore.prototype, 'setMeta').mockImplementationOnce(function (this: SyncStateStore, ...args) {
              originalMeta.apply(this, args); throw new Error('interrupted');
            })
          : fault === 'before-publication'
            ? vi.spyOn(SyncStateStore.prototype, 'markResolutionSending').mockImplementationOnce(() => { throw new Error('interrupted'); })
            : fault === 'completion'
              ? vi.spyOn(SyncStateStore.prototype, 'setDocumentState').mockImplementationOnce(() => { throw new Error('interrupted'); })
              : vi.spyOn(SyncStateStore.prototype, 'finishKeepLocalPush').mockImplementationOnce(function (
                  this: SyncStateStore, ...args: Parameters<typeof originalFinish>
                ) { originalFinish.apply(this, args); throw new Error('interrupted'); });
      try { await expect(f.cb.executeKeepLocalDecision(scope, f.intent.decisionId)).rejects.toThrow('interrupted'); }
      finally { hook.mockRestore(); }
      const reserved = f.cb.getKeepLocalReconciliation(scope, f.intent.decisionId);
      if (fault === 'reservation') {
        expect(reserved).toBeNull();
        expect(f.stateRead((state) => state.getMeta('device_seq'))).toBe('0');
        expect(f.stateRead((state) => state.pendingOperations())).toEqual([]);
      }
      if (fault === 'before-publication') expect(reserved!.delivery).toBe('reserved');
      const retry = f.restart();
      const result = await retry.executeKeepLocalDecision(scope, f.intent.decisionId);
      expect(result.status).toBe('completed');
      if (reserved !== null) expect(retry.getKeepLocalReconciliation(scope, f.intent.decisionId)!.operationId).toBe(reserved.operationId);
      expect(f.control.attempts).toHaveLength(1);
      expect(await f.take(f.b)).toEqual(f.local);
      expect(await f.take(f.b, f.copy.id)).toEqual(f.copy);
      await retry.pull();
      expect(await f.take(f.b)).toEqual(f.local);
    } finally { await f.cleanup(); }
  },
);

it('lets ordered pull apply unrelated changes without skipping an unapplied revision', async () => {
  const f = await fixture('edit', true);
  try {
    expect((await f.b.readNote(beforeId)).body).toBe('Unrelated\n');
    await expect(f.b.readNote(afterId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await f.cb.executeKeepLocalDecision(scope, f.intent.decisionId)).status).toBe('completed');
    expect(f.cb.getCursor()).toBe(f.cursor);
    const hook = intercept(f.b, (writes) => ({
      ...writes,
      createNote: async (note) => {
        if (note.id === afterId) throw new Error('unrelated write interrupted');
        await writes.createNote(note);
      },
    }));
    try { await expect(f.cb.pull()).rejects.toThrow('unrelated write interrupted'); }
    finally { hook.mockRestore(); }
    const cursor = JSON.parse(Buffer.from(f.cb.getCursor()!, 'base64url').toString('utf8')) as { seq: number };
    expect(cursor.seq).toBe(f.change.vaultSeq);
    await expect(f.b.readNote(afterId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const retry = f.restart();
    await retry.pull();
    expect((await f.b.readNote(afterId)).body).toBe('Unrelated\n');
    expect(await f.take(f.b)).toEqual(f.local);
    expect(await f.take(f.b, f.copy.id)).toEqual(f.copy);
    await retry.pull();
    expect(await f.take(f.b)).toEqual(f.local);
  } finally { await f.cleanup(); }
});

it.each(['local', 'copy', 'missing-copy'] as const)('preserves a changed %s before execution', async (fault) => {
  const f = await fixture();
  try {
    if (fault === 'local') await f.b.replaceNote({ ...(await f.b.readNote(id)), body: 'New local\n' });
    if (fault === 'copy') await writeFile(join(f.b.root, f.copy.path), f.copy.content.replace('Selected local', 'Changed copy'));
    if (fault === 'missing-copy') {
      await f.b.deleteNote(f.copy.id);
    }
    const before = await f.take(f.b);
    const outcome = await f.cb.executeKeepLocalDecision(scope, f.intent.decisionId);
    expect(outcome.status).toBe(fault === 'local' ? 'rejected-stale' : 'needs-recovery');
    expect(await f.take(f.b)).toEqual(before);
    expect(f.control.attempts).toEqual([]);
    expect(f.cb.getKeepLocalReconciliation(scope, f.intent.decisionId)).toBeNull();
  } finally { await f.cleanup(); }
});

it('refuses to publish a reserved operation with newer local bytes', async () => {
  const f = await fixture();
  try {
    const hook = vi.spyOn(SyncStateStore.prototype, 'markResolutionSending').mockImplementationOnce(() => { throw new Error('paused'); });
    try { await expect(f.cb.executeKeepLocalDecision(scope, f.intent.decisionId)).rejects.toThrow('paused'); }
    finally { hook.mockRestore(); }
    const reserved = f.cb.getKeepLocalReconciliation(scope, f.intent.decisionId)!;
    await f.b.replaceNote({ ...(await f.b.readNote(id)), body: 'Newer unreviewed local\n' });
    const before = await f.take(f.b);
    const retry = f.restart();
    expect((await retry.executeKeepLocalDecision(scope, f.intent.decisionId)).status).toBe('needs-recovery');
    expect(retry.getKeepLocalReconciliation(scope, f.intent.decisionId)!.operationId).toBe(reserved.operationId);
    expect(f.control.attempts).toEqual([]);
    expect(await f.take(f.b)).toEqual(before);
    const queued = f.stateRead((state) => state.pendingOperations());
    expect(queued).toHaveLength(1);
    expect(queued[0]!.changes[0]!.content).toBe(f.local.content);
  } finally { await f.cleanup(); }
});

it.each(['local', 'copy'] as const)('records known relay acceptance without completing over a changed %s', async (fault) => {
  const f = await fixture();
  try {
    f.control.afterPush = async () => {
      f.control.afterPush = null;
      const original = fault === 'local' ? f.local : f.copy;
      await writeFile(join(f.b.root, original.path), original.content.replace('Selected local', 'Changed after acceptance'));
      throw new Error('response lost');
    };
    await expect(f.cb.executeKeepLocalDecision(scope, f.intent.decisionId)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    const changed = await f.take(f.b, fault === 'local' ? id : f.copy.id);
    const retry = f.restart();
    const outcome = await retry.executeKeepLocalDecision(scope, f.intent.decisionId);
    expect(outcome.status).toBe('needs-recovery');
    expect(outcome.result).toBeNull();
    expect(retry.getKeepLocalReconciliation(scope, f.intent.decisionId)).toMatchObject({ relayAccepted: true, relayVersion: 3 });
    expect(await f.take(f.b, fault === 'local' ? id : f.copy.id)).toEqual(changed);
    expect(f.control.attempts).toHaveLength(1);
    expect(retry.getCursor()).toBe(f.cursor);
    expect(f.stateRead((state) => state.pendingOperations())).toEqual([]);
  } finally { await f.cleanup(); }
});

it('keeps uncertain acceptance visible when relay operation history is unavailable', async () => {
  const f = await fixture();
  try {
    f.control.afterPush = async () => { f.control.afterPush = null; throw new Error('lost response'); };
    await expect(f.cb.executeKeepLocalDecision(scope, f.intent.decisionId)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    f.control.hideHistory = true;
    const retry = f.restart();
    const outcome = await retry.executeKeepLocalDecision(scope, f.intent.decisionId);
    expect(outcome.status).toBe('needs-recovery');
    expect(outcome.diagnostic).toContain('result is unavailable');
    expect(retry.getKeepLocalReconciliation(scope, f.intent.decisionId)!.relayAccepted).toBeNull();
    expect(f.control.attempts).toHaveLength(1);
    expect(await f.take(f.b)).toEqual(f.local);
    expect(retry.getCursor()).toBe(f.cursor);
  } finally { await f.cleanup(); }
});

it('routes a reserved conditional operation through normal outbox processing', async () => {
  const f = await fixture();
  try {
    f.control.beforePush = async () => { f.control.beforePush = null; throw new Error('before send'); };
    await expect(f.cb.executeKeepLocalDecision(scope, f.intent.decisionId)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    const retry = f.restart();
    await retry.pushOutbox();
    expect(retry.getResolutionDecision(scope, f.intent.decisionId)!.status).toBe('completed');
    expect(f.control.attempts[1]).toEqual(f.control.attempts[0]);
    await retry.pull();
    expect(await f.take(f.b)).toEqual(f.local);
  } finally { await f.cleanup(); }
});

it('serializes duplicate execution and pull against one conditional operation', async () => {
  const f = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const inside = new Promise<void>((resolve) => { entered = resolve; });
  try {
    f.control.beforePush = async () => { entered(); await gate; };
    const first = f.cb.executeKeepLocalDecision(scope, f.intent.decisionId);
    await inside;
    const other = f.anotherClient();
    const second = other.executeKeepLocalDecision(scope, f.intent.decisionId);
    const pulling = other.pull();
    release();
    const [one, two] = await Promise.all([first, second, pulling]);
    expect(one).toEqual(two);
    expect(f.control.attempts).toHaveLength(1);
    expect(await f.take(f.b)).toEqual(f.local);
    expect(await f.take(f.b, f.copy.id)).toEqual(f.copy);
  } finally {
    release();
    await f.cleanup();
  }
});

it('rejects another epoch and keeps tombstone preparation disabled', async () => {
  const f = await fixture();
  try {
    await expect(f.cb.executeKeepLocalDecision({ ...scope, epoch: 2 }, f.intent.decisionId)).rejects.toThrow('vault and epoch');
    await expect(f.cb.prepareResolutionDecision(scope, {
      ...f.intent, decisionId: randomUUID(),
      expectedRemote: { ...f.intent.expectedRemote, operation: 'delete', content: null, contentHash: hashHex('') },
    })).rejects.toThrow('restore semantics');
    expect(f.control.attempts).toEqual([]);
    expect(await f.take(f.b)).toEqual(f.local);
  } finally { await f.cleanup(); }
});

it.each([false, true])('rejects stale remote evidence before reserving an outbox entry (retired=%s)', async (retired) => {
  const f = await fixture();
  try {
    await f.advanceRemote(retired);
    const result = await f.cb.executeKeepLocalDecision(scope, f.intent.decisionId);
    expect(result.status).toBe('rejected-stale');
    expect(f.cb.getKeepLocalReconciliation(scope, f.intent.decisionId)).toBeNull();
    expect(f.control.attempts).toEqual([]);
    expect(await f.take(f.b)).toEqual(f.local);
    expect(await f.take(f.b, f.copy.id)).toEqual(f.copy);
  } finally { await f.cleanup(); }
});

it('does not replace a newer local edit when the accepted echo arrives', async () => {
  const f = await fixture();
  try {
    const accepted = await f.cb.executeKeepLocalDecision(scope, f.intent.decisionId);
    await f.b.replaceNote({ ...(await f.b.readNote(id)), body: 'New edit after completion\n' });
    const latest = await f.take(f.b);
    await f.cb.pull();
    expect(await f.take(f.b)).toEqual(latest);
    expect(await f.cb.executeKeepLocalDecision(scope, f.intent.decisionId)).toEqual(accepted);
    expect(f.control.attempts).toHaveLength(1);
  } finally { await f.cleanup(); }
});

it.each(['same-document', 'other-document'] as const)('requires earlier %s outbox edits to reconcile first', async (pending) => {
  const f = await fixture();
  try {
    const pendingId = pending === 'same-document' ? id : beforeId;
    if (pending === 'other-document') {
      await f.b.createNote(createNote({ id: pendingId, path: 'notes/outgoing.md', title: 'Outgoing', body: 'Earlier\n', now }));
    }
    await f.cb.enqueueNoteChange(pendingId, pending === 'same-document' ? 'update' : 'create');
    const held = await f.cb.executeKeepLocalDecision(scope, f.intent.decisionId);
    expect(held.status).toBe(pending === 'same-document' ? 'rejected-stale' : 'needs-recovery');
    expect(f.cb.getKeepLocalReconciliation(scope, f.intent.decisionId)).toBeNull();
    expect(f.control.attempts).toEqual([]);
    if (pending === 'other-document') {
      await f.cb.pushOutbox();
      expect((await f.cb.executeKeepLocalDecision(scope, f.intent.decisionId)).status).toBe('completed');
      expect(f.control.attempts.map((operation) => operation.deviceSeq)).toEqual([1, 2]);
    }
    expect(await f.take(f.b)).toEqual(f.local);
  } finally { await f.cleanup(); }
});

it('adds resolution outbox linkage without reclassifying or changing legacy queued edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nodus-local-outbox-migration-'));
  const path = join(root, 'sync.sqlite');
  let state = SyncStateStore.open(path);
  try {
    const content = serializeNote(createNote({ id, path: 'notes/legacy.md', title: 'Legacy', body: 'Legacy\n', now }));
    const queued = state.enqueue(randomUUID(), [{
      kind: 'note', id, op: 'create', baseVersion: 0, version: 1,
      path: 'notes/legacy.md', contentHash: hashHex(content), content,
    }]);
    state.close();
    const legacy = new DatabaseSync(path);
    legacy.exec('DROP TABLE resolution_outbox_v1');
    const before = legacy.prepare('SELECT * FROM outbox').all();
    legacy.close();
    state = SyncStateStore.open(path);
    expect(state.pendingOperations()).toEqual([queued]);
    expect(state.resolutionForOutbox(queued.operationId)).toBeNull();
    state.close();
    const migrated = new DatabaseSync(path);
    expect(migrated.prepare('SELECT * FROM outbox').all()).toEqual(before);
    expect(migrated.prepare('SELECT * FROM resolution_outbox_v1').all()).toEqual([]);
    migrated.close();
    state = SyncStateStore.open(path);
  } finally {
    state.close();
    await rm(root, { recursive: true, force: true });
  }
});
