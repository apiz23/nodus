import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildRetrievalIndex, recommendByText, retrievalScores, type RetrievalSource } from '../src/search/retrieval.js';
import { buildSearchIndex, searchIndex } from '../src/search/search-index.js';
import { buildLinkIndex } from '../src/links/link-index.js';
import { graphFromLinkIndex } from '../src/links/graph.js';
import { relatedNotes } from '../src/links/related-notes.js';
const source = (id: string, body: string, tags: string[] = [], title = id): RetrievalSource => ({ id, body, tags, title, aliases: [], propertyText: '' });
const note = (id: number, title: string, body: string, tags: string[] = []) => createNote({
  id: `${String(id).padStart(8, '0')}-1111-4111-8111-111111111111`, title, body, tags, path: `folder-${id}/note.md`, now: '2026-11-03T00:00:00Z',
});

describe('local knowledge retrieval', () => {
  it('finds unlinked notes across folders by saved body and heading evidence', () => {
    const notes = [note(1, 'Garden log', '# Soil ecology\nCompost restores soil nutrients and supports biodiversity.'),
      note(2, 'Field research', '# Soil ecology\nSoil nutrients support biodiversity in compost research.'),
      note(3, 'Travel', 'Train tickets and city museums.')];
    const search = buildSearchIndex(notes);
    const links = buildLinkIndex(notes);
    const results = relatedNotes(links, graphFromLinkIndex(links), notes[0]!.id, { retrieval: search.retrieval });
    expect(results.map((item) => item.note.id)).toEqual([notes[1]!.id]);
    expect(results[0]!.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'similar-content', terms: expect.arrayContaining(['soil']) }),
      expect.objectContaining({ code: 'related-headings' }),
    ]));
  });
  it('uses shared tags without claiming semantic understanding or folder-only relevance', () => {
    const notes = [note(1, 'Morning', 'Unique alpha.', ['Research']), note(2, 'Evening', 'Separate beta.', ['research']), note(3, 'Other', 'Nothing related.')];
    notes[2]!.path = notes[0]!.path.replace('note.md', 'other.md');
    const links = buildLinkIndex(notes);
    const results = relatedNotes(links, graphFromLinkIndex(links), notes[0]!.id, { retrieval: buildSearchIndex(notes).retrieval });
    expect(results.map((item) => item.note.id)).toEqual([notes[1]!.id]);
    expect(results[0]!.reasons.some((reason) => reason.code === 'shared-tags')).toBe(true);
  });
  it('preserves exact title tiers and ranks focused content above diluted content', () => {
    const notes = [note(1, 'Exact', 'ecology '.repeat(20)), note(2, 'Ecology', 'Other text.'), note(3, 'Focused', 'ecology biodiversity'),
      note(4, 'Diluted', `ecology ${'unrelated vocabulary '.repeat(200)}`)];
    const results = searchIndex(buildSearchIndex(notes), 'ecology');
    expect(results[0]!.id).toBe(notes[1]!.id);
    expect(results.findIndex((item) => item.id === notes[2]!.id)).toBeLessThan(results.findIndex((item) => item.id === notes[3]!.id));
    expect(searchIndex(buildSearchIndex(notes), 'title:ecology').map((item) => item.id)).toEqual([notes[1]!.id]);
  });
  it('reuses unchanged projections, updates edits, evicts deletions and preserves IDs on rename', () => {
    const sources = [source('a', 'compost soil ecology'), source('b', 'compost soil ecology')];
    const first = buildRetrievalIndex(sources);
    const unchanged = buildRetrievalIndex(sources, first);
    expect(unchanged.reusedDocuments).toBe(2);
    const renamed = buildRetrievalIndex([{ ...sources[0]!, title: 'Renamed' }, sources[1]!], unchanged);
    expect(renamed.reusedDocuments).toBe(1);
    expect(recommendByText(renamed, 'a')[0]?.id).toBe('b');
    const edited = buildRetrievalIndex([sources[0]!, source('b', 'unrelated train tickets')], renamed);
    expect(recommendByText(edited, 'a')).toEqual([]);
    expect(recommendByText(buildRetrievalIndex([sources[0]!], edited), 'a')).toEqual([]);
    expect(recommendByText(first, 'a')[0]?.id).toBe('b'); // Previous snapshots remain immutable.
  });
  it('rebuilds equivalent results, bounds results and handles duplicate IDs and long Unicode documents', () => {
    const sources = Array.from({ length: 40 }, (_, id) => source(String(id), '# 生態 知識\nCafé compost soil ecology ' + 'soil '.repeat(10_000)));
    const first = buildRetrievalIndex(sources);
    const results = recommendByText(first, '0', 5);
    // Corpus-common boilerplate does not produce strong recommendations.
    expect(results).toEqual([]);
    expect(retrievalScores(first, 'café')).toEqual(retrievalScores(buildRetrievalIndex(sources, first), 'café'));
    expect(buildRetrievalIndex([sources[0]!, sources[0]!]).documents.size).toBe(1);
    expect(retrievalScores(first, '')).toEqual(new Map());
    expect(recommendByText(first, 'deleted')).toEqual([]);
  });
  it('suppresses one-word weak overlap, ignores fenced code, and provides stable bounded duplicate-free results', () => {
    const sources = [source('a', 'compost soil ecology'), source('c', 'compost soil ecology'), source('b', 'compost soil ecology'), source('d', 'compost travel'),
      source('e', '```js\ncompost soil ecology\n```\ntrain tickets')];
    const first = buildRetrievalIndex(sources);
    const results = recommendByText(first, 'a', 1);
    expect(results.map((item) => item.id)).toEqual(['b']);
    expect(recommendByText(first, 'a', 20).map((item) => item.id)).toEqual(['b', 'c']);
    expect(recommendByText(buildRetrievalIndex([...sources].reverse()), 'a', 20)).toEqual(recommendByText(first, 'a', 20));
    expect(recommendByText(first, 'a', 0)).toEqual([]);
  });
  it('indexes only valid registered metadata, and refreshes projections when the catalog changes', () => {
    const notes = [note(1, 'Entry', 'Ordinary body')];
    notes[0]!.extraFrontmatter = { custom: 'unregisteredsecret', status: 'botany', nodus_data: { private: 'computedsecret' } };
    const property = { id: 'aaaaaaaa-1111-4111-8111-111111111111', key: 'status', name: 'Discipline', type: 'text' as const };
    const first = buildSearchIndex(notes, { properties: [property] });
    expect(retrievalScores(first.retrieval!, 'botany').has(notes[0]!.id)).toBe(true);
    expect(retrievalScores(first.retrieval!, 'unregisteredsecret computedsecret').size).toBe(0);
    const removed = buildSearchIndex(notes, { properties: [] }, undefined, first);
    expect(retrievalScores(removed.retrieval!, 'botany').size).toBe(0);
    const invalid = buildSearchIndex(notes, { properties: [{ ...property, type: 'number' }] });
    expect(invalid.metadataIssues).toHaveLength(1);
    expect(retrievalScores(invalid.retrieval!, 'botany').size).toBe(0);
  });
  it('handles long/unclosed and differently sized fence markers without indexing code as prose', () => {
    const index = buildRetrievalIndex([
      source('a', 'Soil ecology\n````js\nhiddencode\n```\nstillhidden\n`````\nvisibletext'),
      source('b', '`'.repeat(200_000)),
      source('c', '~~~\nunterminatedcode'),
    ]);
    expect(retrievalScores(index, 'hiddencode stillhidden unterminatedcode').size).toBe(0);
    expect(retrievalScores(index, 'visibletext').has('a')).toBe(true);
  });
});
