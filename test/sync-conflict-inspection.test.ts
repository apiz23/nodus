import { createServer, type Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { parseNote, serializeNote } from '../src/format/note-format.js';
import { StorageError } from '../src/storage/errors.js';
import { AuthService } from '../src/relay/auth.js';
import { RelayDatabase } from '../src/relay/db.js';
import { createRelayServer } from '../src/relay/server.js';
import { SyncService } from '../src/relay/sync.js';
import { SyncClient } from '../src/sync/client.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import type { SyncWriteSession } from '../src/storage/fs/vault.js';

const VAULT = '00000000-0000-0000-0000-000000000001';
const ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-10-25T12:00:00Z';
const hash = (content: string) => createHash('sha256').update(content).digest('hex');

it('inspects exact local, incoming, and preserved bytes without changing the vault or cursor', async () => {
  const relayDir = await mkdtemp(join(tmpdir(), 'nodus-inspect-relay-'));
  const relayDb = RelayDatabase.open(join(relayDir, 'relay.sqlite'));
  const auth = new AuthService(relayDb);
  const identity = { vaultId: VAULT, epoch: 1 };
  const server: Server = createRelayServer({ db: relayDb, auth, sync: new SyncService(relayDb, identity), identity, adminToken: 'admin-test' });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No relay address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const rootA = await mkdtemp(join(tmpdir(), 'nodus-inspect-a-'));
  const rootB = await mkdtemp(join(tmpdir(), 'nodus-inspect-b-'));
  const vaultA = await FileSystemVault.open(rootA);
  const vaultB = await FileSystemVault.open(rootB);
  const pair = async (name: string) => {
    const { code } = await auth.generatePairingCode(name);
    return SyncClient.pair(baseUrl, code, name);
  };
  const credsA = await pair('A'); const credsB = await pair('B');
  const a = new SyncClient({ vault: vaultA, baseUrl, token: credsA.token, deviceId: credsA.deviceId });
  const b = new SyncClient({ vault: vaultB, baseUrl, token: credsB.token, deviceId: credsB.deviceId });
  try {
    await a.bootstrap();
    const initial = createNote({ id: ID, title: 'Inspected note', path: 'notes/inspected.md', body: 'base bytes\n', now: NOW });
    await vaultA.createNote(initial);
    await a.enqueueNoteChange(ID, 'create', { baseVersion: 0 });
    await a.pushOutbox();
    await b.bootstrap();

    await vaultA.replaceNote({ ...initial, body: 'incoming bytes\n', updatedAt: NOW });
    await a.enqueueNoteChange(ID, 'update');
    await a.pushOutbox();
    await vaultB.replaceNote({ ...initial, body: 'local bytes\n', updatedAt: NOW });
    const before = await vaultB.readNoteWithHash(ID);
    const cursor = b.getCursor();
    const originalWrite = vaultB.withSyncWrite.bind(vaultB);
    const failure = vi.spyOn(vaultB, 'withSyncWrite').mockImplementationOnce(
      <T>(operation: (writes: SyncWriteSession) => Promise<T>) => originalWrite((writes) => operation({
        ...writes,
        replaceNote: async () => { throw new StorageError('STALE_WRITE', 'Injected remote publication boundary'); },
      })),
    );
    try { await expect(b.pull()).rejects.toMatchObject({ code: 'STALE_WRITE' }); }
    finally { failure.mockRestore(); }

    const conflict = b.listConflicts().conflicts[0]!;
    const detail = await b.inspectConflict(conflict.conflictId);
    expect(detail?.local).toMatchObject({ path: before.note.path, hash: before.hash, content: before.text });
    expect(detail?.remote).toMatchObject({ content: (await vaultA.readNoteWithHash(ID)).text, verified: true });
    expect(detail?.remote?.hash).toBe(hash(detail!.remote!.content!));
    expect(detail?.copy?.content).toContain('local bytes');
    expect(detail?.copy?.actualHash).toBe(hash(detail!.copy!.content!));
    expect(detail?.copy?.actualHash).toBe(detail?.copy?.expectedHash);
    expect(await vaultB.readNoteWithHash(ID)).toEqual(before);
    expect(b.getCursor()).toBe(cursor);
    const reviewed = detail!;
    expect(reviewed.diagnostics).toEqual([]);
    expect(reviewed.copy?.verified).toBe(true);
    expect(reviewed.summary.local).toMatchObject({ path: reviewed.local!.path, hash: reviewed.local!.hash });
    const remotePreview = await b.previewRemoteResolution(conflict.conflictId, {
      localHash: reviewed.local!.hash, remoteHash: reviewed.remote!.hash, copyHash: reviewed.copy!.expectedHash,
    });
    expect(remotePreview).toMatchObject({ id: ID, path: reviewed.remote!.path, contentHash: hash(remotePreview.content) });
    const mergedPreview = await b.previewMergedCopy(conflict.conflictId,
      serializeNote(parseNote(reviewed.local!.content, reviewed.local!.path)).replace('local bytes', 'reviewed merge'), {
        localHash: reviewed.local!.hash, remoteHash: reviewed.remote!.hash, copyHash: reviewed.copy!.expectedHash,
      });
    expect(mergedPreview.id).not.toBe(ID);
    expect(mergedPreview.path).not.toBe(reviewed.local!.path);
    expect(mergedPreview.content).toContain('reviewed merge');
    expect(mergedPreview.contentHash).toBe(hash(mergedPreview.content));
    expect(await vaultB.readNoteWithHash(ID)).toEqual(before);
    expect(b.listResolutionHistory(identity, conflict.conflictId, 50).decisions).toHaveLength(0);
    const targetContent = serializeNote(parseNote(reviewed.remote!.content!, reviewed.remote!.path));
    const decision = {
      schemaVersion: 1 as const, decisionId: randomUUID(), conflictId: conflict.conflictId,
      document: conflict.document, action: 'keep-remote' as const, expectedBase: conflict.base,
      expectedLocal: { id: reviewed.local!.id, path: reviewed.local!.path, contentHash: reviewed.local!.hash, content: reviewed.local!.content },
      expectedRemote: { version: reviewed.remote!.version, path: reviewed.remote!.path, contentHash: reviewed.remote!.hash,
        operation: reviewed.remote!.operation as 'update', content: reviewed.remote!.content },
      expectedCopy: { id: reviewed.copy!.id, path: reviewed.copy!.path, contentHash: reviewed.copy!.expectedHash, content: reviewed.copy!.content! },
      target: { id: ID, path: reviewed.remote!.path, content: targetContent, contentHash: hash(targetContent) },
    };
    await expect(b.prepareReviewedResolutionDecision(identity, decision, {
      localHash: reviewed.local!.hash, remoteHash: '0'.repeat(64), copyHash: reviewed.copy!.expectedHash,
    })).rejects.toThrow('Conflict evidence changed');
    const prepared = await b.prepareReviewedResolutionDecision(identity, decision, {
      localHash: reviewed.local!.hash, remoteHash: reviewed.remote!.hash, copyHash: reviewed.copy!.expectedHash,
    });
    expect(prepared).toMatchObject({ status: 'prepared', intent: decision });
  } finally {
    a.close(); b.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    relayDb.close(); vaultA.dispose(); vaultB.dispose();
  }
});
