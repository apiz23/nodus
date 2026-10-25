import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RelayDatabase } from '../../src/relay/db.js';
import { SyncService } from '../../src/relay/sync.js';
import type { PushRequest } from '../../src/relay/contracts.js';
import type { ChangeInput } from '../../src/sync/contracts.js';
import { hashHex } from '../../src/relay/auth.js';

const NOW = '2026-10-25T12:00:00Z';
const DEVICE = 'device-1';
const DEVICE_B = 'device-2';
const VAULT_ID = '00000000-0000-0000-0000-000000000001';
const N1 = '11111111-1111-4111-1111-111111111111';
const N2 = '22222222-2222-4222-2222-222222222222';

function text(body: string): { content: string; contentHash: string } {
  const content = `---\ntitle: T\nnodus:\n  version: 1\n  id: ${N1}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\n${body}`;
  return { content, contentHash: hashHex(content) };
}

async function tmpSync(): Promise<{ db: RelayDatabase; sync: SyncService; dbPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'nodus-sync-'));
  const dbPath = join(dir, 'relay.sqlite');
  const db = RelayDatabase.open(dbPath);
  const sync = new SyncService(db, { vaultId: VAULT_ID, epoch: 1 });
  return { db, sync, dbPath };
}

function change(c: Omit<ChangeInput, 'contentHash'> & { contentHash?: string }): ChangeInput {
  const content = c.content ?? '';
  return {
    ...c,
    content,
    contentHash: c.contentHash ?? hashHex(content),
  } as ChangeInput;
}

function push(op: string, deviceSeq: number, changes: ChangeInput[]): PushRequest {
  return { operationId: op, deviceSeq, changes };
}

function encodeCursor(seq: number): string {
  return Buffer.from(JSON.stringify({ seq })).toString('base64url');
}

describe('SyncService', () => {
  it('creates a document', async () => {
    const { sync } = await tmpSync();
    const { content, contentHash } = text('Hello');
    const res = sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content }),
    ]));
    expect(res.deviceSeq).toBe(1);
    expect(res.results[0]!.status).toBe('applied');
    expect(res.results[0]!.version).toBe(1);
    expect(res.results[0]!.vaultSeq).toBe(1);
  });

  it('rejects stale baseVersion', async () => {
    const { sync } = await tmpSync();
    const v1 = text('Hello');
    sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash: v1.contentHash, content: v1.content }),
    ]));
    const v2 = text('Hello world');
    sync.push(DEVICE, push('op-2', 2, [
      change({ kind: 'note', id: N1, op: 'update', baseVersion: 1, version: 2, path: 'notes/a.md', contentHash: v2.contentHash, content: v2.content }),
    ]));

    // A concurrent update based on the now-stale version 1 must conflict.
    const stale = text('Stale edit');
    const res = sync.push(DEVICE_B, push('op-b-1', 1, [
      change({ kind: 'note', id: N1, op: 'update', baseVersion: 1, version: 2, path: 'notes/a.md', contentHash: stale.contentHash, content: stale.content }),
    ]));
    expect(res.results[0]!.status).toBe('conflict');
  });

  it('rejects a mismatched vault epoch on sync requests', async () => {
    const { sync } = await tmpSync();
    expect(() => sync.pull(undefined, 100, { vaultId: VAULT_ID, epoch: 2 })).toThrow(
      'Vault identity or epoch changed',
    );
  });

  it('scopes operation IDs to devices', async () => {
    const { sync } = await tmpSync();
    const first = text('One');
    const second = text('Two');
    sync.push(DEVICE, push('shared-op', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash: first.contentHash, content: first.content }),
    ]));
    const other = sync.push(DEVICE_B, push('shared-op', 1, [
      change({ kind: 'note', id: N2, op: 'create', baseVersion: 0, version: 1, path: 'notes/b.md', contentHash: second.contentHash, content: second.content }),
    ]));
    expect(other.results[0]!.status).toBe('applied');
  });

  it('returns stored result for duplicate operation', async () => {
    const { sync } = await tmpSync();
    const { content, contentHash } = text('Hello');
    const req = push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content }),
    ]);
    const first = sync.push(DEVICE, req);
    const second = sync.push(DEVICE, req);
    expect(second.results).toEqual(first.results);
  });

  it('rejects out-of-order device sequences', async () => {
    const { sync } = await tmpSync();
    const { content, contentHash } = text('Hello');
    sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content }),
    ]));
    expect(() => sync.push(DEVICE, push('op-2', 3, [
      change({ kind: 'note', id: N1, op: 'update', baseVersion: 1, version: 2, path: 'notes/a.md', contentHash, content }),
    ]))).toThrow('expected deviceSeq 2');
  });

  it('records and returns operation results', async () => {
    const { sync } = await tmpSync();
    const { content, contentHash } = text('Hello');
    sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content }),
    ]));
    const ops = sync.operations(DEVICE, 1, 1);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.operationId).toBe('op-1');
  });

  it('rolls back a multi-change operation on failure', async () => {
    const { sync, db } = await tmpSync();
    const { content, contentHash } = text('Hello');

    // Inject a trigger that fails after the first document write so the
    // transaction must roll back.
    db.exec(`CREATE TEMP TRIGGER inject_fault AFTER INSERT ON documents
             BEGIN SELECT RAISE(FAIL, 'injected fault'); END;`);

    expect(() => sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content }),
    ]))).toThrow('injected fault');

    const row = db.prepare('SELECT COUNT(*) as c FROM documents').get() as { c: number };
    expect(row.c).toBe(0);
    const opRow = db.prepare('SELECT COUNT(*) as c FROM operations').get() as { c: number };
    expect(opRow.c).toBe(0);
  });

  it('deletes a document and rejects later edits to the retired ID', async () => {
    const { sync } = await tmpSync();
    const { content, contentHash } = text('Hello');
    sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content }),
    ]));
    sync.push(DEVICE, push('op-2', 2, [
      change({ kind: 'note', id: N1, op: 'delete', baseVersion: 1, version: 2, path: 'notes/a.md', contentHash: hashHex('') }),
    ]));

    const recreate = sync.push(DEVICE, push('op-3', 3, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/b.md', contentHash, content }),
    ]));
    expect(recreate.results[0]!.status).toBe('rejected');
  });

  it('paginates pull and advances cursor contiguously', async () => {
    const { sync } = await tmpSync();
    const { content, contentHash } = text('One');
    sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content }),
      change({ kind: 'note', id: N2, op: 'create', baseVersion: 0, version: 1, path: 'notes/b.md', contentHash, content }),
    ]));

    const first = sync.pull(undefined, 1);
    expect(first.changes).toHaveLength(1);
    const second = sync.pull(first.cursor, 1);
    expect(second.changes).toHaveLength(1);
    expect(second.changes[0]!.vaultSeq).toBe(2);
  });

  it('returns bootstrap required when cursor is before retained history', async () => {
    const { sync } = await tmpSync();
    const { content, contentHash } = text('One');
    sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content }),
    ]));
    const before = sync.pull();
    sync.pruneChanges(2);
    const fresh = sync.pull();
    expect(fresh.bootstrapRequired).toBe(true);
    expect(fresh.changes).toHaveLength(0);

    const current = sync.pull(before.cursor);
    expect(current.bootstrapRequired).toBe(false);
    expect(current.changes).toHaveLength(0);
  });

  it('does not reuse vaultSeq after all change history is pruned', async () => {
    const { sync } = await tmpSync();
    const one = text('One');
    sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash: one.contentHash, content: one.content }),
    ]));
    sync.pruneChanges(2);

    const two = text('Two');
    const res = sync.push(DEVICE, push('op-2', 2, [
      change({ kind: 'note', id: N2, op: 'create', baseVersion: 0, version: 1, path: 'notes/b.md', contentHash: two.contentHash, content: two.content }),
    ]));
    expect(res.results[0]!.status).toBe('applied');
    expect(res.results[0]!.vaultSeq).toBe(2);
  });

  it('keeps sequence allocation durable across restart', async () => {
    const { db, sync, dbPath } = await tmpSync();
    const one = text('One');
    sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash: one.contentHash, content: one.content }),
    ]));
    db.close();

    const reopenedDb = RelayDatabase.open(dbPath);
    const reopened = new SyncService(reopenedDb, { vaultId: VAULT_ID, epoch: 1 });
    const two = text('Two');
    const res = reopened.push(DEVICE, push('op-2', 2, [
      change({ kind: 'note', id: N2, op: 'create', baseVersion: 0, version: 1, path: 'notes/b.md', contentHash: two.contentHash, content: two.content }),
    ]));
    expect(res.results[0]!.vaultSeq).toBe(2);
    reopenedDb.close();
  });

  it('returns a snapshot of current documents', async () => {
    const { sync } = await tmpSync();
    const { content, contentHash } = text('One');
    sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content }),
    ]));
    const snap = sync.snapshot();
    expect(snap.documents).toHaveLength(1);
    expect(snap.documents[0]!.id).toBe(N1);
    expect(snap.tombstones).toEqual([]);
  });

  it('snapshot includes tombstones', async () => {
    const { sync } = await tmpSync();
    const { content, contentHash } = text('One');
    sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content }),
    ]));
    sync.push(DEVICE, push('op-2', 2, [
      change({ kind: 'note', id: N1, op: 'delete', baseVersion: 1, version: 2, path: 'notes/a.md', contentHash: hashHex('') }),
    ]));
    const snap = sync.snapshot();
    expect(snap.documents).toHaveLength(0);
    expect(snap.tombstones).toHaveLength(1);
    expect(snap.tombstones[0]!.id).toBe(N1);
  });

  it('rejects a move to an occupied destination', async () => {
    const { sync } = await tmpSync();
    const a = text('A');
    const b = text('B');
    sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash: a.contentHash, content: a.content }),
      change({ kind: 'note', id: N2, op: 'create', baseVersion: 0, version: 1, path: 'notes/b.md', contentHash: b.contentHash, content: b.content }),
    ]));
    const res = sync.push(DEVICE, push('op-2', 2, [
      change({ kind: 'note', id: N2, op: 'move', baseVersion: 1, version: 2, path: 'notes/a.md', contentHash: b.contentHash }),
    ]));
    expect(res.results[0]!.status).toBe('conflict');
  });

  it('rejects case-folded path collisions', async () => {
    const { sync } = await tmpSync();
    const a = text('A');
    sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/A.md', contentHash: a.contentHash, content: a.content }),
    ]));
    const res = sync.push(DEVICE, push('op-2', 2, [
      change({ kind: 'note', id: N2, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash: a.contentHash, content: a.content }),
    ]));
    expect(res.results[0]!.status).toBe('conflict');
  });

  it('survives a relay restart', async () => {
    const { db, sync, dbPath } = await tmpSync();
    const { content, contentHash } = text('Persistent');
    sync.push(DEVICE, push('op-1', 1, [
      change({ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content }),
    ]));

    db.close();
    const restarted = new SyncService(RelayDatabase.open(dbPath), { vaultId: VAULT_ID, epoch: 1 });
    const pulled = restarted.pull();
    expect(pulled.changes).toHaveLength(1);
  });
});
