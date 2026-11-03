import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Note } from '../domain/note.js';
import type { LinkIndex } from '../links/link-index.js';
import { projectPropertyValues, type PropertyCatalog } from '../properties/catalog.js';
import type { RetrievalIndex } from '../search/retrieval.js';
import { retrievalTerms } from '../search/retrieval.js';

export type OrganizationSuggestionType = 'tag' | 'duplicate' | 'folder' | 'metadata';
export type OrganizationAction =
  | { type: 'add-tag'; noteId: string; tag: string }
  | { type: 'remove-tag'; noteId: string; tag: string }
  | { type: 'preview-move'; noteId: string; folder: string }
  | { type: 'review'; noteId: string };

export interface OrganizationSuggestion {
  id: string;
  type: OrganizationSuggestionType;
  affectedNotes: Array<{ id: string; title: string; path: string }>;
  explanation: string;
  evidence: string[];
  confidence: number;
  action: OrganizationAction;
}

export interface OrganizationAnalysis {
  totalNotes: number;
  suggestions: OrganizationSuggestion[];
  counts: Record<OrganizationSuggestionType, number>;
  truncated: boolean;
  retrievalIssue?: string;
  catalogIssue?: string;
}
export interface OrganizationMovePreview {
  noteId: string;
  title: string;
  currentPath: string;
  destinationPath: string;
  destinationExists: boolean;
  pathLinkCount: number;
  affectedSourceCount: number;
  pathLinks: Array<{ sourceId: string; sourceTitle: string; sourcePath: string; target: string; display?: string; line: number; snippet: string }>;
  truncated: boolean;
}
export type OrganizationAnalysisStage = 'candidate-generation' | 'duplicate-analysis' | 'tag-analysis' | 'folder-analysis' | 'metadata-analysis';

const MAX_SUGGESTIONS = 500;
const MAX_PAIRS = 25_000;
const MAX_NEIGHBOURS_PER_NOTE = 32;
const MAX_CACHED_BODY_TERMS = 500_000;
const GENERIC_TAGS = new Set(['general', 'misc', 'miscellaneous', 'notes', 'other', 'todo', 'uncategorized']);

/** Deterministic, read-only analysis over existing Markdown, links and registered properties. */
export function analyzeOrganization(
  notes: readonly Note[],
  links: LinkIndex,
  retrieval?: RetrievalIndex,
  catalog: PropertyCatalog = { properties: [] },
  options: { onStageTiming?: (stage: OrganizationAnalysisStage, milliseconds: number) => void } = {},
): OrganizationAnalysis {
  notes = [...notes].sort(compareNote);
  links = { ...links, links: [...links.links].sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.start - b.start) };
  const counts: OrganizationAnalysis['counts'] = { tag: 0, duplicate: 0, folder: 0, metadata: 0 };
  let truncated = false;
  let stageStart = options.onStageTiming ? performance.now() : 0;
  const finishStage = (stage: OrganizationAnalysisStage) => {
    if (!options.onStageTiming) return;
    const current = performance.now();
    options.onStageTiming(stage, current - stageStart);
    stageStart = current;
  };
  const byId = new Map(notes.map((note) => [note.id, note]));
  const suggestions: OrganizationSuggestion[] = [];
  const add = (value: Omit<OrganizationSuggestion, 'id'>): void => {
    counts[value.type]++;
    if (suggestions.length >= MAX_SUGGESTIONS) { truncated = true; return; }
    const ids = value.affectedNotes.map((note) => note.id).sort();
    // Include the recommendation's evidence and explanation so distinct
    // suggestions for the same note (for example, two missing properties or
    // two candidate tags) do not collide in the UI or browser-local status map.
    const signature = JSON.stringify([value.type, ids, value.action, value.explanation, value.evidence]);
    suggestions.push({ ...value, id: createHash('sha256').update(signature).digest('hex').slice(0, 24) });
  };

  const tagCounts = new Map<string, number>();
  const tagSpellings = new Map<string, Set<string>>();
  for (const note of notes) for (const tag of note.tags) {
    const key = foldTag(tag);
    tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
    const values = tagSpellings.get(key) ?? new Set<string>();
    values.add(tag);
    tagSpellings.set(key, values);
  }

  // Legacy files can contain case variants despite current write validation.
  // Diagnose these; never rewrite them during analysis.
  for (const [key, spellings] of [...tagSpellings].sort(([a], [b]) => a.localeCompare(b))) {
    if (spellings.size < 2) continue;
    const affected = notes.filter((note) => note.tags.some((tag) => foldTag(tag) === key));
    const representative = summarize(affected)[0];
    if (!representative) continue;
    add({ type: 'tag', affectedNotes: summarize(affected),
      explanation: `The tag appears with different spelling: ${[...spellings].sort().join(', ')}.`,
      evidence: [`${affected.length} notes use a spelling in this group`, 'Existing note values were left unchanged'],
      confidence: 0.9, action: { type: 'review', noteId: representative.id } });
  }

  const pairs = buildCandidatePairs(retrieval, notes.length);
  finishStage('candidate-generation');
  const comparable = new Map<string, Set<string>>();
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const pairScores = new Map<string, { left: string; right: string; score: number; shared: string[] }>();
  const bodyTerms = new Map<string, Set<string>>();
  let cachedBodyTermCount = 0;
  const getBodyTerms = (id: string, body: string): Set<string> => {
    const cached = bodyTerms.get(id);
    if (cached) return cached;
    const terms = new Set(retrievalTerms(body));
    if (cachedBodyTermCount + terms.size <= MAX_CACHED_BODY_TERMS) {
      bodyTerms.set(id, terms);
      cachedBodyTermCount += terms.size;
    }
    return terms;
  };
  for (const [leftId, rightIds] of pairs) {
    const left = notesById.get(leftId);
    if (!left) continue;
    const leftTerms = getBodyTerms(leftId, left.body);
    for (const rightId of rightIds) {
      if (leftId >= rightId) continue;
      const right = notesById.get(rightId);
      if (!right) continue;
      const rightTerms = getBodyTerms(rightId, right.body);
      if (leftTerms.size === 0 || rightTerms.size === 0) continue;
      const shared = [...leftTerms].filter((term) => rightTerms.has(term)).sort();
      if (shared.length < 4) continue;
      const score = shared.length / (leftTerms.size + rightTerms.size - shared.length);
      if (score < 0.55) continue;
      pairScores.set(pairKey(leftId, rightId), { left: leftId, right: rightId, score, shared: shared.slice(0, 5) });
      (comparable.get(leftId) ?? comparable.set(leftId, new Set()).get(leftId)!).add(rightId);
      (comparable.get(rightId) ?? comparable.set(rightId, new Set()).get(rightId)!).add(leftId);
    }
  }

  // Exact duplicate detection uses bounded SHA-256 over body bytes (empty notes excluded).
  const exact = new Map<string, Note[]>();
  for (const note of notes) {
    if (!note.body.trim()) continue;
    const hash = createHash('sha256').update(note.body).digest('hex');
    const group = exact.get(hash) ?? [];
    group.push(note);
    exact.set(hash, group);
  }
  const exactPairs = new Set<string>();
  for (const group of exact.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(compareNote);
    for (let i = 0; i < sorted.length - 1; i++) {
      const left = sorted[i]!;
      const right = sorted[i + 1]!;
      exactPairs.add(pairKey(left.id, right.id));
      add({ type: 'duplicate', affectedNotes: summarize([left, right]),
        explanation: 'These notes have identical Markdown body content.',
        evidence: [`Exact body match (${left.body.length.toLocaleString()} characters)`, 'No note was changed or removed'],
        confidence: 1, action: { type: 'review', noteId: left.id } });
    }
  }
  for (const pair of [...pairScores.values()].sort((a, b) => b.score - a.score || a.left.localeCompare(b.left) || a.right.localeCompare(b.right))) {
    if (exactPairs.has(pairKey(pair.left, pair.right))) continue;
    const left = notesById.get(pair.left)!;
    const right = notesById.get(pair.right)!;
    add({ type: 'duplicate', affectedNotes: summarize([left, right]),
      explanation: 'These notes share substantial Markdown content and may cover overlapping knowledge.',
      evidence: [`${Math.round(pair.score * 100)}% token-set overlap`, `Shared terms: ${pair.shared.join(', ')}`],
      confidence: Math.min(0.92, Math.max(0.55, Number(pair.score.toFixed(2))),),
      action: { type: 'review', noteId: left.id } });
  }
  finishStage('duplicate-analysis');

  // Existing-tag recommendations use only bounded content candidates.
  const tagVotes = new Map<string, Map<string, { count: number; supporters: Set<string>; terms: Set<string> }>>();
  for (const [noteId, neighbours] of comparable) {
    const note = notesById.get(noteId)!;
    const current = new Set(note.tags.map(foldTag));
    for (const otherId of neighbours) {
      const other = notesById.get(otherId)!;
      for (const tag of other.tags) {
        const identity = foldTag(tag);
        if (current.has(identity) || GENERIC_TAGS.has(identity) || (tagCounts.get(identity) ?? 0) > Math.max(50, notes.length * 0.35)) continue;
        const record = tagVotes.get(noteId) ?? new Map();
        const vote = record.get(identity) ?? { count: 0, supporters: new Set<string>(), terms: new Set<string>() };
        vote.count++;
        vote.supporters.add(otherId);
        const pair = pairScores.get(pairKey(noteId, otherId));
        pair?.shared.slice(0, 3).forEach((term) => vote.terms.add(term));
        record.set(identity, vote);
        tagVotes.set(noteId, record);
      }
    }
  }
  for (const [noteId, votes] of tagVotes) for (const [identity, vote] of votes) {
    if (vote.supporters.size < 2 && vote.count < 2) continue;
    const note = notesById.get(noteId)!;
    const tag = [...(tagSpellings.get(identity) ?? new Set([identity]))].sort((a, b) => a.localeCompare(b))[0]!;
    const supporters = [...vote.supporters].map((id) => notesById.get(id)!).filter(Boolean);
    add({ type: 'tag', affectedNotes: summarize([note, ...supporters]),
      explanation: `Add the existing “${tag}” tag to “${note.title}”.`,
      evidence: [`${supporters.length} similar notes use this tag`, ...(vote.terms.size ? [`Shared content: ${[...vote.terms].sort().join(', ')}`] : [])],
      confidence: Math.min(0.9, 0.55 + Math.min(0.3, supporters.length * 0.08)),
      action: { type: 'add-tag', noteId, tag } });
  }
  finishStage('tag-analysis');

  // Folder proposals require at least two distinct resolved linked/content peers.
  const folderPeers = new Map<string, Map<string, Set<string>>>();
  const connect = (sourceId: string, targetId: string) => {
    const source = notesById.get(sourceId);
    const target = notesById.get(targetId);
    if (!source || !target || sourceId === targetId) return;
    const folder = folderOf(target.path);
    if (!folder || folder === folderOf(source.path)) return;
    const folders = folderPeers.get(sourceId) ?? new Map<string, Set<string>>();
    const members = folders.get(folder) ?? new Set<string>();
    members.add(targetId);
    folders.set(folder, members);
    folderPeers.set(sourceId, folders);
  };
  for (const link of links.links) if (link.resolution.status === 'resolved' && link.resolution.noteId) {
    connect(link.sourceId, link.resolution.noteId);
    connect(link.resolution.noteId, link.sourceId);
  }
  for (const [id, peers] of comparable) for (const peerId of peers) connect(id, peerId);
  for (const [noteId, folders] of folderPeers) {
    const best = [...folders].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0];
    if (!best || best[1].size < 2) continue;
    const note = notesById.get(noteId)!;
    const supporters = [...best[1]].map((id) => notesById.get(id)!).filter(Boolean);
    add({ type: 'folder', affectedNotes: summarize([note, ...supporters]),
      explanation: `“${note.title}” may fit better in “${best[0]}” with related notes.`,
      evidence: [`${supporters.length} linked or content-similar notes are in ${best[0]}`, 'Moving remains an explicit action; path links require separate review'],
      confidence: Math.min(0.9, 0.5 + best[1].size * 0.1),
      action: { type: 'preview-move', noteId, folder: best[0] } });
  }
  finishStage('folder-analysis');

  // Surface only registered properties with meaningful existing coverage.
  const propertyProjections = new Map(notes.map((note) => [note.id, projectPropertyValues(catalog, note.extraFrontmatter)]));
  for (const property of catalog.properties) {
    const populated = notes.filter((note) => Object.hasOwn(propertyProjections.get(note.id)?.values ?? {}, property.id));
    if (populated.length >= 3 && populated.length / Math.max(1, notes.length) >= 0.6) {
      const missing = notes.filter((note) => !Object.hasOwn(propertyProjections.get(note.id)?.values ?? {}, property.id)).slice(0, 100);
      for (const note of missing) add({ type: 'metadata', affectedNotes: summarize([note, ...populated.slice(0, 3)]),
        explanation: `“${note.title}” has no value for the commonly used “${property.name}” property.`,
        evidence: [`${populated.length} of ${notes.length} notes have this registered property`, `Type: ${property.type}`],
        confidence: Math.min(0.85, 0.5 + populated.length / Math.max(1, notes.length) * 0.3),
        action: { type: 'review', noteId: note.id } });
    }
    for (const note of notes) {
      const invalid = propertyProjections.get(note.id)?.issues.find((issue) => issue.propertyId === property.id);
      if (!invalid) continue;
      add({ type: 'metadata', affectedNotes: summarize([note]),
        explanation: `“${note.title}” has a value that does not match the registered “${property.name}” property.`,
        evidence: [invalid.message, 'The original YAML value was preserved'], confidence: 0.95,
        action: { type: 'review', noteId: note.id } });
    }
  }
  finishStage('metadata-analysis');

  suggestions.sort((a, b) => b.confidence - a.confidence || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  const bounded = suggestions.slice(0, MAX_SUGGESTIONS);
  return { totalNotes: notes.length, suggestions: bounded, counts, truncated };
}

/** Preview a proposed note move and report only links that resolve through path fallback. */
export function previewOrganizationMove(notes: readonly Note[], links: LinkIndex, noteId: string, folder: string, limit = 100): OrganizationMovePreview | null {
  const note = notes.find((item) => item.id === noteId);
  if (!note) return null;
  const path = normalizeLinkPath(note.path);
  const destinationPath = `${folder.replace(/\/+$/, '')}/${note.path.split('/').at(-1) ?? note.path}`;
  const keys = new Set(notes.flatMap((item) => [item.title, ...item.aliases]).map(normalizeLinkKey));
  const pathLinks = links.links.filter((link) => link.resolution.status === 'resolved'
    && link.resolution.noteId === noteId
    && !isUuidTarget(link.target)
    && !keys.has(normalizeLinkKey(link.target))
    && normalizeLinkPath(link.target) === path);
  const uniqueSources = new Set(pathLinks.map((link) => link.sourceId));
  return {
    noteId,
    title: note.title,
    currentPath: note.path,
    destinationPath,
    destinationExists: notes.some((candidate) => candidate.id !== noteId && candidate.path === destinationPath),
    pathLinkCount: pathLinks.length,
    affectedSourceCount: uniqueSources.size,
    pathLinks: pathLinks.slice(0, Math.max(0, limit)).map((link) => ({ sourceId: link.sourceId, sourceTitle: link.sourceTitle,
      sourcePath: link.sourcePath, target: link.target, ...(link.display === undefined ? {} : { display: link.display }), line: link.line, snippet: link.snippet })),
    truncated: pathLinks.length > limit,
  };
}

function buildCandidatePairs(index: RetrievalIndex | undefined, noteCount: number): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  if (!index || noteCount < 2) return result;
  const commonLimit = Math.max(12, Math.min(500, Math.floor(noteCount * 0.05)));
  let pairCount = 0;
  // The retrieval index is built from path-sorted snapshots, so insertion order
  // is deterministic and avoids an additional sort/materialization of all terms.
  for (const [term, posting] of index.postings) {
    if (posting.size < 2 || posting.size > commonLimit) continue;
    const ids = [...posting.keys()].sort();
    for (let left = 0; left < ids.length && pairCount < MAX_PAIRS; left++) {
      for (let right = left + 1; right < ids.length && pairCount < MAX_PAIRS; right++) {
        const a = ids[left]!;
        const b = ids[right]!;
        const aa = result.get(a) ?? new Set<string>();
        const bb = result.get(b) ?? new Set<string>();
        if (aa.size >= MAX_NEIGHBOURS_PER_NOTE || bb.size >= MAX_NEIGHBOURS_PER_NOTE || aa.has(b)) continue;
        aa.add(b); bb.add(a); result.set(a, aa); result.set(b, bb); pairCount++;
      }
    }
    if (pairCount >= MAX_PAIRS) break;
  }
  return result;
}

function summarize(notes: readonly Note[]): OrganizationSuggestion['affectedNotes'] {
  return [...new Map(notes.map((note) => [note.id, { id: note.id, title: note.title, path: note.path }])).values()]
    .sort((a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path) || a.id.localeCompare(b.id));
}
function foldTag(tag: string): string { return tag.normalize('NFC').trim().toLowerCase(); }
function folderOf(path: string): string { const normalized = path.replaceAll('\\', '/'); const index = normalized.lastIndexOf('/'); return index < 0 ? '' : normalized.slice(0, index); }
function pairKey(left: string, right: string): string { return left < right ? `${left}\0${right}` : `${right}\0${left}`; }
function compareNote(left: Note, right: Note): number { return left.title.localeCompare(right.title) || left.path.localeCompare(right.path) || left.id.localeCompare(right.id); }
function normalizeLinkKey(value: string): string { return value.normalize('NFC').trim().toLowerCase(); }
function normalizeLinkPath(value: string): string { return value.normalize('NFC').trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\.md$/i, '').toLowerCase(); }
function isUuidTarget(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim()); }
