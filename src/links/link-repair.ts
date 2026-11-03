import type { LinkIndex } from './link-index.js';

/** Minimal note metadata needed to suggest a repair target. */
export interface LinkSuggestionCandidate {
  id: string;
  title: string;
  path: string;
  aliases: readonly string[];
}

/**
 * Why a note was suggested. The UI shows a short explanation so a repair is
 * never presented as an unexplained automated choice.
 */
export type LinkSuggestionReason =
  | 'candidate'
  | 'exact-title'
  | 'exact-alias'
  | 'exact-path'
  | 'title-similar'
  | 'alias-similar'
  | 'path-similar'
  | 'title-words'
  | 'alias-words'
  | 'path-words';

export interface LinkSuggestion {
  noteId: string;
  title: string;
  path: string;
  /** Deterministic 0-100 confidence; used only for ordering and display. */
  score: number;
  reason: LinkSuggestionReason;
}

export interface LinkSuggestionOptions {
  /** Never suggest the note that contains the broken link. */
  sourceId?: string;
  /** Bounded result size. Defaults to 5 and is clamped to 1-10. */
  limit?: number;
  /** Minimum score to report. Defaults to 45. */
  minScore?: number;
}

export interface LinkSuggester {
  suggest(target: string, options?: LinkSuggestionOptions): LinkSuggestion[];
}

/**
 * Bound fuzzy edit-distance work per target. Cheap normalized prefix,
 * containment, and token checks still run for every note; only the expensive
 * distance branch is budgeted.
 */
const FUZZY_COMPARISONS_PER_TARGET = 64;

interface PreparedCandidate {
  note: LinkSuggestionCandidate;
  titleKey: string;
  aliasKeys: string[];
  pathKey: string;
  fileName: string;
  titleTokens: Set<string>;
  aliasTokens: Set<string>;
  pathTokens: Set<string>;
}

interface Scored {
  suggestion: LinkSuggestion;
  priority: number;
}

const REASON_PRIORITY: Record<LinkSuggestionReason, number> = {
  'exact-title': 0,
  'exact-alias': 1,
  'exact-path': 2,
  'title-similar': 3,
  'alias-similar': 4,
  'path-similar': 5,
  'title-words': 6,
  'alias-words': 7,
  'path-words': 8,
  candidate: 9,
};

/**
 * Precompute normalized metadata once for a whole vault snapshot. Discovery
 * may have hundreds of unresolved links, so the per-target work must not
 * re-normalize every note for every link.
 */
export function createLinkSuggester(notes: readonly LinkSuggestionCandidate[]): LinkSuggester {
  const prepared = notes.map((note) => prepare(note));

  return {
    suggest(target: string, options: LinkSuggestionOptions = {}): LinkSuggestion[] {
      const query = prepareQuery(target);
      if (query === null) return [];
      const sourceId = options.sourceId;
      const limit = clampInteger(options.limit ?? 5, 1, 10);
      const minScore = options.minScore ?? 45;
      const scored: Scored[] = [];
      const fuzzy = { remaining: FUZZY_COMPARISONS_PER_TARGET };

      for (const candidate of prepared) {
        if (sourceId !== undefined && candidate.note.id === sourceId) continue;
        const best = scoreCandidate(query, candidate, fuzzy);
        if (best === null || best.suggestion.score < minScore) continue;
        scored.push(best);
      }

      return scored
        .sort(compareScored)
        .slice(0, limit)
        .map(({ suggestion }) => suggestion);
    },
  };
}

/** Convenience wrapper for one target. Prefer `createLinkSuggester` for batches. */
export function suggestLinkTargets(
  target: string,
  notes: readonly LinkSuggestionCandidate[],
  options: LinkSuggestionOptions = {},
): LinkSuggestion[] {
  return createLinkSuggester(notes).suggest(target, options);
}

/**
 * Ambiguous links already have exact candidates. Preserve the resolver's
 * candidate order and exclude the source note; no similarity ranking is used
 * because the link is not a typo, it is a genuine duplicate title or alias.
 */
export function candidateSuggestions(
  candidateIds: readonly string[],
  notes: readonly LinkSuggestionCandidate[],
  sourceId?: string,
): LinkSuggestion[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const suggestions: LinkSuggestion[] = [];
  for (const id of candidateIds) {
    if (id === sourceId) continue;
    const note = byId.get(id);
    if (note === undefined) continue;
    suggestions.push({ noteId: note.id, title: note.title, path: note.path, score: 100, reason: 'candidate' });
  }
  return suggestions;
}

/**
 * Count confirmed incoming wiki links that address a note by its current
 * title. Used to decide whether a title rename should retain the previous
 * title as an alias. ID-pinned and path links are intentionally excluded.
 */
export function countIncomingTitleLinks(index: LinkIndex, noteId: string, title: string): number {
  const titleKey = normalizeLinkText(title);
  if (titleKey === '') return 0;
  let count = 0;
  for (const link of index.links) {
    if (link.sourceId === noteId) continue;
    if (link.resolution.status !== 'resolved' || link.resolution.noteId !== noteId) continue;
    if (normalizeLinkText(link.target) === titleKey) count += 1;
  }
  return count;
}

/** Normalization shared by resolution suggestions and rename preservation. */
export function normalizeLinkText(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

function prepare(note: LinkSuggestionCandidate): PreparedCandidate {
  const titleKey = normalizeLinkText(note.title);
  const pathKey = normalizePath(note.path);
  return {
    note,
    titleKey,
    aliasKeys: note.aliases.map(normalizeLinkText).filter((value) => value !== ''),
    pathKey,
    fileName: fileNameOf(pathKey),
    titleTokens: tokenize(note.title),
    aliasTokens: new Set(note.aliases.flatMap((alias) => [...tokenize(alias)])),
    pathTokens: tokenize(pathKey),
  };
}

interface Query {
  textKey: string;
  pathKey: string;
  tokens: Set<string>;
}

function prepareQuery(target: string): Query | null {
  const textKey = normalizeLinkText(target);
  if (textKey.length < 2) return null;
  return {
    textKey,
    pathKey: normalizePath(target),
    tokens: tokenize(target),
  };
}

interface FuzzyBudget { remaining: number }

function scoreCandidate(query: Query, candidate: PreparedCandidate, fuzzy: FuzzyBudget): Scored | null {
  let best: Scored | null = null;
  const consider = (score: number, reason: LinkSuggestionReason): void => {
    const rounded = Math.max(0, Math.min(100, Math.round(score)));
    if (best === null || rounded > best.suggestion.score
      || (rounded === best.suggestion.score && REASON_PRIORITY[reason] < best.priority)) {
      best = {
        suggestion: {
          noteId: candidate.note.id,
          title: candidate.note.title,
          path: candidate.note.path,
          score: rounded,
          reason,
        },
        priority: REASON_PRIORITY[reason],
      };
    }
  };

  scoreTitleLike(query, candidate.titleKey, candidate.titleTokens, 'title', consider, fuzzy);
  for (const aliasKey of candidate.aliasKeys) {
    scoreTitleLike(query, aliasKey, candidate.aliasTokens, 'alias', consider, fuzzy);
  }
  scorePath(query, candidate, consider, fuzzy);
  return best;
}

function scoreTitleLike(
  query: Query,
  key: string,
  tokens: Set<string>,
  kind: 'title' | 'alias',
  consider: (score: number, reason: LinkSuggestionReason) => void,
  fuzzy: FuzzyBudget,
): void {
  if (key === '') return;
  if (key === query.textKey) {
    consider(100, kind === 'title' ? 'exact-title' : 'exact-alias');
    return;
  }
  const similarReason: LinkSuggestionReason = kind === 'title' ? 'title-similar' : 'alias-similar';
  const wordReason: LinkSuggestionReason = kind === 'title' ? 'title-words' : 'alias-words';

  const prefix = commonPrefixRatio(query.textKey, key);
  if (prefix >= 0.6) consider(74 + prefix * 16, similarReason);
  const contains = key.includes(query.textKey) || query.textKey.includes(key);
  if (contains) {
    const ratio = Math.min(key.length, query.textKey.length) / Math.max(key.length, query.textKey.length);
    consider(72 + ratio * 14, similarReason);
  }

  const overlap = tokenOverlap(query.tokens, tokens);
  if (overlap >= 0.5) consider(55 + overlap * 25, wordReason);

  // Edit distance is the expensive branch. Lexical signals above already
  // produce a useful suggestion in the common case (shared words, prefixes,
  // or containment), so reserve fuzzy distance for candidates with no such
  // signal. This keeps discovery usable on multi-thousand-note vaults.
  if (!contains && prefix < 0.6 && overlap === 0 && plausibleFuzzyMatch(query.textKey, key) && fuzzy.remaining > 0) {
    fuzzy.remaining -= 1;
    const similarity = stringSimilarity(query.textKey, key);
    if (similarity >= 0.62) consider(40 + similarity * 34, similarReason);
  }
}

function scorePath(
  query: Query,
  candidate: PreparedCandidate,
  consider: (score: number, reason: LinkSuggestionReason) => void,
  fuzzy: FuzzyBudget,
): void {
  if (candidate.pathKey === '') return;
  if (candidate.pathKey === query.pathKey) {
    consider(98, 'exact-path');
    return;
  }
  if (candidate.fileName !== '' && candidate.fileName === query.pathKey) {
    consider(96, 'exact-path');
    return;
  }

  const prefix = commonPrefixRatio(query.pathKey, candidate.pathKey);
  if (prefix >= 0.6) consider(72 + prefix * 16, 'path-similar');
  const contains = candidate.pathKey.includes(query.pathKey) || query.pathKey.includes(candidate.pathKey);
  if (contains) {
    const ratio = Math.min(candidate.pathKey.length, query.pathKey.length)
      / Math.max(candidate.pathKey.length, query.pathKey.length);
    consider(70 + ratio * 14, 'path-similar');
  }

  const overlap = tokenOverlap(query.tokens, candidate.pathTokens);
  if (overlap >= 0.5) consider(52 + overlap * 22, 'path-words');

  if (!contains && prefix < 0.6 && overlap === 0 && plausibleFuzzyMatch(query.pathKey, candidate.fileName) && fuzzy.remaining > 0) {
    fuzzy.remaining -= 1;
    const fileSimilarity = stringSimilarity(query.pathKey, candidate.fileName);
    if (fileSimilarity >= 0.62) consider(44 + fileSimilarity * 26, 'path-similar');
  }
}

function compareScored(left: Scored, right: Scored): number {
  return right.suggestion.score - left.suggestion.score
    || left.suggestion.title.localeCompare(right.suggestion.title)
    || left.suggestion.noteId.localeCompare(right.suggestion.noteId);
}

function normalizePath(value: string): string {
  return normalizeLinkText(value)
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\.md$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

function fileNameOf(pathKey: string): string {
  const index = pathKey.lastIndexOf('/');
  return index === -1 ? pathKey : pathKey.slice(index + 1);
}

function tokenize(value: string): Set<string> {
  return new Set(
    normalizeLinkText(value)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token !== ''),
  );
}

function tokenOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  // Use the larger vocabulary so a single common word cannot dominate a
  // multi-word candidate. This keeps "Future" vs "Future plans" a prefix
  // match rather than an artificially perfect shared-word score.
  return shared / Math.max(left.size, right.size);
}

function commonPrefixRatio(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) return 0;
  let index = 0;
  while (index < length && left[index] === right[index]) index += 1;
  return index / Math.max(left.length, right.length);
}

/**
 * Cheap prefilter for the bounded edit-distance branch. A single-word typo
 * usually keeps the first or last character, and a multi-character insertion
 * keeps the length close. Candidates that fail all three tests are extremely
 * unlikely to reach the 0.62 similarity threshold and are skipped.
 */
function plausibleFuzzyMatch(left: string, right: string): boolean {
  if (left === '' || right === '') return false;
  if (left[0] === right[0]) return true;
  const lengthDelta = Math.abs(left.length - right.length);
  if (lengthDelta <= 2) return true;
  return left[left.length - 1] === right[right.length - 1] && lengthDelta <= 4;
}

/** Bounded Levenshtein similarity in [0, 1]; cheap length guards keep large vaults predictable. */
function stringSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  const longest = Math.max(left.length, right.length);
  if (longest === 0) return 1;
  if (longest > 160) return 0;
  if (Math.min(left.length, right.length) / longest < 0.6) return 0;
  const maxDistance = Math.max(1, Math.floor(longest * 0.38));
  const distance = boundedLevenshtein(left, right, maxDistance);
  if (distance < 0) return 0;
  return 1 - distance / longest;
}

function boundedLevenshtein(left: string, right: string, maxDistance: number): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowMinimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      const value = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        previous[column - 1]! + cost,
      );
      current[column] = value;
      if (value < rowMinimum) rowMinimum = value;
    }
    if (rowMinimum > maxDistance) return -1;
    previous = current;
  }
  const distance = previous[right.length]!;
  return distance > maxDistance ? -1 : distance;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
