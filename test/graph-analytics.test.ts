import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildLinkIndex } from '../src/links/link-index.js';
import { graphFromLinkIndex } from '../src/links/graph.js';
import { analyzeGraph } from '../src/links/graph-analytics.js';

const NOW = '2026-11-03T00:00:00Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';
const F = '66666666-6666-4666-8666-666666666666';
const G = '77777777-7777-4777-8777-777777777777';

const note = (id: string, title: string, body = '', path = `${title.toLowerCase().replace(/\s+/g, '-')}.md`, aliases: string[] = []) =>
  createNote({ id, title, body, path, aliases, now: NOW });

function candidate(title: string, body: string, path: string) {
  return { title: `${title} (${path})`, path, body, __candidate: true };
}

describe('graph analytics', () => {
  it('computes distinct-neighbour degrees, components, and deterministic totals', () => {
    const graph = graphFromLinkIndex(buildLinkIndex([
      note(A, 'Alpha', '[[Beta]] [[Beta|again]] [[Alpha]] [[Missing]]'),
      note(B, 'Beta', '[[Gamma]]'),
      note(C, 'Gamma', '[[Alpha]]'),
      note(D, 'Delta'),
      note(E, 'Epsilon', '[[Shared]]'),
      note(F, 'Shared', '', 'shared-1.md'),
      note(G, 'Shared', '', 'shared-2.md'),
    ]));
    const analytics = analyzeGraph(graph, { mostConnectedLimit: 3 });

    expect(analytics).toMatchObject({
      totalNotes: 7,
      linkedNotes: 3,
      isolatedNotes: 4,
      unresolvedLinks: 1,
      ambiguousLinks: 1,
      selfLinkEdges: 1,
      selfLinkOccurrences: 1,
      componentCount: 5,
      largestComponentSize: 3,
    });
    expect(analytics.noteMetrics.find((metric) => metric.id === A)).toMatchObject({
      incoming: 1,
      outgoing: 1,
      degree: 2,
      degreeCentrality: 2 / 6,
    });
    expect(analytics.mostConnected.map((metric) => metric.id)).toEqual([A, B, C]);
    expect(analytics.components[0]).toMatchObject({ id: A, size: 3 });
    expect(analytics.components[0]?.members.map((member) => member.id)).toEqual([A, B, C]);
  });

  it('handles empty graphs and singleton components deterministically', () => {
    const empty = analyzeGraph({ nodes: [], edges: [], unresolvedCount: 0, ambiguousCount: 0 });
    expect(empty).toMatchObject({ totalNotes: 0, linkedNotes: 0, isolatedNotes: 0, componentCount: 0, largestComponentSize: 0 });
    expect(empty.mostConnected).toEqual([]);
    expect(empty.components).toEqual([]);

    const graph = graphFromLinkIndex(buildLinkIndex([note(C, 'Gamma'), note(A, 'Alpha'), note(B, 'Beta')]));
    const analytics = analyzeGraph(graph);
    expect(analytics.components.map((component) => component.size)).toEqual([1, 1, 1]);
    expect(analytics.components.map((component) => component.representative.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(analytics.isolatedNotes).toBe(3);
  });

  it('does not count duplicate occurrences or unresolved/ambiguous links as degree', () => {
    const graph = graphFromLinkIndex(buildLinkIndex([
      note(A, 'Source', '[[Target]] [[Target|again]] [[Target|third]] [[Missing]] [[Shared]]'),
      note(B, 'Target'),
      note(C, 'Shared'),
      note(D, 'Shared', '', 'shared.md'),
    ]));
    const analytics = analyzeGraph(graph);
    expect(analytics.linkedNotes).toBe(2);
    expect(analytics.noteMetrics.find((metric) => metric.id === B)).toMatchObject({ incoming: 1, outgoing: 0, degree: 1 });
    expect(analytics.noteMetrics.find((metric) => metric.id === A)).toMatchObject({ incoming: 0, outgoing: 1, degree: 1 });
    expect(analytics.unresolvedLinks).toBe(1);
    expect(analytics.ambiguousLinks).toBe(1);
  });
});
