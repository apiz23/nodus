import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { serializeNote } from '../src/format/note-format.js';
import type { ChangeRecord } from '../src/sync/contracts.js';
import { SyncStateStore } from '../src/sync/state.js';
import type { ResolutionAction, ResolutionIntent, ResolutionSnapshot } from '../src/sync/resolution-decisions.js';

const scope = { vaultId: 'vault-a', epoch: 1 };
const originalId = '11111111-1111-4111-8111-111111111111';
const mergedId = '22222222-2222-4222-8222-222222222222';
const decisionId = '33333333-3333-4333-8333-333333333333';
const secondId = '44444444-4444-4444-8444-444444444444';
const now = '2026-11-11T00:00:00Z';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

function note(id: string, path: string, body: string): ResolutionSnapshot {
  const content = serializeNote(createNote({ id, path, title: 'Test', body, now }));
  return { id, path, contentHash: hash(content), content };
}
const local = note(originalId, 'notes/original.md', 'Local');
const remote = note(originalId, 'notes/original.md', 'Remote');

function fixture(state: SyncStateStore, action: ResolutionAction = 'keep-remote'): ResolutionIntent {
  const change: ChangeRecord = {
    kind: 'note', id: originalId, op: 'update', path: remote.path, content: remote.content,
    contentHash: remote.contentHash, baseVersion: 1, version: 2, vaultSeq: 10, epoch: 1, timestamp: now,
  };
  state.blockApply(scope.vaultId, scope.epoch, change, 'Local revision changed');
  state.reserveApplyIntent(scope.vaultId, scope.epoch, {
    change, base: null, source: { path: local.path, hash: local.contentHash },
    target: { path: remote.path, hash: remote.contentHash }, createdAt: now,
  });
  return {
    schemaVersion: 1, decisionId,
    conflictId: state.listConflicts(scope).conflicts[0]!.conflictId,
    document: { kind: 'note', id: originalId }, action, expectedBase: null,
    expectedLocal: local,
    expectedRemote: { version: 2, path: remote.path, contentHash: remote.contentHash, content: remote.content, operation: 'update' },
    expectedCopy: null,
    target: action === 'keep-local' ? local : action === 'keep-remote' ? remote : note(mergedId, 'notes/merged.md', 'Explicit merged payload'),
  };
}

it.each(['keep-local', 'keep-remote', 'save-merged-copy'] as const)(
  'persists an immutable %s intent across reopening and rejects duplicate IDs with different payloads', async (action) => {
    const root = await mkdtemp(join(tmpdir(), 'nodus-decision-'));
    const path = join(root, 'state.sqlite');
    let state = SyncStateStore.open(path);
    try {
      const intent = fixture(state, action);
      const prepared = state.prepareResolutionDecision(scope, intent);
      expect(prepared).toMatchObject({ status: 'prepared', revision: 0, result: null, completedAt: null, intent });
      state.close();
      state = SyncStateStore.open(path);
      expect(state.prepareResolutionDecision(scope, structuredClone(intent))).toEqual(prepared);
      expect(state.getResolutionDecision(scope, decisionId)).toEqual(prepared);
      expect(() => state.prepareResolutionDecision(scope, { ...intent, action: 'save-merged-copy',
        target: note(mergedId, 'notes/merged.md', 'Different') })).toThrow('different intent');
      const history = state.listResolutionHistory(scope, intent.conflictId);
      expect(history.decisions).toMatchObject([{ decisionId, action, status: 'prepared' }]);
      expect(JSON.stringify(history)).not.toContain('Explicit merged payload');
      expect(history.decisions[0]).not.toHaveProperty('intent');
      expect(() => state.listResolutionHistory({ ...scope, epoch: 2 }, intent.conflictId)).toThrow('vault and epoch');
    } finally {
      state.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it('serializes competing claims and retains completed history using journal revision checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nodus-decision-cas-'));
  const path = join(root, 'state.sqlite');
  const first = SyncStateStore.open(path);
  const second = SyncStateStore.open(path);
  try {
    const intent = fixture(first);
    first.prepareResolutionDecision(scope, intent);
    const claimed = first.transitionResolutionDecision(scope, decisionId, { expectedRevision: 0, status: 'applying' });
    expect(claimed.revision).toBe(1);
    expect(() => second.transitionResolutionDecision(scope, decisionId, { expectedRevision: 0, status: 'applying' }))
      .toThrow('revision changed');
    expect(() => second.prepareResolutionDecision(scope, { ...intent, decisionId: secondId })).toThrow('active or completed');
    const target = intent.target!;
    const result = { id: target.id, path: target.path, contentHash: target.contentHash, relayVersion: null };
    expect(() => first.transitionResolutionDecision(scope, decisionId, {
      expectedRevision: 1, status: 'completed', result: { ...result, contentHash: local.contentHash },
    })).toThrow('recorded target');
    const completed = first.transitionResolutionDecision(scope, decisionId, { expectedRevision: 1, status: 'completed', result });
    expect(completed).toMatchObject({ revision: 2, result, status: 'completed', completedAt: expect.any(String) });
    expect(second.transitionResolutionDecision(scope, decisionId, { expectedRevision: 0, status: 'completed', result })).toEqual(completed);
    expect(second.prepareResolutionDecision(scope, intent)).toEqual(completed);
    expect(() => second.transitionResolutionDecision(scope, decisionId, {
      expectedRevision: 2, status: 'needs-recovery', diagnostic: 'changed',
    })).toThrow('immutable');
    expect(first.listResolutionHistory(scope, intent.conflictId).decisions).toHaveLength(1);
  } finally {
    first.close();
    second.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('persists recovery diagnostics and permits a new intent only after stale rejection', () => {
  const state = SyncStateStore.open(':memory:');
  try {
    const intent = fixture(state);
    state.prepareResolutionDecision(scope, intent);
    expect(() => state.transitionResolutionDecision(scope, decisionId, { expectedRevision: 0, status: 'completed', result: null }))
      .toThrow('lifecycle');
    expect(() => state.transitionResolutionDecision(scope, decisionId, { expectedRevision: 0, status: 'needs-recovery' }))
      .toThrow('diagnostic');
    state.transitionResolutionDecision(scope, decisionId, { expectedRevision: 0, status: 'needs-recovery', diagnostic: 'Ambiguous target' });
    expect(() => state.prepareResolutionDecision(scope, { ...intent, decisionId: secondId })).toThrow('active or completed');
    state.transitionResolutionDecision(scope, decisionId, { expectedRevision: 1, status: 'rejected-stale', diagnostic: 'Source changed' });
    state.prepareResolutionDecision(scope, { ...intent, decisionId: secondId });
    const first = state.listResolutionHistory(scope, intent.conflictId, 1);
    expect(first.decisions).toHaveLength(1);
    expect(first.next).toBe(decisionId);
    expect(state.listResolutionHistory(scope, intent.conflictId, 1, first.next!)).toMatchObject({
      decisions: [{ decisionId: secondId }], next: null,
    });
  } finally {
    state.close();
  }
});

it('rejects unknown lineage, stale remote expectations, invalid snapshots and unsafe merged destinations', () => {
  const state = SyncStateStore.open(':memory:');
  try {
    const intent = fixture(state);
    expect(() => state.prepareResolutionDecision({ ...scope, epoch: 2 }, intent)).toThrow('vault and epoch');
    expect(() => state.prepareResolutionDecision(scope, {
      ...intent, expectedRemote: { ...intent.expectedRemote, version: 3 },
    })).toThrow('recorded conflict');
    expect(() => state.prepareResolutionDecision(scope, {
      ...intent, expectedLocal: { ...local, content: 'changed bytes' },
    })).toThrow('content hash');
    expect(() => state.prepareResolutionDecision(scope, {
      ...intent, action: 'save-merged-copy', target: local,
    })).toThrow('new document identity');
    expect(state.getResolutionDecision(scope, decisionId)).toBeNull();
  } finally {
    state.close();
  }
});

it('requires a verified reservation snapshot and rejects tombstone keep-local', () => {
  const state = SyncStateStore.open(':memory:');
  try {
    const intent = fixture(state);
    const key = { kind: 'note' as const, id: originalId, version: 2, contentHash: remote.contentHash };
    const copy = note(mergedId, 'notes/copy.md', 'Preserved');
    state.reserveConflict(scope.vaultId, scope.epoch, key, {
      conflictId: copy.id, conflictPath: copy.path, localPath: local.path, localHash: local.contentHash,
      copyHash: copy.contentHash, copyText: copy.content,
    });
    expect(() => state.prepareResolutionDecision(scope, { ...intent, expectedCopy: copy })).toThrow('requires verification');
    state.markConflictPublished(copy.id);
    expect(() => state.prepareResolutionDecision(scope, intent)).toThrow('requires verification');
    expect(() => state.prepareResolutionDecision(scope, {
      ...intent, action: 'keep-local', target: local,
      expectedRemote: { version: 2, path: remote.path, operation: 'delete', content: null, contentHash: hash('') },
    })).toThrow('restore semantics');
  } finally {
    state.close();
  }
});

it('records deletion intent without a result document and scopes all reads and transitions', () => {
  const state = SyncStateStore.open(':memory:');
  try {
    const original = fixture(state);
    const deleted: ChangeRecord = {
      kind: 'note', id: originalId, op: 'delete', path: remote.path, baseVersion: 2, version: 3,
      vaultSeq: 11, epoch: 1, timestamp: now, contentHash: hash(''),
    };
    state.blockApply(scope.vaultId, scope.epoch, deleted, 'Deletion awaits review');
    const conflict = state.listConflicts(scope).conflicts.find((value) => value.remote.version === 3)!;
    const intent: ResolutionIntent = {
      ...original, conflictId: conflict.conflictId, target: null,
      expectedRemote: { version: 3, path: remote.path, operation: 'delete', contentHash: hash(''), content: null },
    };
    state.prepareResolutionDecision(scope, intent);
    expect(state.getResolutionDecision({ ...scope, epoch: 2 }, decisionId)).toBeNull();
    expect(() => state.transitionResolutionDecision({ ...scope, vaultId: 'other' }, decisionId, {
      expectedRevision: 0, status: 'applying',
    })).toThrow('unavailable');
    state.transitionResolutionDecision(scope, decisionId, { expectedRevision: 0, status: 'applying' });
    const completed = state.transitionResolutionDecision(scope, decisionId, {
      expectedRevision: 1, status: 'completed', result: null,
    });
    expect(completed.result).toBeNull();
    expect(completed.completedAt).not.toBeNull();
    // Journal completion alone leaves the blocked apply and global cursor untouched.
    expect(state.getBlockedApply(scope.vaultId, scope.epoch, deleted)).toBe('Deletion awaits review');
    expect(state.getMeta('cursor')).toBeUndefined();
  } finally {
    state.close();
  }
});

it('adds the journal to an older state database without changing its ledger or outbox', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nodus-decision-migration-'));
  const path = join(root, 'state.sqlite');
  let state = SyncStateStore.open(path);
  try {
    fixture(state);
    state.enqueue(decisionId, []);
    state.close();
    const old = new DatabaseSync(path);
    old.exec('DROP TABLE resolution_decisions_v1');
    const before = old.prepare('SELECT * FROM apply_ledger').all();
    old.close();
    state = SyncStateStore.open(path);
    expect(state.pendingOperations()).toHaveLength(1);
    expect(state.listConflicts(scope).conflicts).toHaveLength(1);
    state.close();
    const migrated = new DatabaseSync(path);
    expect(migrated.prepare('SELECT * FROM apply_ledger').all()).toEqual(before);
    expect(migrated.prepare('SELECT * FROM resolution_decisions_v1').all()).toEqual([]);
    migrated.close();
    state = SyncStateStore.open(path);
  } finally {
    state.close();
    await rm(root, { recursive: true, force: true });
  }
});
