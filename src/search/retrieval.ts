import { createHash } from 'node:crypto';

/** A bounded projection of saved Markdown; never persisted or used for note writes. */
export interface RetrievalSource {
  id: string; title: string; body: string; aliases: readonly string[]; tags: readonly string[]; propertyText: string;
}
interface RetrievalDocument {
  fingerprint: string;
  terms: Map<string, number>;
  length: number;
  headings: Set<string>;
  tags: Set<string>;
}
export interface RetrievalIndex {
  documents: Map<string, RetrievalDocument>;
  postings: Map<string, Map<string, number>>;
  averageLength: number;
  reusedDocuments: number;
  norms: Map<string, number>;
}
export interface TextRecommendation { id: string; similarity: number; terms: string[]; tags: string[]; headings: string[] }
const STOP = new Set('a an and are as at be been being but by can did do does for from had has have how i if in into is it its may more not of on or our should than that the their them there these they this to was we were what when where which who will with would you your'.split(' '));
const MAX_CHARACTERS = 200_000;
const MAX_TERMS = 1024;
const MAX_TOKENS = 8192;
export function retrievalTerms(text: string): string[] {
  return (text.slice(0, MAX_CHARACTERS).normalize('NFC').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [])
    .filter((term) => term.length > 1 && term.length <= 64 && /\p{L}/u.test(term) && !STOP.has(term)).slice(0, MAX_TOKENS);
}
function project(source: RetrievalSource): RetrievalDocument {
  const body = source.body.slice(0, MAX_CHARACTERS);
  const fingerprint = createHash('sha256').update(JSON.stringify([source.title, body, source.aliases, source.tags, source.propertyText])).digest('hex');
  const prose = proseWithoutFences(body).replace(/https?:\/\/[^\s)\]]+/g, ' ');
  const headingText = [...prose.matchAll(/^ {0,3}#{1,6}\s+(.+)$/gm)].map((match) => match[1]!).join(' ');
  const terms = new Map<string, number>();
  const add = (text: string, boost: number) => {
    for (const term of retrievalTerms(text)) {
      if (terms.has(term) || terms.size < MAX_TERMS) terms.set(term, (terms.get(term) ?? 0) + boost);
    }
  };
  add(source.title, 4); add(source.aliases.join(' '), 3); add(headingText, 3);
  add(source.tags.join(' '), 3); add(source.propertyText, 2); add(prose, 1);
  return { fingerprint, terms, length: [...terms.values()].reduce((a, b) => a + b, 0),
    headings: new Set(retrievalTerms(headingText)), tags: new Set(source.tags.map((tag) => tag.normalize('NFC').trim().toLowerCase())) };
}
/** Linear scan: unmatched or extremely long fence markers must not trigger regex backtracking. */
function proseWithoutFences(body: string): string {
  let fence: { marker: string; length: number } | undefined;
  const prose: string[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trimStart();
    const marker = trimmed[0];
    if (line.length - trimmed.length <= 3 && (marker === '`' || marker === '~')) {
      let length = 0;
      while (trimmed[length] === marker) length++;
      if (!fence && length >= 3) { fence = { marker, length }; continue; }
      if (fence && marker === fence.marker && length >= fence.length && trimmed.slice(length).trim() === '') { fence = undefined; continue; }
    }
    if (!fence) prose.push(line);
  }
  return prose.join('\n');
}
export function buildRetrievalIndex(sources: readonly RetrievalSource[], previous?: RetrievalIndex): RetrievalIndex {
  const documents = new Map<string, RetrievalDocument>();
  const postings = new Map<string, Map<string, number>>();
  let reusedDocuments = 0;
  let totalLength = 0;
  for (const source of sources) {
    // Fingerprint before tokenization so unchanged Markdown reuses its entire projection.
    const fingerprint = createHash('sha256').update(JSON.stringify([source.title, source.body.slice(0, MAX_CHARACTERS), source.aliases, source.tags, source.propertyText])).digest('hex');
    const old = previous?.documents.get(source.id);
    const document = old?.fingerprint === fingerprint ? old : project(source);
    if (document === old) reusedDocuments++;
    documents.set(source.id, document);
  }
  for (const [id, document] of documents) {
    totalLength += document.length;
    for (const [term, frequency] of document.terms) {
      let posting = postings.get(term);
      if (!posting) { posting = new Map(); postings.set(term, posting); }
      posting.set(id, frequency);
    }
  }
  const index: RetrievalIndex = { documents, postings, averageLength: documents.size ? totalLength / documents.size : 0, reusedDocuments, norms: new Map() };
  for (const [id, document] of documents) {
    let squared = 0;
    for (const [term, frequency] of document.terms) {
      if (informative(index, term)) squared += termWeight(index, term, frequency) ** 2;
    }
    index.norms.set(id, Math.sqrt(squared));
  }
  return index;
}
function idf(index: RetrievalIndex, term: string): number {
  const frequency = index.postings.get(term)?.size ?? 0;
  return Math.log(1 + (index.documents.size - frequency + 0.5) / (frequency + 0.5));
}
function informative(index: RetrievalIndex, term: string): boolean {
  return index.documents.size < 5 || (index.postings.get(term)?.size ?? 0) / index.documents.size <= 0.6;
}
function termWeight(index: RetrievalIndex, term: string, frequency: number): number {
  // A floor of one prevents unique titles from drowning out shared body text in small vaults.
  const inverseFrequency = Math.min(3, 1 + Math.log((index.documents.size + 1) / ((index.postings.get(term)?.size ?? 0) + 1)));
  return (1 + Math.log(frequency)) * inverseFrequency;
}
/** BM25 with k1=1.2, b=.75. Used only inside existing search match tiers. */
export function retrievalScores(index: RetrievalIndex, query: string): Map<string, number> {
  const scores = new Map<string, number>();
  for (const term of [...new Set(retrievalTerms(query))].slice(0, 32)) {
    const weight = idf(index, term);
    for (const [id, frequency] of index.postings.get(term) ?? []) {
      const length = index.documents.get(id)!.length;
      const value = weight * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * length / (index.averageLength || 1)));
      scores.set(id, (scores.get(id) ?? 0) + value);
    }
  }
  return scores;
}
/** At most 24 informative source terms, with corpus-common terms suppressed. */
export function recommendByText(index: RetrievalIndex, noteId: string, limit = 100): TextRecommendation[] {
  const source = index.documents.get(noteId);
  if (!source || limit <= 0) return [];
  const weight = (term: string, frequency: number) => termWeight(index, term, frequency);
  const selected = [...source.terms].filter(([term]) => informative(index, term))
    .sort((a, b) => weight(b[0], b[1]) - weight(a[0], a[1]) || a[0].localeCompare(b[0])).slice(0, 24);
  const sourceNorm = index.norms.get(noteId) ?? 0;
  const recommendations: TextRecommendation[] = [];
  for (const [id, document] of index.documents) {
    if (id === noteId) continue;
    const shared = selected.filter(([term]) => document.terms.has(term));
    const tags = [...source.tags].filter((tag) => document.tags.has(tag)).sort();
    if (shared.length < 2 && tags.length === 0) continue;
    const dot = shared.reduce((sum, [term, frequency]) => sum + weight(term, frequency) * weight(term, document.terms.get(term)!), 0);
    const denominator = sourceNorm * (index.norms.get(id) ?? 0);
    const similarity = denominator ? Math.min(1, dot / denominator) : 0;
    if (similarity < 0.08 && tags.length === 0) continue;
    recommendations.push({ id, similarity, terms: similarity >= 0.08 && shared.length >= 2 ? shared.slice(0, 4).map(([term]) => term) : [],
      tags: tags.slice(0, 3), headings: shared.filter(([term]) => source.headings.has(term) && document.headings.has(term)).slice(0, 3).map(([term]) => term) });
  }
  return recommendations.sort((a, b) => b.similarity - a.similarity || b.tags.length - a.tags.length || a.id.localeCompare(b.id)).slice(0, Math.min(100, limit));
}
