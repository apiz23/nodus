import { describe, expect, it } from 'vitest';
import { ApiError } from '../ui/src/api.js';
import {
  classifyRestoreError,
  formatCounts,
  initialRestoreFlow,
  issuesOf,
  previewHasConflicts,
  restoreFailureTitle,
  restoreFlowReducer,
} from '../ui/src/backupRestore.js';
import type { RestoreFlowState } from '../ui/src/backupRestore.js';

function withSource(source: string): RestoreFlowState {
  return { ...initialRestoreFlow, source };
}

function confirming(source = '/backups/one'): RestoreFlowState {
  return restoreFlowReducer(withSource(source), { type: 'request-confirm' });
}

function restoring(): RestoreFlowState {
  return restoreFlowReducer(confirming(), { type: 'start' });
}

describe('restore confirmation flow', () => {
  it('requires a non-empty source before confirmation', () => {
    expect(restoreFlowReducer(initialRestoreFlow, { type: 'request-confirm' })).toBe(
      initialRestoreFlow,
    );
    const next = confirming();
    expect(next.phase).toBe('confirming');
    expect(next.overwrite).toBe(false);
  });

  it('only starts from confirming or failed, and ignores duplicate submissions', () => {
    const editing = withSource('/backups/one');
    expect(restoreFlowReducer(editing, { type: 'start' })).toBe(editing);

    const pending = restoring();
    expect(pending.phase).toBe('restoring');
    expect(restoreFlowReducer(pending, { type: 'start' })).toBe(pending);
    expect(restoreFlowReducer(pending, { type: 'request-confirm' })).toBe(pending);
    expect(restoreFlowReducer(pending, { type: 'set-overwrite', value: true })).toBe(pending);
  });

  it('keeps overwrite off after a conflict until the user enables it', () => {
    const conflict = new ApiError(409, 'CONFLICT', 'Conflicting notes exist in the vault.');
    const failed = restoreFlowReducer(restoring(), { type: 'fail', error: conflict });
    expect(failed.phase).toBe('failed');
    expect(failed.failure?.kind).toBe('conflict');
    expect(failed.failure?.message).toBe('Conflicting notes exist in the vault.');
    expect(failed.overwrite).toBe(false);

    const enabled = restoreFlowReducer(failed, { type: 'set-overwrite', value: true });
    expect(enabled.overwrite).toBe(true);

    const retry = restoreFlowReducer(enabled, { type: 'start' });
    expect(retry.phase).toBe('restoring');
    expect(retry.overwrite).toBe(true);

    const done = restoreFlowReducer(retry, {
      type: 'succeed',
      report: { notes: 2, databases: 1, databaseViews: 0 },
    });
    expect(done.phase).toBe('done');
    expect(done.overwrite).toBe(false);
    expect(done.report).toEqual({ notes: 2, databases: 1, databaseViews: 0 });
  });

  it('re-confirmation starts a fresh cycle with overwrite reset', () => {
    const failedWithConflict = restoreFlowReducer(restoring(), {
      type: 'fail',
      error: new ApiError(409, 'CONFLICT', 'Conflict.'),
    });
    const enabled = restoreFlowReducer(failedWithConflict, { type: 'set-overwrite', value: true });
    const reviewedAgain = restoreFlowReducer(enabled, { type: 'request-confirm' });
    expect(reviewedAgain.phase).toBe('confirming');
    expect(reviewedAgain.overwrite).toBe(false);
    expect(reviewedAgain.failure).toBeNull();
  });

  it('editing the source discards stale confirmation, failures, and overwrite', () => {
    const failed = restoreFlowReducer(restoring(), {
      type: 'fail',
      error: new ApiError(409, 'CONFLICT', 'Conflict.'),
    });
    const edited = restoreFlowReducer(failed, { type: 'edit-source', source: '/backups/two' });
    expect(edited).toEqual({ ...initialRestoreFlow, source: '/backups/two' });
  });

  it('cancel returns to editing, keeps the source, and is ignored mid-restore', () => {
    const cancelled = restoreFlowReducer(confirming(), { type: 'cancel' });
    expect(cancelled.phase).toBe('editing');
    expect(cancelled.source).toBe('/backups/one');
    expect(cancelled.overwrite).toBe(false);
    expect(cancelled.failure).toBeNull();

    const pending = restoring();
    expect(restoreFlowReducer(pending, { type: 'cancel' })).toBe(pending);
  });

  it('ignores stray succeed or fail events outside a run', () => {
    const pending = confirming();
    expect(
      restoreFlowReducer(pending, { type: 'succeed', report: { notes: 0, databases: 0, databaseViews: 0 } }),
    ).toBe(pending);
    const editing = withSource('/backups/one');
    expect(restoreFlowReducer(editing, { type: 'fail', error: new Error('x') })).toBe(editing);
  });
});

describe('restore failure classification', () => {
  it('classifies PARTIAL_WRITE and keeps the affected paths', () => {
    const failure = classifyRestoreError(
      new ApiError(
        500,
        'PARTIAL_WRITE',
        'The restore stopped before every file was written.',
        undefined,
        undefined,
        ['notes/a.md'],
      ),
    );
    expect(failure.kind).toBe('partial-write');
    expect(failure.code).toBe('PARTIAL_WRITE');
    expect(failure.paths).toEqual(['notes/a.md']);
    expect(restoreFailureTitle(failure)).toContain('not fully applied');
  });

  it('blocks immediate retry after a partial restore', () => {
    const partial = restoreFlowReducer(restoring(), {
      type: 'fail',
      error: new ApiError(500, 'PARTIAL_WRITE', 'Inspect affected vault paths.', undefined, undefined, ['notes/a.md']),
    });

    expect(partial.phase).toBe('failed');
    expect(restoreFlowReducer(partial, { type: 'start' })).toBe(partial);
    expect(restoreFlowReducer(partial, { type: 'cancel' }).phase).toBe('editing');
  });

  it('classifies CORRUPT_BACKUP and keeps validation issues', () => {
    const failure = classifyRestoreError(
      new ApiError(422, 'CORRUPT_BACKUP', 'The backup is corrupt.', undefined, ['bad digest']),
    );
    expect(failure.kind).toBe('corrupt');
    expect(failure.issues).toEqual(['bad digest']);
  });

  it('classifies not-found, forbidden, conflict, and generic codes', () => {
    expect(classifyRestoreError(new ApiError(404, 'NOT_FOUND', 'x')).kind).toBe('not-found');
    expect(classifyRestoreError(new ApiError(403, 'BACKUP_TARGET_NOT_ALLOWED', 'x')).kind).toBe(
      'forbidden',
    );
    expect(classifyRestoreError(new ApiError(409, 'CONFLICT', 'x')).kind).toBe('conflict');
    expect(classifyRestoreError(new ApiError(500, 'INTERNAL_ERROR', 'x')).kind).toBe('other');
    expect(restoreFailureTitle({ kind: 'conflict', code: 'CONFLICT', message: 'x' })).toBe(
      'Restore blocked by conflicting items',
    );
  });

  it('falls back safely for non-API errors', () => {
    const fromError = classifyRestoreError(new Error('plain failure'));
    expect(fromError.kind).toBe('other');
    expect(fromError.message).toBe('plain failure');

    const fromValue = classifyRestoreError('boom');
    expect(fromValue.kind).toBe('other');
    expect(fromValue.code).toBe('REQUEST_FAILED');
    expect(fromValue.message).toBe('Something went wrong while talking to the local vault.');
  });

  it('exposes validation issues for display', () => {
    expect(issuesOf(new ApiError(422, 'CORRUPT_BACKUP', 'x', undefined, ['issue-1']))).toEqual([
      'issue-1',
    ]);
    expect(issuesOf(new ApiError(409, 'CONFLICT', 'x'))).toBeUndefined();
    expect(issuesOf(new Error('x'))).toBeUndefined();
  });
});

describe('preview conflict detection', () => {
  const base = {
    manifest: {
      format: 'nodus-backup' as const,
      version: 1 as const,
      createdAt: '2026-10-27T08:00:00Z',
      files: [],
    },
    counts: { notes: 1, databases: 0, databaseViews: 0 },
  };

  it('reports a clean preview when no ids or paths conflict', () => {
    expect(
      previewHasConflicts({ ...base, conflicts: { ids: [], paths: [] } }),
    ).toBe(false);
  });

  it('reports conflicts for id-only, path-only, and combined cases', () => {
    expect(previewHasConflicts({ ...base, conflicts: { ids: ['n1'], paths: [] } })).toBe(true);
    expect(
      previewHasConflicts({ ...base, conflicts: { ids: [], paths: ['notes/a.md'] } }),
    ).toBe(true);
    expect(
      previewHasConflicts({ ...base, conflicts: { ids: ['n1'], paths: ['notes/a.md'] } }),
    ).toBe(true);
  });
});

describe('count formatting', () => {
  it('pluralizes notes and definitions', () => {
    expect(formatCounts({ notes: 1, databases: 0 })).toBe('1 note, 0 definitions');
    expect(formatCounts({ notes: 2, databases: 1 })).toBe('2 notes, 1 definition');
  });
});
