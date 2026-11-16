import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import type { ChangeRecord } from '../src/sync/contracts.js';
import { SyncStateStore } from '../src/sync/state.js';

const scope = { vaultId: 'vault-a', epoch: 1 };
const time = '2026-11-11T00:00:00Z';
const change: ChangeRecord = {
  id: 'note-a', kind: 'note', op: 'update', version: 2, baseVersion: 1, vaultSeq: 4,
  path: 'notes/original.md', contentHash: 'b'.repeat(64), content: 'remote payload',
  epoch: 1, timestamp: time,
};
const local = { path: change.path, hash: 'a'.repeat(64) };
const reservation = {
  conflictId: 'copy-a', conflictPath: 'notes/copy.md', localPath: local.path,
  localHash: local.hash, copyHash: 'c'.repeat(64), copyText: 'staged copy payload',
};

it('joins evidence by revision and keeps the same ID through reservation, replay and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nodus-conflict-registry-'));
  const path = join(root, 'sync.sqlite');
  let state = SyncStateStore.open(path);
  try {
    state.blockApply(scope.vaultId, scope.epoch, change, 'Local revision changed');
    const first = state.listConflicts(scope).conflicts[0]!;
    expect(first).toMatchObject({ status: 'needs-recovery', copy: null, base: null, local: null });
    state.reserveConflict(scope.vaultId, scope.epoch, change, reservation);
    state.reserveApplyIntent(scope.vaultId, scope.epoch, {
      change, base: null, source: local, target: { path: change.path, hash: change.contentHash }, createdAt: time,
    });
    state.blockApply(scope.vaultId, scope.epoch, change, 'duplicate retry');
    state.close();
    state = SyncStateStore.open(path);
    const page = state.listConflicts(scope);
    expect(page.conflicts).toHaveLength(1);
    expect(page.conflicts[0]).toMatchObject({
      conflictId: first.conflictId,
      hasApplyIntent: true,
      hasBlockedApply: true,
      local,
      type: 'content-divergence',
      copy: { id: reservation.conflictId, expectedHash: reservation.copyHash, publicationRecorded: false },
      diagnostics: ['Local revision changed', 'Copy publication is incomplete'],
    });
    expect(state.getConflictDetails(scope, first.conflictId)).toEqual(page.conflicts[0]);
    expect(JSON.stringify(page)).not.toContain('remote payload');
    expect(JSON.stringify(page)).not.toContain('staged copy payload');
  } finally {
    state.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('isolates vaults and epochs and paginates deterministically within a status filter', () => {
  const state = SyncStateStore.open(':memory:');
  try {
    state.reserveConflict(scope.vaultId, scope.epoch, change, reservation);
    state.markConflictPublished(reservation.conflictId);
    state.markApplyCommitted(scope.vaultId, scope.epoch, change);
    const second = { ...change, id: 'note-b' };
    const third = { ...change, id: 'note-c' };
    state.blockApply(scope.vaultId, 1, second, 'Stale');
    state.blockApply(scope.vaultId, 1, third, 'Missing');
    state.blockApply(scope.vaultId, 2, { ...change, epoch: 2 }, 'Other epoch');
    state.blockApply('vault-b', 1, change, 'Other vault');
    const page = state.listConflicts(scope, { limit: 1, status: 'needs-recovery' });
    expect(page.conflicts.map(({ document }) => document.id)).toEqual(['note-b']);
    expect(page.next).not.toBeNull();
    expect(state.listConflicts(scope, { limit: 1, after: page.next!, status: 'needs-recovery' })).toMatchObject({
      conflicts: [{ document: { id: 'note-c' } }], next: null,
    });
    expect(state.listConflicts(scope, { status: 'open' }).conflicts).toHaveLength(1);
    expect(state.listConflicts({ ...scope, epoch: 2 }).conflicts).toHaveLength(1);
    expect(state.listConflicts({ ...scope, vaultId: 'vault-b' }).conflicts).toHaveLength(1);
    expect(() => state.getConflictDetails({ ...scope, epoch: 2 }, page.next!)).toThrow('vault and epoch');
    expect(() => state.listConflicts({ ...scope, vaultId: 'vault-b' }, { after: page.next! })).toThrow('vault and epoch');
    expect(() => state.listConflicts(scope, { limit: 101 })).toThrow('page size');
  } finally {
    state.close();
  }
});

it('exposes legacy and inconsistent pointers while excluding ordinary apply intents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nodus-conflict-legacy-'));
  const path = join(root, 'sync.sqlite');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE apply_ledger (
      vaultId TEXT NOT NULL, epoch INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
      version INTEGER NOT NULL, contentHash TEXT NOT NULL, status TEXT NOT NULL, conflictId TEXT,
      conflictPath TEXT, updatedAt TEXT NOT NULL, PRIMARY KEY (vaultId, epoch, kind, id, version, contentHash)
    )`);
    legacy.prepare('INSERT INTO apply_ledger VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(scope.vaultId, scope.epoch, change.kind, change.id, change.version, change.contentHash,
        'committed', 'legacy-copy', 'notes/legacy.md', time);
    legacy.close();
    const state = SyncStateStore.open(path);
    try {
      const ordinary = { ...change, id: 'ordinary' };
      state.reserveApplyIntent(scope.vaultId, scope.epoch, {
        change: ordinary, base: null, source: local, target: local, createdAt: time,
      });
      const page = state.listConflicts(scope);
      expect(page.conflicts).toHaveLength(1);
      expect(page.conflicts[0]).toMatchObject({
        status: 'needs-recovery', createdAt: null, updatedAt: time, remote: { path: null },
        copy: { id: 'legacy-copy', expectedHash: null, publicationRecorded: null },
        diagnostics: expect.arrayContaining(['Legacy copy reference has no verified reservation']),
      });
      const inconsistent = { ...change, id: 'inconsistent' };
      state.reserveConflict(scope.vaultId, scope.epoch, inconsistent, reservation);
      state.beginApply(scope.vaultId, scope.epoch, inconsistent, {
        conflictId: 'different-copy', conflictPath: 'notes/different.md',
      });
      expect(state.listConflicts(scope).conflicts[0]).toMatchObject({
        status: 'needs-recovery', diagnostics: expect.arrayContaining(['Copy reservation and apply ledger references differ']),
      });
    } finally {
      state.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
