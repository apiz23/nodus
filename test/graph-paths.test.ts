import { describe, expect, it } from 'vitest';
import { shortestGraphPath } from '../src/links/graph-paths.js';
import type { NoteGraph } from '../src/links/graph.js';

const node = (id: string, title = id, path = `${id}.md`) => ({ id, title, path });
const edge = (sourceId: string, targetId: string, linkCount = 1) => ({ sourceId, targetId, linkCount, snippets: [] });
const graph: NoteGraph = {
  nodes: [node('A', 'Alpha'), node('B', 'Bravo'), node('C', 'Charlie'), node('D', 'Delta'), node('E', 'Echo'), node('F', 'Foxtrot')],
  edges: [edge('A', 'B'), edge('A', 'C'), edge('B', 'D'), edge('C', 'D'), edge('D', 'E'), edge('A', 'A')],
  unresolvedCount: 0,
  ambiguousCount: 0,
};

describe('shortest graph path', () => {
  it('returns the deterministic actual note and edge sequence', () => {
    const result = shortestGraphPath(graph, 'A', 'D');
    expect(result.status).toBe('found');
    expect(result.nodes.map((item) => item.id)).toEqual(['A', 'B', 'D']);
    expect(result.edges.map((item) => [item.sourceId, item.targetId])).toEqual([['A', 'B'], ['B', 'D']]);
  });

  it('handles same, missing, disconnected, self-links, and traversal modes', () => {
    expect(shortestGraphPath(graph, 'A', 'A')).toMatchObject({ status: 'same-node', nodes: [{ id: 'A' }], edges: [] });
    expect(shortestGraphPath(graph, 'A', 'Z')).toMatchObject({ status: 'missing', nodes: [] });
    expect(shortestGraphPath(graph, 'A', 'F')).toMatchObject({ status: 'disconnected', nodes: [] });
    expect(shortestGraphPath(graph, 'E', 'A')).toMatchObject({ status: 'disconnected' });
    expect(shortestGraphPath(graph, 'E', 'A', { mode: 'undirected' })).toMatchObject({
      status: 'found',
      nodes: [{ id: 'E' }, { id: 'D' }, { id: 'B' }, { id: 'A' }],
      mode: 'undirected',
    });
  });

  it('respects depth and visited-node bounds without looping', () => {
    expect(shortestGraphPath(graph, 'A', 'E', { maxDepth: 1 })).toMatchObject({ status: 'limit' });
    expect(shortestGraphPath(graph, 'A', 'E', { maxVisited: 2 })).toMatchObject({ status: 'limit' });
    const cycle: NoteGraph = { nodes: [node('A'), node('B')], edges: [edge('A', 'B'), edge('B', 'A')], unresolvedCount: 0, ambiguousCount: 0 };
    expect(shortestGraphPath(cycle, 'A', 'B')).toMatchObject({ status: 'found', nodes: [{ id: 'A' }, { id: 'B' }] });
  });
});
