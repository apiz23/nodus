import type { LinkIndex, IndexedNote } from './link-index.js';
import type { NoteGraph } from './graph.js';
import { recommendByText, type RetrievalIndex } from '../search/retrieval.js';

export type RelatedReasonCode =
  | 'shared-outgoing'
  | 'shared-incoming'
  | 'common-neighbours'
  | 'similar-title'
  | 'similar-alias'
  | 'same-folder'
  | 'similar-content'
  | 'shared-tags'
  | 'related-headings';

export interface RelatedReason {
  code: RelatedReasonCode;
  count: number;
  terms?: string[];
}

export interface RelatedNote {
  note: IndexedNote;
  score: number;
  reasons: RelatedReason[];
}

export interface RelatedNotesOptions {
  limit?: number;
  retrieval?: RetrievalIndex | undefined;
}

/**
 * Read-only lexical and link-based recommendations from one derived snapshot.
 * Only confirmed graph edges contribute. Ambiguous and unresolved links are excluded.
 */
export function relatedNotes(index: LinkIndex, graph: NoteGraph, noteId: string, options: RelatedNotesOptions = {}): RelatedNote[] {
  const limit = Math.max(0, Math.min(20, options.limit ?? 6));
  const notes = new Map(index.notes.map((note) => [note.id, note]));
  const source = notes.get(noteId);
  if (source === undefined) return [];

  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const note of graph.nodes) {
    outgoing.set(note.id, new Set());
    incoming.set(note.id, new Set());
  }
  for (const edge of graph.edges) {
    if (edge.sourceId === edge.targetId) continue;
    outgoing.get(edge.sourceId)?.add(edge.targetId);
    incoming.get(edge.targetId)?.add(edge.sourceId);
  }
  const sourceOut = outgoing.get(noteId) ?? new Set();
  const sourceIn = incoming.get(noteId) ?? new Set();
  const sourceNeighbours = new Set([...sourceOut, ...sourceIn]);
  const sourceFolder = folderOf(source.path);
  const sourceTokens = new Set([...tokenize(source.title), ...source.aliases.flatMap(tokenize)]);

  const textMatches = new Map((options.retrieval ? recommendByText(options.retrieval, noteId) : []).map((item) => [item.id, item]));
  const candidates: RelatedNote[] = [];
  for (const note of index.notes) {
    if (note.id === noteId) continue;
    const candidateOut = outgoing.get(note.id) ?? new Set();
    const candidateIn = incoming.get(note.id) ?? new Set();
    const candidateNeighbours = new Set([...candidateOut, ...candidateIn]);
    const sharedOutgoing = intersection(sourceOut, candidateOut);
    const sharedIncoming = intersection(sourceIn, candidateIn);
    const commonNeighbours = intersection(sourceNeighbours, candidateNeighbours);
    const titleSimilarity = jaccard(tokenize(source.title), tokenize(note.title));
    const aliasSimilarity = Math.max(
      jaccard(sourceTokens, new Set([...tokenize(note.title), ...note.aliases.flatMap(tokenize)])),
      ...note.aliases.map((alias) => jaccard(sourceTokens, new Set(tokenize(alias)))),
    );
    const sameFolder = sourceFolder !== '' && sourceFolder === folderOf(note.path);
    const reasons: RelatedReason[] = [];
    if (sharedOutgoing > 0) reasons.push({ code: 'shared-outgoing', count: sharedOutgoing });
    if (sharedIncoming > 0) reasons.push({ code: 'shared-incoming', count: sharedIncoming });
    if (commonNeighbours > 0) reasons.push({ code: 'common-neighbours', count: commonNeighbours });
    if (titleSimilarity > 0) reasons.push({ code: 'similar-title', count: titleSimilarity });
    if (aliasSimilarity > 0) reasons.push({ code: 'similar-alias', count: aliasSimilarity });
    if (sameFolder) reasons.push({ code: 'same-folder', count: 1 });
    let score = sharedOutgoing * 3 + sharedIncoming * 3 + commonNeighbours * 2
      + titleSimilarity * 2 + aliasSimilarity * 1.5 + (sameFolder ? 1 : 0);
    if (options.retrieval) {
      const text = textMatches.get(note.id);
      const meaningfulLink = sharedOutgoing + sharedIncoming + commonNeighbours > 0;
      if (!meaningfulLink && titleSimilarity === 0 && aliasSimilarity === 0 && !text) continue;
      // Text similarity is normalized; graph popularity and folder proximity cannot dominate it.
      score = Math.min(2, score / 4) + (text?.terms.length ? text.similarity * 8 : 0) + Math.min(2, text?.tags.length ?? 0);
      if (text?.terms.length) reasons.unshift({ code: 'similar-content', count: text.similarity, terms: text.terms });
      if (text?.tags.length) reasons.push({ code: 'shared-tags', count: text.tags.length, terms: text.tags });
      if (text?.headings.length) reasons.push({ code: 'related-headings', count: text.headings.length, terms: text.headings });
    }
    if (score <= 0) continue;
    candidates.push({ note, score: Number(score.toFixed(3)), reasons });
  }

  return candidates.sort((left, right) => right.score - left.score
    || left.note.title.localeCompare(right.note.title)
    || left.note.path.localeCompare(right.note.path)
    || left.note.id.localeCompare(right.note.id)).slice(0, limit);
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'the', 'to', 'with']);

function tokenize(value: string): string[] {
  return value.normalize('NFC').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function jaccard(left: Iterable<string>, right: Iterable<string>): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function intersection(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function folderOf(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '' : normalized.slice(0, index);
}
