import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildLinkIndex } from '../src/links/link-index.js';
import { graphFromLinkIndex } from '../src/links/graph.js';
import { analyzeGraph } from '../src/links/graph-analytics.js';
import { relatedNotes } from '../src/links/related-notes.js';
import { createLinkSuggester } from '../src/links/link-repair.js';

const makeId = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function dataset(size: number) {
  return Array.from({ length: size }, (_, index) => {
    const target = makeId((index + 1) % size);
    return createNote({
      id: makeId(index + 1),
      title: `Graph note ${index + 1}`,
      path: `folder-${index % 20}/note-${index + 1}.md`,
      body: `[[Graph note ${((index + 1) % size) + 1}]] [[${target}|pinned]] [[Missing ${index % 7}]]`,
      now: '2026-11-01T00:00:00Z',
    });
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

it('measures relationship indexing and graph projection at realistic vault sizes', () => {
  const results: Array<{ notes: number; links: number; edges: number; unresolved: number; isolated: number; medianMs: number; indexMs: number; graphMs: number; analyticsMs: number }> = [];
  for (const size of [1000, 5000]) {
    const notes = dataset(size);
    buildLinkIndex(notes); // Warm parser/module paths.
    const durations: number[] = [];
    const indexDurations: number[] = [];
    const graphDurations: number[] = [];
    const analyticsDurations: number[] = [];
    let links = 0;
    let edges = 0;
    let unresolved = 0;
    let isolated = 0;
    for (let run = 0; run < 5; run += 1) {
      const start = performance.now();
      const indexStart = performance.now();
      const index = buildLinkIndex(notes);
      indexDurations.push(performance.now() - indexStart);
      const graphStart = performance.now();
      const graph = graphFromLinkIndex(index);
      graphDurations.push(performance.now() - graphStart);
      const analyticsStart = performance.now();
      analyzeGraph(graph);
      analyticsDurations.push(performance.now() - analyticsStart);
      durations.push(performance.now() - start);
      links = index.links.length;
      edges = graph.edges.length;
      unresolved = graph.unresolvedCount;
      isolated = graph.isolatedNodeIds?.length ?? 0;
    }
    results.push({
      notes: size,
      links,
      edges,
      unresolved,
      isolated,
      medianMs: Number(median(durations).toFixed(2)),
      indexMs: Number(median(indexDurations).toFixed(2)),
      graphMs: Number(median(graphDurations).toFixed(2)),
      analyticsMs: Number(median(analyticsDurations).toFixed(2)),
    });
  }
  expect(results).toHaveLength(2);
  console.log(JSON.stringify({ node: process.version, method: '5-run median after one warm-up; parse/index, graph projection, and analytics only, no filesystem or UI', results }, null, 2));
}, 120_000);

it('measures repair-suggestion ranking for unique and repeated broken targets', () => {
  const results: Array<{ notes: number; uniqueTargets: number; uniqueMedianMs: number; perTargetMs: number; repeatedMedianMs: number }> = [];
  for (const size of [1000, 5000]) {
    const notes = dataset(size);
    const suggester = createLinkSuggester(notes);
    const uniqueTargets = Array.from({ length: size >= 5000 ? 500 : 250 }, (_, index) => `Graph ntoe ${index + 1} typo`);
    suggester.suggest(uniqueTargets[0] ?? 'warmup');
    const uniqueDurations: number[] = [];
    const repeatedDurations: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const uniqueStart = performance.now();
      for (const target of uniqueTargets) suggester.suggest(target, { limit: 3 });
      uniqueDurations.push(performance.now() - uniqueStart);

      const repeatedStart = performance.now();
      for (let index = 0; index < uniqueTargets.length; index += 1) {
        suggester.suggest('Missing 3', { limit: 3 });
      }
      repeatedDurations.push(performance.now() - repeatedStart);
    }
    const uniqueMedian = median(uniqueDurations);
    results.push({
      notes: size,
      uniqueTargets: uniqueTargets.length,
      uniqueMedianMs: Number(uniqueMedian.toFixed(2)),
      perTargetMs: Number((uniqueMedian / uniqueTargets.length).toFixed(3)),
      repeatedMedianMs: Number(median(repeatedDurations).toFixed(2)),
    });
  }
  expect(results).toHaveLength(2);
  console.log(JSON.stringify({ node: process.version, method: '5-run median after one warm-up; suggestion ranking only, no filesystem or API serialization', results }, null, 2));
}, 120_000);


it('measures related-note recommendations over a derived snapshot', () => {
  const results: Array<{ notes: number; samples: number; medianMs: number; perNoteMs: number }> = [];
  for (const size of [1000, 5000]) {
    const notes = dataset(size);
    const index = buildLinkIndex(notes);
    const graph = graphFromLinkIndex(index);
    const sampleIds = index.notes.slice(0, 100).map((note) => note.id);
    relatedNotes(index, graph, sampleIds[0]!, { limit: 6 });
    const durations: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const start = performance.now();
      for (const id of sampleIds) relatedNotes(index, graph, id, { limit: 6 });
      durations.push(performance.now() - start);
    }
    const value = median(durations);
    results.push({ notes: size, samples: sampleIds.length, medianMs: Number(value.toFixed(2)), perNoteMs: Number((value / sampleIds.length).toFixed(3)) });
  }
  expect(results).toHaveLength(2);
  console.log(JSON.stringify({ node: process.version, method: '5-run median for 100 source notes with limit 6 over an already-built index and graph', results }, null, 2));
}, 120_000);
