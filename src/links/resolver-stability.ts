import { isUuidV4 } from '../domain/ids.js';
import {
  createLinkResolver,
  isExternalTarget,
  parseWikiLinks,
  type LinkResolution,
  type WikiLink,
} from './wikilink.js';

export interface ResolverSnapshotNote {
  readonly id: string;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly path: string;
  readonly body: string;
  /** SHA-256 of the complete raw note content, supplied by the snapshot owner. */
  readonly sourceRawContentHash: string;
}

export interface ResolverSnapshot {
  /** Must be true only when the storage owner completed the whole vault inventory without issues. */
  readonly complete: boolean;
  readonly notes: readonly ResolverSnapshotNote[];
}

export interface OccurrenceIdentity {
  readonly sourceNoteId: string;
  readonly sourceRawContentHash: string;
  /** JavaScript UTF-16 string offset, as returned by parseWikiLinks. */
  readonly startOffset: number;
  readonly endOffset: number;
  readonly rawToken: string;
}

export type ProjectedResolution = LinkResolution | { readonly status: 'external' };

export interface ProjectedOccurrence {
  readonly identity: OccurrenceIdentity;
  readonly target: string;
  readonly resolution: ProjectedResolution;
}

export type ResolverStabilityIssueCode =
  | 'INVALID_COPY_ID'
  | 'INCOMPLETE_SNAPSHOT'
  | 'INVALID_SNAPSHOT'
  | 'DUPLICATE_NOTE_ID'
  | 'MISSING_EXISTING_NOTE'
  | 'UNEXPECTED_NOTE'
  | 'SOURCE_HASH_CHANGED'
  | 'PARSER_FAILURE'
  | 'RESOLVER_FAILURE'
  | 'INVALID_OCCURRENCE'
  | 'OVERLAPPING_OCCURRENCES'
  | 'DUPLICATE_OCCURRENCE'
  | 'MISSING_OCCURRENCE'
  | 'ADDED_EXISTING_OCCURRENCE'
  | 'RESOLUTION_CHANGED';

export interface ResolverStabilityIssue {
  readonly code: ResolverStabilityIssueCode;
  readonly message: string;
  readonly sourceNoteId?: string;
  readonly occurrence?: OccurrenceIdentity;
}

export interface ResolverStabilityResult {
  readonly stable: boolean;
  readonly issues: readonly ResolverStabilityIssue[];
  readonly before: readonly ProjectedOccurrence[];
  readonly afterExisting: readonly ProjectedOccurrence[];
  /** Kept separate from the comparison of pre-existing vault occurrences. */
  readonly copiedNoteOutgoing: readonly ProjectedOccurrence[];
}

/**
 * Test seam for deterministic fault injection. Production callers must omit
 * this argument so the projection always uses the production parser/resolver.
 */
export interface ResolverStabilityTestEngine {
  readonly parse: typeof parseWikiLinks;
  readonly createResolver: typeof createLinkResolver;
}

const PRODUCTION_ENGINE: ResolverStabilityTestEngine = {
  parse: parseWikiLinks,
  createResolver: createLinkResolver,
};

/**
 * Projects all parser-recognized wiki-link occurrences from two complete
 * snapshots and compares every old occurrence against the proposed-copy
 * snapshot. This function builds fresh resolvers; it never uses LinkIndex or
 * its cache. It performs no storage or filesystem work.
 */
export function compareResolverStability(
  beforeSnapshot: ResolverSnapshot,
  afterSnapshot: ResolverSnapshot,
  copiedNoteId: string,
  engine: ResolverStabilityTestEngine = PRODUCTION_ENGINE,
): ResolverStabilityResult {
  const issues: ResolverStabilityIssue[] = [];
  if (!isUuidV4(copiedNoteId)) {
    issues.push({ code: 'INVALID_COPY_ID', message: 'The proposed copied note must have a lowercase UUID v4 identity.' });
  }

  const beforeNotes = validateSnapshot(beforeSnapshot, 'before', issues);
  const afterNotes = validateSnapshot(afterSnapshot, 'after', issues);
  if (beforeNotes === undefined || afterNotes === undefined || issues.length > 0) {
    return result(issues, [], [], []);
  }

  const beforeById = new Map(beforeNotes.map((note) => [note.id, note]));
  const afterById = new Map(afterNotes.map((note) => [note.id, note]));
  if (beforeById.has(copiedNoteId)) {
    issues.push({ code: 'INVALID_COPY_ID', message: 'The proposed copy identity already exists in the before snapshot.' });
  }
  for (const note of beforeNotes) {
    const after = afterById.get(note.id);
    if (after === undefined) {
      issues.push({ code: 'MISSING_EXISTING_NOTE', message: `Existing note ${note.id} is missing from the after snapshot.`, sourceNoteId: note.id });
    } else if (after.sourceRawContentHash !== note.sourceRawContentHash) {
      issues.push({ code: 'SOURCE_HASH_CHANGED', message: `Existing note ${note.id} changed raw content between snapshots.`, sourceNoteId: note.id });
    }
  }
  for (const note of afterNotes) {
    if (!beforeById.has(note.id) && note.id !== copiedNoteId) {
      issues.push({ code: 'UNEXPECTED_NOTE', message: `After snapshot contains unexpected note ${note.id}.`, sourceNoteId: note.id });
    }
  }
  if (!afterById.has(copiedNoteId)) {
    issues.push({ code: 'UNEXPECTED_NOTE', message: 'The after snapshot does not contain the proposed copied note.', sourceNoteId: copiedNoteId });
  }
  if (issues.length > 0) return result(issues, [], [], []);

  const beforeProjection = projectSnapshot(beforeNotes, engine, issues);
  const afterProjection = projectSnapshot(afterNotes, engine, issues);
  const afterExisting = (afterProjection ?? []).filter((item) => item.identity.sourceNoteId !== copiedNoteId);
  const copiedNoteOutgoing = (afterProjection ?? []).filter((item) => item.identity.sourceNoteId === copiedNoteId);
  if (beforeProjection === undefined || afterProjection === undefined || issues.length > 0) {
    return result(issues, beforeProjection ?? [], afterExisting, copiedNoteOutgoing);
  }
  compareOccurrences(beforeProjection, afterExisting, issues);

  return result(issues, beforeProjection, afterExisting, copiedNoteOutgoing);
}

function validateSnapshot(
  snapshot: ResolverSnapshot,
  label: string,
  issues: ResolverStabilityIssue[],
): ResolverSnapshotNote[] | undefined {
  if (!isRecord(snapshot) || snapshot.complete !== true || !Array.isArray(snapshot.notes)) {
    issues.push({ code: 'INCOMPLETE_SNAPSHOT', message: `${label} resolver snapshot is incomplete.` });
    return undefined;
  }

  const notes: ResolverSnapshotNote[] = [];
  const ids = new Set<string>();
  for (const value of snapshot.notes as unknown[]) {
    if (!isRecord(value)
      || typeof value.id !== 'string' || !isUuidV4(value.id)
      || typeof value.title !== 'string'
      || typeof value.path !== 'string'
      || typeof value.body !== 'string'
      || !isStringArray(value.aliases)
      || typeof value.sourceRawContentHash !== 'string'
      || !/^[0-9a-f]{64}$/.test(value.sourceRawContentHash)) {
      issues.push({ code: 'INVALID_SNAPSHOT', message: `${label} resolver snapshot contains an invalid note record.` });
      return undefined;
    }
    if (ids.has(value.id)) {
      issues.push({ code: 'DUPLICATE_NOTE_ID', message: `${label} resolver snapshot contains duplicate note ID ${value.id}.`, sourceNoteId: value.id });
      return undefined;
    }
    ids.add(value.id);
    notes.push(Object.freeze({
      id: value.id,
      title: value.title,
      path: value.path,
      body: value.body,
      aliases: Object.freeze([...value.aliases]),
      sourceRawContentHash: value.sourceRawContentHash,
    }));
  }
  return notes.sort((left, right) => compareText(left.id, right.id));
}

function projectSnapshot(
  notes: readonly ResolverSnapshotNote[],
  engine: ResolverStabilityTestEngine,
  issues: ResolverStabilityIssue[],
): ProjectedOccurrence[] | undefined {
  let resolve: (target: string) => LinkResolution;
  try {
    resolve = engine.createResolver(notes.map((note) => ({
      id: note.id,
      title: note.title,
      path: note.path,
      aliases: [...note.aliases],
    })));
  } catch (error) {
    issues.push({ code: 'RESOLVER_FAILURE', message: errorMessage(error, 'Resolver could not be constructed.') });
    return undefined;
  }

  const projected: ProjectedOccurrence[] = [];
  const identities = new Set<string>();
  for (const note of notes) {
    let links: WikiLink[];
    try {
      const parsed: unknown = engine.parse(note.body);
      if (!Array.isArray(parsed)) throw new Error('Parser did not return an occurrence array.');
      links = parsed as WikiLink[];
    } catch (error) {
      issues.push({ code: 'PARSER_FAILURE', message: errorMessage(error, 'Wiki-link parser failed.'), sourceNoteId: note.id });
      return undefined;
    }

    const ordered = [...links].sort((left, right) => {
      const startOrder = compareNumber(left?.start, right?.start);
      return startOrder || compareNumber(left?.end, right?.end) || compareText(left?.raw, right?.raw);
    });
    let previous: WikiLink | undefined;
    for (const link of ordered) {
      if (!isValidOccurrence(link, note.body)) {
        issues.push({ code: 'INVALID_OCCURRENCE', message: `Parser returned an invalid wiki-link occurrence for note ${note.id}.`, sourceNoteId: note.id });
        return undefined;
      }
      const identity: OccurrenceIdentity = Object.freeze({
        sourceNoteId: note.id,
        sourceRawContentHash: note.sourceRawContentHash,
        startOffset: link.start,
        endOffset: link.end,
        rawToken: link.raw,
      });
      const key = occurrenceKey(identity);
      if (identities.has(key)) {
        issues.push({ code: 'DUPLICATE_OCCURRENCE', message: `Duplicate occurrence identity in note ${note.id}.`, sourceNoteId: note.id, occurrence: identity });
        return undefined;
      }
      identities.add(key);
      if (previous !== undefined && link.start < previous.end) {
        issues.push({ code: 'OVERLAPPING_OCCURRENCES', message: `Wiki-link occurrences overlap in note ${note.id}.`, sourceNoteId: note.id });
        return undefined;
      }

      let resolution: ProjectedResolution;
      try {
        resolution = isExternalTarget(link.target) ? { status: 'external' } : normalizeResolution(resolve(link.target), notes);
      } catch (error) {
        issues.push({ code: 'RESOLVER_FAILURE', message: errorMessage(error, 'Wiki-link resolution failed.'), sourceNoteId: note.id, occurrence: identity });
        return undefined;
      }
      projected.push(Object.freeze({ identity, target: link.target, resolution }));
      previous = link;
    }
  }
  return projected.sort(compareOccurrencesByIdentity);
}

function normalizeResolution(value: unknown, notes: readonly ResolverSnapshotNote[]): ProjectedResolution {
  if (!isRecord(value)) throw new Error('Resolver returned a malformed result.');
  if (value.status === 'unresolved') return Object.freeze({ status: 'unresolved' });
  if (value.status === 'resolved' && typeof value.noteId === 'string' && notes.some((note) => note.id === value.noteId)) {
    return Object.freeze({ status: 'resolved', noteId: value.noteId });
  }
  if (value.status === 'ambiguous' && isStringArray(value.noteIds) && value.noteIds.length > 1) {
    const candidates = [...value.noteIds].sort(compareText);
    if (new Set(candidates).size !== candidates.length || candidates.some((id) => !notes.some((note) => note.id === id))) {
      throw new Error('Resolver returned invalid ambiguous candidate identities.');
    }
    return Object.freeze({ status: 'ambiguous', noteIds: Object.freeze(candidates) as unknown as string[] });
  }
  throw new Error('Resolver returned an invalid or incomplete resolution result.');
}

function compareOccurrences(
  before: readonly ProjectedOccurrence[],
  after: readonly ProjectedOccurrence[],
  issues: ResolverStabilityIssue[],
): void {
  const afterByKey = new Map<string, ProjectedOccurrence[]>();
  for (const item of after) {
    const key = occurrenceKey(item.identity);
    const matches = afterByKey.get(key) ?? [];
    matches.push(item);
    afterByKey.set(key, matches);
  }

  const beforeKeys = new Set<string>();
  for (const old of before) {
    const key = occurrenceKey(old.identity);
    beforeKeys.add(key);
    const matches = afterByKey.get(key) ?? [];
    if (matches.length === 0) {
      issues.push({ code: 'MISSING_OCCURRENCE', message: 'An existing wiki-link occurrence is missing after the proposed copy.', sourceNoteId: old.identity.sourceNoteId, occurrence: old.identity });
      continue;
    }
    if (matches.length !== 1) {
      issues.push({ code: 'DUPLICATE_OCCURRENCE', message: 'An existing wiki-link occurrence maps more than once after the proposed copy.', sourceNoteId: old.identity.sourceNoteId, occurrence: old.identity });
      continue;
    }
    const current = matches[0]!;
    if (resolutionKey(old.resolution) !== resolutionKey(current.resolution)) {
      issues.push({ code: 'RESOLUTION_CHANGED', message: 'An existing wiki-link resolution changed after the proposed copy.', sourceNoteId: old.identity.sourceNoteId, occurrence: old.identity });
    }
  }
  for (const current of after) {
    if (!beforeKeys.has(occurrenceKey(current.identity))) {
      issues.push({ code: 'ADDED_EXISTING_OCCURRENCE', message: 'The after snapshot contains a new or altered occurrence in an existing note.', sourceNoteId: current.identity.sourceNoteId, occurrence: current.identity });
    }
  }
}

function isValidOccurrence(value: unknown, body: string): value is WikiLink {
  if (!isRecord(value)
    || typeof value.raw !== 'string' || value.raw.length === 0
    || typeof value.target !== 'string' || value.target.length === 0
    || typeof value.start !== 'number' || typeof value.end !== 'number'
    || !Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end)
    || value.start < 0 || value.end <= value.start || value.end > body.length
    || body.slice(value.start, value.end) !== value.raw) return false;
  return value.display === undefined || typeof value.display === 'string';
}

function resolutionKey(resolution: ProjectedResolution): string {
  return resolution.status === 'resolved'
    ? JSON.stringify(['resolved', resolution.noteId])
    : resolution.status === 'ambiguous'
      ? JSON.stringify(['ambiguous', [...resolution.noteIds].sort(compareText)])
      : JSON.stringify([resolution.status]);
}

function occurrenceKey(identity: OccurrenceIdentity): string {
  return JSON.stringify([
    identity.sourceNoteId,
    identity.sourceRawContentHash,
    identity.startOffset,
    identity.endOffset,
    identity.rawToken,
  ]);
}

function compareOccurrencesByIdentity(left: ProjectedOccurrence, right: ProjectedOccurrence): number {
  return compareText(left.identity.sourceNoteId, right.identity.sourceNoteId)
    || compareText(left.identity.sourceRawContentHash, right.identity.sourceRawContentHash)
    || compareNumber(left.identity.startOffset, right.identity.startOffset)
    || compareNumber(left.identity.endOffset, right.identity.endOffset)
    || compareText(left.identity.rawToken, right.identity.rawToken);
}

function result(
  issues: ResolverStabilityIssue[],
  before: readonly ProjectedOccurrence[],
  afterExisting: readonly ProjectedOccurrence[],
  copiedNoteOutgoing: readonly ProjectedOccurrence[],
): ResolverStabilityResult {
  const orderedIssues = [...issues].sort((left, right) => compareText(left.code, right.code)
    || compareText(left.sourceNoteId ?? '', right.sourceNoteId ?? '')
    || compareNumber(left.occurrence?.startOffset ?? -1, right.occurrence?.startOffset ?? -1)
    || compareText(left.message, right.message));
  return Object.freeze({
    stable: orderedIssues.length === 0,
    issues: Object.freeze(orderedIssues.map((issue) => Object.freeze(issue))),
    before: Object.freeze([...before]),
    afterExisting: Object.freeze([...afterExisting]),
    copiedNoteOutgoing: Object.freeze([...copiedNoteOutgoing]),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumber(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
