import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildLinkIndex } from '../src/links/link-index.js';
import { graphFromLinkIndex } from '../src/links/graph.js';

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
  const results: Array<{ notes: number; links: number; edges: number; unresolved: number; isolated: number; medianMs: number; indexMs: number; graphMs: number }> = [];
  for (const size of [1000, 5000]) {
    const notes = dataset(size);
    buildLinkIndex(notes); // Warm parser/module paths.
    const durations: number[] = [];
    const indexDurations: number[] = [];
    const graphDurations: number[] = [];
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
    });
  }
  expect(results).toHaveLength(2);
  console.log(JSON.stringify({ node: process.version, method: '5-run median after one warm-up; parse/index plus graph projection only, no filesystem or UI', results }, null, 2));
}, 120_000);
