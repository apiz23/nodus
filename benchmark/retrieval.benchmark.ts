import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildSearchIndex, searchIndex } from '../src/search/search-index.js';
import { buildLinkIndex } from '../src/links/link-index.js';
import { graphFromLinkIndex } from '../src/links/graph.js';
import { relatedNotes } from '../src/links/related-notes.js';
const topics = ['compost soil ecology biodiversity gardening', 'astronomy galaxies planets telescope orbit', 'music piano rhythm melody harmony', 'cooking recipe vegetables kitchen nutrition', 'mathematics algebra geometry calculus equation', 'railway train transport station journey', 'ocean marine coral habitat conservation', 'painting watercolor canvas pigment drawing', 'software programming compiler algorithm testing', 'exercise running fitness muscle endurance'];
const measure = <T>(run: () => T) => { const start = performance.now(); const value = run(); return { value, ms: performance.now() - start }; };
describe('knowledge retrieval benchmark', () => {
  it('measures rebuild, projection reuse, queries, recommendations and approximate memory at 1k/5k/10k', () => {
    for (const size of [1000, 5000, 10000]) {
      const notes = Array.from({ length: size }, (_, id) => createNote({
        id: `${String(id).padStart(8, '0')}-1111-4111-8111-111111111111`, title: `Research record ${id}`, path: `folder-${id % 20}/note-${id}.md`,
        body: `# ${topics[id % topics.length]}\n${topics[id % topics.length]}\n${'Observations and practical research. '.repeat(8)}`,
        tags: [`topic-${id % topics.length}`], now: '2026-11-03T00:00:00Z',
      }));
      const before = process.memoryUsage();
      const initial = measure(() => buildSearchIndex(notes));
      const links = buildLinkIndex(notes), graph = graphFromLinkIndex(links);
      const recommend = () => relatedNotes(links, graph, notes[0]!.id, { retrieval: initial.value.retrieval });
      const cold = measure(() => searchIndex(initial.value, 'soil'));
      const queryTimes: number[] = [], recommendationTimes: number[] = [];
      for (let i = 0; i < 5; i++) {
        queryTimes.push(measure(() => searchIndex(initial.value, 'soil')).ms);
        const recommendations = measure(recommend);
        recommendationTimes.push(recommendations.ms);
        expect(recommendations.value).toHaveLength(6);
        expect(new Set(recommendations.value.map((item) => item.note.id)).size).toBe(6);
        expect(recommendations.value.every((item) => item.reasons.some((reason) => reason.code === 'similar-content'))).toBe(true);
      }
      const changed = [...notes]; changed[0] = { ...changed[0]!, body: 'New unrelated content about pottery ceramic sculpture.' };
      const incremental = measure(() => buildSearchIndex(changed, undefined, undefined, initial.value));
      expect(incremental.value.retrieval!.reusedDocuments).toBe(size - 1);
      expect(cold.value).toHaveLength(50);
      const after = process.memoryUsage();
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
      const projection = initial.value.retrieval!;
      const encodedBytes = Buffer.byteLength(JSON.stringify({ documents: [...projection.documents].map(([id, doc]) => [id, [...doc.terms]]), postings: [...projection.postings].map(([term, ids]) => [term, [...ids]]) }));
      process.stdout.write(JSON.stringify({ notes: size, initialIndexMs: initial.ms, firstQueryMs: cold.ms, warmQueryMedianMs: median(queryTimes), recommendationMedianMs: median(recommendationTimes),
        oneEditRebuildMs: incremental.ms, reusedDocuments: incremental.value.retrieval!.reusedDocuments, encodedProjectionMiB: encodedBytes / 1024 / 1024,
        heapDeltaMiB: (after.heapUsed - before.heapUsed) / 1024 / 1024, rssMiB: after.rss / 1024 / 1024, node: process.version }) + '\n');
    }
  });
});
