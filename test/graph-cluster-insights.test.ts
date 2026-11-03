import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildLinkIndex } from '../src/links/link-index.js';
import { graphFromLinkIndex } from '../src/links/graph.js';
import { analyzeGraph } from '../src/links/graph-analytics.js';
import { graphClusterInsights } from '../src/links/graph-cluster-insights.js';

const NOW = '2026-11-03T00:00:00Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';
const note = (id: string, title: string, body = '', path = `${title.toLowerCase()}.md`) => createNote({ id, title, body, path, now: NOW });

describe('cluster insights', () => {
  it('measures internal connectivity, density, entries, and exits', () => {
    const graph = graphFromLinkIndex(buildLinkIndex([
      note(A, 'Alpha', '[[Bravo]]'),
      note(B, 'Bravo', '[[Charlie]] [[Charlie|again]]'),
      note(C, 'Charlie', ''),
      note(D, 'Delta', ''),
      note(E, 'Echo', ''),
    ]));
    const analytics = analyzeGraph(graph);
    const clusterId = analytics.components.find((component) => component.size === 3)!.id;
    const insights = graphClusterInsights(graph, analytics, clusterId);
    expect(insights).toMatchObject({
      memberCount: 3,
      internalEdges: 2,
      internalLinkOccurrences: 3,
      externalIncomingEdges: 0,
      externalOutgoingEdges: 0,
      density: 0.3333,
    });
    expect(insights?.entryNotes.map((item) => item.note.id)).toEqual([A]);
    expect(insights?.exitNotes.map((item) => item.note.id)).toEqual([C]);
    expect(insights?.mostConnected[0]?.id).toBe(B);
  });

  it('handles singleton clusters and missing IDs', () => {
    const graph = graphFromLinkIndex(buildLinkIndex([note(A, 'Alpha'), note(B, 'Beta')]));
    const analytics = analyzeGraph(graph);
    const singleton = analytics.components[0]!;
    expect(graphClusterInsights(graph, analytics, singleton.id)).toMatchObject({
      memberCount: 1, internalEdges: 0, internalLinkOccurrences: 0, density: 0, externalIncomingEdges: 0, externalOutgoingEdges: 0,
    });
    expect(graphClusterInsights(graph, analytics, 'missing')).toBeUndefined();
  });
});
