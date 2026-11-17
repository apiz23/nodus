import { describe, expect, it } from 'vitest';
import type { NoteGraph } from '../src/links/graph.js';
import { graphMetrics, graphNeighborhood, positionGraph, visibleGraph } from '../ui/src/graph-model.js';
import { nearestGraphNode } from '../ui/src/graph-keyboard.js';

const graph: NoteGraph = {
  nodes: [
    { id: 'a', title: 'Alpha', path: 'notes/alpha.md' },
    { id: 'b', title: 'Beta', path: 'notes/beta.md' },
    { id: 'c', title: 'Gamma', path: 'notes/gamma.md' },
    { id: 'd', title: 'Delta', path: 'notes/delta.md' },
    { id: 'e', title: 'Echo', path: 'notes/echo.md' },
  ],
  edges: [
    { sourceId: 'a', targetId: 'b', linkCount: 3, snippets: ['[[Beta]]'] },
    { sourceId: 'b', targetId: 'c', linkCount: 1, snippets: ['[[Gamma]]'] },
    { sourceId: 'c', targetId: 'd', linkCount: 1, snippets: ['[[Delta]]'] },
    { sourceId: 'b', targetId: 'b', linkCount: 1, snippets: ['[[Beta]]'] },
  ],
  unresolvedLinks: [{ sourceId: 'a', target: 'Missing', linkCount: 2, snippets: ['[[Missing]]'] }],
  unresolvedCount: 2,
  ambiguousCount: 0,
  isolatedNodeIds: ['e'],
};

describe('graph interaction model', () => {
  it('derives degrees without counting duplicate occurrences or self-links', () => {
    const metrics = graphMetrics(graph);
    expect(metrics.degree.get('b')).toBe(2);
    expect(metrics.degree.get('a')).toBe(1);
    expect(metrics.incoming.get('b')).toBe(1);
    expect(metrics.outgoing.get('a')).toBe(1);
    expect(metrics.orphanIds.has('a')).toBe(true);
    expect(metrics.isolatedIds.has('e')).toBe(true);
    expect(metrics.unresolvedBySource.get('a')).toEqual({ targets: 1, occurrences: 2 });
  });

  it('walks neighbourhood depth and respects direction', () => {
    const two = graphNeighborhood(graph, 'a', 2);
    expect([...two.distanceById.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(two.distanceById.get('c')).toBe(2);
    expect(two.parentById.get('c')).toBe('b');
    const outgoing = graphNeighborhood(graph, 'b', 2, 'outgoing');
    expect([...outgoing.distanceById.keys()].sort()).toEqual(['b', 'c', 'd']);
    const incoming = graphNeighborhood(graph, 'b', 1, 'incoming');
    expect([...incoming.distanceById.keys()].sort()).toEqual(['a', 'b']);
  });

  it('filters by connection count, orphans, depth and pins ensured notes before the limit', () => {
    const connected = visibleGraph(graph, '', null, 200, { minConnections: 2, showUnresolved: false });
    expect(connected.nodes.map((node) => node.id)).toEqual(['b', 'c']);
    const orphans = visibleGraph(graph, '', null, 200, { orphanOnly: true, showUnresolved: false });
    expect(orphans.nodes.map((node) => node.id)).toEqual(['a', 'e']);
    const depth = visibleGraph(graph, '', 'a', 200, { focusDepth: 2, showUnresolved: false });
    expect(depth.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(depth.distanceById.get('c')).toBe(2);
    const pinned = visibleGraph(graph, '', null, 1, { ensureIds: ['e'], showUnresolved: false });
    expect(pinned.nodes.map((node) => node.id)).toEqual(['e']);
    expect(pinned.hiddenByLimit).toBe(4);
  });

  it('keeps one-shot topology layout deterministic and collision-free', () => {
    const nodes = Array.from({ length: 60 }, (_, index) => ({ id: `n${index}`, title: `Note ${String(index).padStart(2, '0')}`, path: `notes/${index}.md` }));
    const edges = nodes.slice(1).map((node, index) => ({ sourceId: nodes[index]!.id, targetId: node.id, linkCount: 1, snippets: [] }));
    const first = positionGraph(nodes, null, 1000, 640, { edges, clusterByNode: new Map(), isolatedNodeIds: new Set() });
    const second = positionGraph(nodes, null, 1000, 640, { edges, clusterByNode: new Map(), isolatedNodeIds: new Set() });
    expect(first).toEqual(second);
    expect(first.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
    let minimum = Infinity;
    for (let left = 0; left < first.length; left += 1) {
      for (let right = left + 1; right < first.length; right += 1) {
        minimum = Math.min(minimum, Math.hypot(first[left]!.x - first[right]!.x, first[left]!.y - first[right]!.y));
      }
    }
    expect(minimum).toBeGreaterThan(10);
  });

  it('moves keyboard focus through the nearest node in a direction', () => {
    const nodes = [
      { id: 'center', x: 0, y: 0 },
      { id: 'right', x: 100, y: 10 },
      { id: 'left', x: -100, y: 0 },
      { id: 'up', x: 10, y: -100 },
      { id: 'down', x: 0, y: 100 },
    ];
    expect(nearestGraphNode(nodes[0]!, nodes, 'ArrowRight')).toBe('right');
    expect(nearestGraphNode(nodes[0]!, nodes, 'ArrowLeft')).toBe('left');
    expect(nearestGraphNode(nodes[0]!, nodes, 'ArrowUp')).toBe('up');
    expect(nearestGraphNode(nodes[0]!, nodes, 'ArrowDown')).toBe('down');
  });
});
