import { randomBytes } from 'node:crypto';
import { StorageError } from '../errors.js';

export interface ImportPreviewConflictBinding {
  kind: string;
  id: string;
  path: string;
  sourceSha256: string;
  destinationSha256?: string;
  safeChoices: Array<'add' | 'skip' | 'replace'>;
}

export interface ImportPreviewResourceBinding extends ImportPreviewConflictBinding {
  status: 'new' | 'identical' | 'conflict' | 'invalid';
}

/** Server-only state bound to a read-only preview; never contains resource bytes. */
export interface ImportPreviewBinding {
  sourcePath: string;
  destinationPath: string;
  sourceFingerprint: string;
  destinationFingerprint: string;
  /** All resources, including non-conflicting resources, bound to the preview. */
  resourceBindings?: ImportPreviewResourceBinding[];
  conflicts: ImportPreviewConflictBinding[];
}

export interface ImportPreviewSession {
  previewId: string;
  expiresAt: string;
  binding: ImportPreviewBinding;
}

export interface ImportConflictDecision {
  kind: string;
  id: string;
  path: string;
  choice: 'add' | 'skip' | 'replace';
}

interface SessionRecord extends ImportPreviewSession { expiresAtMs: number }

/**
 * Process-local, bounded, short-lived preview contracts. A restart invalidates
 * all handles, which is fail-closed and requires the user to preview again.
 */
export class ImportPreviewSessionStore {
  private readonly records = new Map<string, SessionRecord>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.maxEntries = options.maxEntries ?? 64;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1 || !Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) throw new TypeError('Preview session limits must be positive safe integers.');
  }

  issue(binding: ImportPreviewBinding): ImportPreviewSession {
    const now = this.now();
    this.prune(now);
    while (this.records.size >= this.maxEntries) this.records.delete(this.records.keys().next().value as string);
    const previewId = randomBytes(32).toString('base64url');
    const expiresAtMs = now + this.ttlMs;
    const session: SessionRecord = { previewId, expiresAt: new Date(expiresAtMs).toISOString(), expiresAtMs, binding: cloneBinding(binding) };
    this.records.set(previewId, session);
    return { previewId, expiresAt: session.expiresAt, binding: cloneBinding(session.binding) };
  }

  read(previewId: string): ImportPreviewSession {
    return this.get(previewId, false);
  }

  /** Future execution must consume the handle before applying any decisions. */
  consume(previewId: string): ImportPreviewSession {
    return this.get(previewId, true);
  }

  private get(previewId: string, consume: boolean): ImportPreviewSession {
    if (!/^[A-Za-z0-9_-]{43}$/.test(previewId)) throw stale();
    const record = this.records.get(previewId);
    if (!record) throw stale();
    if (record.expiresAtMs <= this.now()) {
      this.records.delete(previewId);
      throw new StorageError('PREVIEW_EXPIRED', 'This import preview expired. Create a new preview before continuing.');
    }
    if (consume) this.records.delete(previewId);
    else {
      this.records.delete(previewId);
      this.records.set(previewId, record);
    }
    return { previewId: record.previewId, expiresAt: record.expiresAt, binding: cloneBinding(record.binding) };
  }

  private prune(now: number): void {
    for (const [id, record] of this.records) if (record.expiresAtMs <= now) this.records.delete(id);
  }
}

/** Validates future caller choices against the exact previewed conflict set. */
export function validateImportConflictDecisions(binding: ImportPreviewBinding, decisions: ImportConflictDecision[]): void {
  const expected = new Map(binding.conflicts.map((conflict) => [conflictKey(conflict), conflict]));
  const seen = new Set<string>();
  for (const decision of decisions) {
    const key = conflictKey(decision);
    const conflict = expected.get(key);
    if (!conflict || seen.has(key)) throw new StorageError('INVALID_INPUT', 'Conflict decisions do not match the current preview. Create a new preview and review its conflicts.');
    seen.add(key);
    if (!conflict.safeChoices.includes(decision.choice)) throw new StorageError('INVALID_INPUT', `The ${decision.choice} choice is not safe for ${decision.kind} ${decision.id} at ${decision.path}.`);
    if (decision.choice === 'replace' && (!conflict.destinationSha256 || conflict.path !== decision.path)) throw new StorageError('INVALID_INPUT', 'Replace is allowed only for the same resource identity at the same path.');
  }
  if (seen.size !== expected.size) throw new StorageError('INVALID_INPUT', 'Every preview conflict requires an explicit skip or replace decision.');
}

/** Requires one explicit, preview-bound action for every incoming resource. */
export function validateImportResourceDecisions(binding: ImportPreviewBinding, decisions: ImportConflictDecision[]): void {
  const resources = binding.resourceBindings;
  if (!resources) throw new StorageError('INVALID_INPUT', 'This preview does not contain executable resource bindings. Create a new preview.');
  const expected = new Map(resources.map((resource) => [conflictKey(resource), resource]));
  const seen = new Set<string>();
  for (const decision of decisions) {
    const key = conflictKey(decision);
    const resource = expected.get(key);
    if (!resource || seen.has(key)) throw new StorageError('INVALID_INPUT', 'Import decisions do not match the preview resources. Create a new preview and review each resource.');
    seen.add(key);
    if (!resource.safeChoices.includes(decision.choice)) throw new StorageError('INVALID_INPUT', `The ${decision.choice} choice is not permitted for ${decision.kind} ${decision.id} at ${decision.path}.`);
    if (decision.choice === 'replace' && (resource.status !== 'conflict' || !resource.destinationSha256 || resource.kind !== decision.kind || resource.id !== decision.id || resource.path !== decision.path)) {
      throw new StorageError('INVALID_INPUT', 'Replace requires the previewed resource kind, ID, path, and destination revision to match.');
    }
    if (decision.choice === 'add' && resource.status !== 'new') throw new StorageError('INVALID_INPUT', 'Only a new resource can be added.');
  }
  if (seen.size !== expected.size) throw new StorageError('INVALID_INPUT', 'Choose add or skip for every new resource and skip or replace for every conflict.');
}

function conflictKey(value: { kind: string; id: string; path: string }): string { return JSON.stringify([value.kind, value.id, value.path]); }
function cloneBinding(binding: ImportPreviewBinding): ImportPreviewBinding {
  return { ...binding, ...(binding.resourceBindings === undefined ? {} : { resourceBindings: binding.resourceBindings.map((resource) => ({ ...resource, safeChoices: [...resource.safeChoices] })) }), conflicts: binding.conflicts.map((conflict) => ({ ...conflict, safeChoices: [...conflict.safeChoices] })) };
}

export function parseImportResourceDecisions(value: unknown): ImportConflictDecision[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new StorageError('INVALID_INPUT', 'Import decisions must be an array with at most 10,000 resources.');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new StorageError('INVALID_INPUT', `Import decision ${index + 1} is invalid.`);
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.kind !== 'string' || candidate.kind.length > 80 || typeof candidate.id !== 'string' || candidate.id.length > 200 || typeof candidate.path !== 'string' || candidate.path.length > 1_000 || !['add', 'skip', 'replace'].includes(String(candidate.choice))) {
      throw new StorageError('INVALID_INPUT', `Import decision ${index + 1} is invalid.`);
    }
    return { kind: candidate.kind, id: candidate.id, path: candidate.path, choice: candidate.choice as ImportConflictDecision['choice'] };
  });
}
function stale(): StorageError { return new StorageError('STALE_PREVIEW', 'This import preview is unavailable. Create a new preview before continuing.'); }
