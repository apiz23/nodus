import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { parseNote, serializeNote } from '../src/format/note-format.js';
import { AuthService, hashHex } from '../src/relay/auth.js';
import { RelayDatabase } from '../src/relay/db.js';
import { SyncService } from '../src/relay/sync.js';
import { createRelayServer } from '../src/relay/server.js';
import { StorageError } from '../src/storage/errors.js';
import { FileSystemVault, type SyncWriteSession } from '../src/storage/fs/vault.js';
import { conflictRevisionKey } from '../src/sync/conflict-registry.js';
import { SyncClient } from '../src/sync/client.js';
import type { ResolutionIntent, ResolutionSnapshot } from '../src/sync/resolution-decisions.js';
import { SyncStateStore } from '../src/sync/state.js';

const now = '2026-11-11T00:00:00Z';
const originalId = '11111111-1111-4111-8111-111111111111';
const scope = { vaultId: '00000000-0000-0000-0000-000000000001', epoch: 1 };

function intercept(vault: FileSystemVault, transform: (writes: SyncWriteSession) => SyncWriteSession) {
  const original = vault.withSyncWrite.bind(vault);
  return vi.spyOn(vault, 'withSyncWrite').mockImplementationOnce(
    <T>(operation: (writes: SyncWriteSession) => Promise<T>) => original((writes) => operation(transform(writes))),
  );
}

async function noteSnapshot(vault: FileSystemVault, id: string): Promise<ResolutionSnapshot> {
  const { note, text, hash } = await vault.readNoteWithHash(id);
  return { id: note.id, path: note.path, content: text, contentHash: hash };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nodus-merged-copy-'));
  const relayDb = RelayDatabase.open(join(root, 'relay.sqlite'));
  const auth = new AuthService(relayDb);
  const server: Server = createRelayServer({ db: relayDb, auth, sync: new SyncService(relayDb, scope), identity: scope, adminToken: 'test' });
  const clients: SyncClient[] = [];
  const cleanup = async () => {
    for (const client of clients) client.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    relayDb.close();
    await rm(root, { recursive: true, force: true });
  };
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) throw new Error('Missing relay address');
    const baseUrl = 'http://127.0.0.1:' + address.port;
    const a = await FileSystemVault.open(join(root, 'a'));
    const b = await FileSystemVault.open(join(root, 'b'));
    const pair = async (device: string) => {
      const { code } = await auth.generatePairingCode(device);
      return SyncClient.pair(baseUrl, code, device);
    };
    const ca = new SyncClient({ vault: a, baseUrl, ...(await pair('A')), now: () => now });
    const cbOptions = { vault: b, baseUrl, ...(await pair('B')), now: () => now };
    const cb = new SyncClient(cbOptions);
    clients.push(ca, cb);
    await ca.bootstrap();
    await a.createNote(createNote({ id: originalId, path: 'notes/original.md', title: 'Original', body: 'Initial local base\n', now }));
    await ca.enqueueNoteChange(originalId, 'create');
    await ca.pushOutbox();
    await cb.bootstrap();
    await a.replaceNote({ ...(await a.readNote(originalId)), body: 'Incoming remote revision\n' });
    await ca.enqueueNoteChange(originalId, 'update');
    await ca.pushOutbox();
    await b.replaceNote({ ...(await b.readNote(originalId)), body: 'Divergent local revision\n' });
    const originalPull = b.withSyncWrite.bind(b);
    const blocked = vi.spyOn(b, 'withSyncWrite').mockImplementationOnce(
      <T>(operation: (writes: SyncWriteSession) => Promise<T>) => originalPull((writes) => operation({
        ...writes,
        replaceNote: async () => { throw new StorageError('STALE_WRITE', 'Injected remote apply block'); },
      })),
    );
    try { await expect(cb.pull()).rejects.toMatchObject({ code: 'STALE_WRITE' }); }
    finally { blocked.mockRestore(); }

    const conflict = cb.listConflicts().conflicts[0]!;
    const state = SyncStateStore.open(join(b.root, '.nodus', 'sync.sqlite'));
    const incoming = state.recordedChange(scope, conflictRevisionKey(scope, conflict.conflictId))!;
    state.close();
    const local = await noteSnapshot(b, originalId);
    const copy = await noteSnapshot(b, conflict.copy!.id!);
    const mergedId = randomUUID();
    const mergedContent = serializeNote(createNote({ id: mergedId, path: 'notes/reconciled.md', title: 'Reviewed merge', body: 'Local and remote reconciled\n', now }));
    const target: ResolutionSnapshot = { id: mergedId, path: 'notes/reconciled.md', content: mergedContent, contentHash: hashHex(mergedContent) };
    const intent: ResolutionIntent = {
      schemaVersion: 1, decisionId: randomUUID(), conflictId: conflict.conflictId,
      document: { kind: 'note', id: originalId }, action: 'save-merged-copy',
      expectedBase: conflict.base, expectedLocal: local, expectedRemote: {
        version: incoming.version, path: incoming.path, operation: incoming.op,
        contentHash: incoming.contentHash, content: incoming.content ?? null,
      }, expectedCopy: copy, target,
    };
    await cb.prepareResolutionDecision(scope, intent);
    return {
      root, a, b, ca, cb, cbOptions, clients, conflict, intent, local, copy, target, incoming,
      cleanup,
      restart: () => { const next = new SyncClient(cbOptions); clients.push(next); return next; },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

it('publishes an explicit third note, preserves both source versions, and records registry/history evidence', async () => {
  const f = await fixture();
  try {
    const remote = await noteSnapshot(f.a, originalId);
    const result = await f.cb.executeMergedCopyDecision(scope, f.intent.decisionId);
    expect(result).toMatchObject({ status: 'completed', result: {
      id: f.target.id, path: f.target.path, contentHash: f.target.contentHash, relayVersion: null,
    } });
    expect(await noteSnapshot(f.b, f.target.id)).toEqual(f.target);
    expect(await noteSnapshot(f.b, originalId)).toEqual(f.local);
    expect(await noteSnapshot(f.a, originalId)).toEqual(remote);
    expect(await noteSnapshot(f.b, f.copy.id)).toEqual(f.copy);
    expect(f.cb.listConflicts().conflicts[0]).toMatchObject({ status: 'needs-recovery', mergedCopyCount: 1 });
    expect(f.cb.listResolutionHistory(scope, f.conflict.conflictId).decisions[0]).toMatchObject({
      action: 'save-merged-copy', status: 'completed', result: { id: f.target.id, path: f.target.path, contentHash: f.target.contentHash },
    });
    expect(await f.cb.executeMergedCopyDecision(scope, f.intent.decisionId)).toEqual(result);
    expect(await f.b.listNotes()).toHaveLength(3);
    await f.cb.prepareResolutionDecision(scope, {
      ...f.intent, decisionId: randomUUID(), action: 'keep-remote', target: f.intent.expectedRemote.content === null ? null : {
        id: originalId, path: f.intent.expectedRemote.path, content: f.intent.expectedRemote.content,
        contentHash: f.intent.expectedRemote.contentHash,
      },
    });
  } finally { await f.cleanup(); }
});

it.each(['changed-local', 'changed-copy', 'missing-copy', 'changed-remote'] as const)(
  'keeps all files and marks %s evidence stale or recoverable', async (fault) => {
    const f = await fixture();
    try {
      if (fault === 'changed-local') await f.b.replaceNote({ ...(await f.b.readNote(originalId)), body: 'Changed after review\n' });
      if (fault === 'changed-copy') await f.b.replaceNote({ ...(await f.b.readNote(f.copy.id)), body: 'Changed preserved copy\n' });
      if (fault === 'missing-copy') await f.b.deleteNote(f.copy.id);
      if (fault === 'changed-remote') {
        await f.a.replaceNote({ ...(await f.a.readNote(originalId)), body: 'Newer remote revision\n' });
        await f.ca.enqueueNoteChange(originalId);
        await f.ca.pushOutbox();
      }
      const sourceBefore = await noteSnapshot(f.b, originalId);
      const result = await f.cb.executeMergedCopyDecision(scope, f.intent.decisionId);
      expect(result.status).toBe(fault === 'changed-local' || fault === 'changed-remote' ? 'rejected-stale' : 'needs-recovery');
      await expect(f.b.readNote(f.target.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await noteSnapshot(f.b, originalId)).toEqual(sourceBefore);
      if (fault === 'missing-copy') await expect(f.b.readNote(f.copy.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      else if (fault === 'changed-copy') expect((await f.b.readNote(f.copy.id)).body).toBe('Changed preserved copy\n');
      else expect(await noteSnapshot(f.b, f.copy.id)).toEqual(f.copy);
    } finally { await f.cleanup(); }
  },
);

it('recovers an interruption after the durable staging reservation and before publication', async () => {
  const f = await fixture();
  try {
    const hook = intercept(f.b, (writes) => ({
      ...writes,
      publishReviewedDocument: async (kind, target, beforePublish, stagingPath) =>
        writes.publishReviewedDocument(kind, target, async (evidence) => {
          await beforePublish(evidence);
          throw new Error('injected after reservation');
        }, stagingPath),
    }));
    try {
      const interrupted = await f.cb.executeMergedCopyDecision(scope, f.intent.decisionId);
      expect(interrupted.status).toBe('needs-recovery');
      expect(interrupted.diagnostic).toContain('injected after reservation');
    } finally { hook.mockRestore(); }
    const state = SyncStateStore.open(join(f.b.root, '.nodus', 'sync.sqlite'));
    const reservation = state.getMergedPublication(scope, f.intent.decisionId)!;
    state.close();
    expect(reservation.stagingPath).toBeTruthy();
    const retried = await f.restart().executeMergedCopyDecision(scope, f.intent.decisionId);
    expect(retried.status).toBe('completed');
    expect(await noteSnapshot(f.b, f.target.id)).toEqual(f.target);
    const after = SyncStateStore.open(join(f.b.root, '.nodus', 'sync.sqlite'));
    expect(after.getMergedPublication(scope, f.intent.decisionId)).toEqual(reservation);
    after.close();
  } finally { await f.cleanup(); }
});

it('reconciles an exact published result when SQLite completion was interrupted', async () => {
  const f = await fixture();
  try {
    const db = new DatabaseSync(join(f.b.root, '.nodus', 'sync.sqlite'));
    db.exec(`CREATE TRIGGER reject_merged_completion BEFORE UPDATE OF status ON resolution_decisions_v1
      WHEN NEW.status = 'completed' BEGIN SELECT RAISE(ABORT, 'injected SQLite completion failure'); END;`);
    await expect(f.cb.executeMergedCopyDecision(scope, f.intent.decisionId)).rejects.toThrow('injected SQLite completion failure');
    expect(f.cb.getResolutionDecision(scope, f.intent.decisionId)?.status).toBe('applying');
    expect(await noteSnapshot(f.b, f.target.id)).toEqual(f.target);
    db.exec('DROP TRIGGER reject_merged_completion');
    db.close();
    const retried = await f.restart().executeMergedCopyDecision(scope, f.intent.decisionId);
    expect(retried.status).toBe('completed');
    expect(await noteSnapshot(f.b, originalId)).toEqual(f.local);
    expect(await noteSnapshot(f.b, f.copy.id)).toEqual(f.copy);
  } finally { await f.cleanup(); }
});

it('never overwrites an occupied destination, even when it contains the reviewed bytes', async () => {
  const f = await fixture();
  try {
    const otherId = randomUUID();
    const other = parseNote(f.target.content, f.target.path);
    await f.b.createNote({ ...other, id: otherId, title: 'Occupant' });
    const before = await readFile(join(f.b.root, f.target.path));
    const result = await f.cb.executeMergedCopyDecision(scope, f.intent.decisionId);
    expect(result.status).toBe('needs-recovery');
    expect(await readFile(join(f.b.root, f.target.path))).toEqual(before);
    expect(await noteSnapshot(f.b, originalId)).toEqual(f.local);
    expect(await noteSnapshot(f.b, f.copy.id)).toEqual(f.copy);
  } finally { await f.cleanup(); }
});

it('rejects a changed local revision before creating the merged result', async () => {
  const f = await fixture();
  try {
    await f.b.replaceNote({ ...(await f.b.readNote(originalId)), body: 'Edited after review\n' });
    const changed = await noteSnapshot(f.b, originalId);
    const result = await f.cb.executeMergedCopyDecision(scope, f.intent.decisionId);
    expect(result.status).toBe('rejected-stale');
    await expect(f.b.readNote(f.target.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await noteSnapshot(f.b, originalId)).toEqual(changed);
    expect(await noteSnapshot(f.b, f.copy.id)).toEqual(f.copy);
  } finally { await f.cleanup(); }
});

it('serializes concurrent sync and duplicate resolution requests and returns one stable result', async () => {
  const f = await fixture();
  try {
    const [first, second, pullResult] = await Promise.all([
      f.cb.executeMergedCopyDecision(scope, f.intent.decisionId),
      f.restart().executeMergedCopyDecision(scope, f.intent.decisionId),
      f.cb.pull().then(() => null, (error: unknown) => error),
    ]);
    expect([first.status, second.status]).toEqual(['completed', 'completed']);
    expect(first).toEqual(second);
    expect(pullResult).toBeInstanceOf(Error);
    expect(await f.b.listNotes()).toHaveLength(3);
    expect(await noteSnapshot(f.b, originalId)).toEqual(f.local);
  } finally { await f.cleanup(); }
});

it('marks an identical destination without the reserved ownership anchor for manual recovery', async () => {
  const f = await fixture();
  try {
    const state = SyncStateStore.open(join(f.b.root, '.nodus', 'sync.sqlite'));
    let decision = state.getResolutionDecision(scope, f.intent.decisionId)!;
    decision = state.transitionResolutionDecision(scope, f.intent.decisionId, { expectedRevision: decision.revision, status: 'applying' });
    state.reserveMergedPublication(scope, f.intent.decisionId);
    state.close();
    await writeFile(join(f.b.root, f.target.path), f.target.content, { flag: 'wx' });
    const result = await f.cb.executeMergedCopyDecision(scope, f.intent.decisionId);
    expect(result.status).toBe('needs-recovery');
    expect(await noteSnapshot(f.b, f.target.id)).toEqual(f.target);
    expect(await noteSnapshot(f.b, originalId)).toEqual(f.local);
  } finally { await f.cleanup(); }
});

it('retries after the reservation transaction fails without publishing early', async () => {
  const f = await fixture();
  try {
    const hook = vi.spyOn(SyncStateStore.prototype, 'reserveMergedPublication').mockImplementationOnce(() => {
      throw new Error('injected reservation transaction failure');
    });
    try { await expect(f.cb.executeMergedCopyDecision(scope, f.intent.decisionId)).rejects.toThrow('injected reservation transaction failure'); }
    finally { hook.mockRestore(); }
    expect(f.cb.getResolutionDecision(scope, f.intent.decisionId)?.status).toBe('applying');
    await expect(f.b.readNote(f.target.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await f.restart().executeMergedCopyDecision(scope, f.intent.decisionId)).status).toBe('completed');
  } finally { await f.cleanup(); }
});

it('does not create a merged document with a relay identity that has been retired', async () => {
  const f = await fixture();
  try {
    await f.a.createNote(parseNote(f.target.content, f.target.path));
    await f.ca.enqueueNoteChange(f.target.id, 'create');
    await f.ca.pushOutbox();
    await f.ca.enqueueNoteChange(f.target.id, 'delete');
    await f.a.deleteNote(f.target.id);
    await f.ca.pushOutbox();
    const result = await f.cb.executeMergedCopyDecision(scope, f.intent.decisionId);
    expect(result.status).toBe('needs-recovery');
    expect(result.diagnostic).toContain('used or retired');
    expect(await noteSnapshot(f.b, originalId)).toEqual(f.local);
    expect(await noteSnapshot(f.b, f.copy.id)).toEqual(f.copy);
  } finally { await f.cleanup(); }
});

it.each(['altered', 'missing'] as const)('marks a %s reviewed payload for manual recovery and does not publish it', async (fault) => {
  const f = await fixture();
  try {
    const db = new DatabaseSync(join(f.b.root, '.nodus', 'sync.sqlite'));
    const row = db.prepare('SELECT intentJson FROM resolution_decisions_v1 WHERE decisionId = ?').get(f.intent.decisionId) as { intentJson: string };
    const changed = JSON.parse(row.intentJson) as ResolutionIntent;
    if (fault === 'altered') changed.target!.content = changed.target!.content.replace('Local and remote reconciled', 'Different payload');
    else changed.target = null;
    db.prepare('UPDATE resolution_decisions_v1 SET intentJson = ? WHERE decisionId = ?').run(JSON.stringify(changed), f.intent.decisionId);
    db.close();
    const result = await f.cb.executeMergedCopyDecision(scope, f.intent.decisionId);
    expect(result.status).toBe('needs-recovery');
    expect(result.diagnostic).toContain('payload');
    await expect(f.b.readNote(f.target.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await noteSnapshot(f.b, originalId)).toEqual(f.local);
  } finally { await f.cleanup(); }
});
