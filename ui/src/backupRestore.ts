import type { ImportReport, RestorePreview } from '../../src/ui-server/dto.js';
import { ApiError } from './api.js';

export type RestoreFailureKind =
  | 'conflict'
  | 'partial-write'
  | 'corrupt'
  | 'not-found'
  | 'forbidden'
  | 'other';

export interface RestoreFailure {
  kind: RestoreFailureKind;
  code: string;
  message: string;
  issues?: string[];
  paths?: string[];
}

export interface RestoreFlowState {
  phase: 'editing' | 'confirming' | 'restoring' | 'failed' | 'done';
  source: string;
  overwrite: boolean;
  failure: RestoreFailure | null;
  report: ImportReport | null;
}

export type RestoreFlowAction =
  | { type: 'edit-source'; source: string }
  | { type: 'request-confirm' }
  | { type: 'cancel' }
  | { type: 'set-overwrite'; value: boolean }
  | { type: 'start' }
  | { type: 'succeed'; report: ImportReport }
  | { type: 'fail'; error: unknown };

export const initialRestoreFlow: RestoreFlowState = {
  phase: 'editing',
  source: '',
  overwrite: false,
  failure: null,
  report: null,
};

export function classifyRestoreError(error: unknown): RestoreFailure {
  if (error instanceof ApiError) {
    const kind: RestoreFailureKind =
      error.code === 'CONFLICT'
        ? 'conflict'
        : error.code === 'PARTIAL_WRITE'
          ? 'partial-write'
          : error.code === 'CORRUPT_BACKUP' || error.code === 'UNSUPPORTED_VERSION'
            ? 'corrupt'
            : error.code === 'NOT_FOUND'
              ? 'not-found'
              : error.code === 'BACKUP_TARGET_NOT_ALLOWED'
                ? 'forbidden'
                : 'other';
    return {
      kind,
      code: error.code,
      message: error.message,
      issues: error.issues !== undefined && error.issues.length > 0 ? error.issues : undefined,
      paths: error.paths !== undefined && error.paths.length > 0 ? error.paths : undefined,
    };
  }
  return {
    kind: 'other',
    code: 'REQUEST_FAILED',
    message:
      error instanceof Error
        ? error.message
        : 'Something went wrong while talking to the local vault.',
  };
}

export function restoreFailureTitle(failure: RestoreFailure): string {
  switch (failure.kind) {
    case 'conflict':
      return 'Restore blocked by conflicting items';
    case 'partial-write':
      return 'Restore stopped partway — not fully applied';
    case 'corrupt':
      return 'Backup failed validation';
    case 'not-found':
      return 'Backup folder not found';
    case 'forbidden':
      return 'Folder not allowed';
    default:
      return 'Restore failed';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong while talking to the local vault.';
}

export function issuesOf(error: unknown): string[] | undefined {
  if (error instanceof ApiError && error.issues !== undefined && error.issues.length > 0) {
    return error.issues;
  }
  return undefined;
}

export function previewHasConflicts(preview: RestorePreview): boolean {
  return preview.conflicts.ids.length > 0 || preview.conflicts.paths.length > 0;
}

export function formatCounts(counts: { notes: number; databases: number }): string {
  const notes = `${counts.notes} ${counts.notes === 1 ? 'note' : 'notes'}`;
  const databases = `${counts.databases} ${counts.databases === 1 ? 'definition' : 'definitions'}`;
  return `${notes}, ${databases}`;
}

export function restoreFlowReducer(
  state: RestoreFlowState,
  action: RestoreFlowAction,
): RestoreFlowState {
  switch (action.type) {
    case 'edit-source':
      if (state.source === action.source && state.phase === 'editing') return state;
      return { ...initialRestoreFlow, source: action.source };
    case 'request-confirm':
      if (state.source.trim() === '') return state;
      if (state.phase !== 'editing' && state.phase !== 'failed') return state;
      return { ...state, phase: 'confirming', failure: null, report: null, overwrite: false };
    case 'cancel':
      if (state.phase === 'restoring') return state;
      if (state.phase === 'editing' && state.failure === null && state.report === null) {
        return state;
      }
      return { ...initialRestoreFlow, source: state.source };
    case 'set-overwrite':
      if (state.overwrite === action.value) return state;
      if (state.phase === 'restoring' || state.phase === 'done') return state;
      return { ...state, overwrite: action.value };
    case 'start':
      if (state.source.trim() === '') return state;
      if (state.phase === 'restoring') return state;
      if (state.failure?.kind === 'partial-write') return state;
      if (state.phase !== 'confirming' && state.phase !== 'failed') return state;
      return { ...state, phase: 'restoring', failure: null, report: null };
    case 'succeed':
      if (state.phase !== 'restoring') return state;
      return {
        ...state,
        phase: 'done',
        failure: null,
        report: action.report,
        overwrite: false,
      };
    case 'fail':
      if (state.phase !== 'restoring') return state;
      return {
        ...state,
        phase: 'failed',
        failure: classifyRestoreError(action.error),
        report: null,
      };
  }
}
