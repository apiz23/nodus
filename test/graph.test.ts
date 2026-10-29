import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { graphFromLinkIndex } from '../src/links/graph.js';
import { buildLinkIndex } from '../src/links/link-index.js';
import { graphConnections, positionGraph, visibleGraph } from '../ui/src/graph-model.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const now = '2026-10-29T00:00:00Z';
function note(id: string, title: string, body = '', aliases: string[] = [], path = `${id}.md`) {
  return createNote({ id, title, body, aliases, path, now });
}

describe('local note graph projection', () => {
  it('maps stable note IDs to directed resolved edges, aggregating duplicate wiki links', () => {
    const notes = [note(A, 'Alpha', '[[Beta]] [[Beta|again]] [[Bee]]', ['A']), note(B, 'Beta', '', ['Bee']), note(C, 'Gamma', `[[${B}]]`)];
    const graph = graphFromLinkIndex(buildLinkIndex(notes));
    expect(graph.nodes.map((node) => node.id)).toEqual([A, B, C]);
    expect(graph.edges).toEqual([
      { sourceId: A, targetId: B, linkCount: 3, snippets: expect.any(Array) },
      { sourceId: C, targetId: B, linkCount: 1, snippets: expect.any(Array) },
    ]);
    expect(graphConnections(graph.edges, B).incoming.map((edge) => edge.sourceId)).toEqual([A, C]);
    expect(graphConnections(graph.edges, B).outgoing).toEqual([]);
  });

  it('keeps self-links, excludes unresolved and deleted targets, and does not infer title similarity', () => {
    const source = note(A, 'Alpha', `[[Alpha]] [[Missing]] [[${D}]] [[Alphabet]] [[Shared]]`);
    const graph = graphFromLinkIndex(buildLinkIndex([source, note(B, 'Shared'), note(C, 'Shared')]));
    expect(graph.edges.map(({ sourceId, targetId }) => [sourceId, targetId])).toEqual([[A, A]]);
    expect(graph.unresolvedCount).toBe(3);
    expect(graph.ambiguousCount).toBe(1);
  });

  it('preserves ID-pinned edges across title and path changes and drops links when a note is deleted', () => {
    const source = note(A, 'Source', `[[${B}|stable]]`);
    const target = note(B, 'Before');
    const before = graphFromLinkIndex(buildLinkIndex([source, target]));
    const renamed = graphFromLinkIndex(buildLinkIndex([source, note(B, 'After', '', [], 'new/place.md')]));
    expect(renamed.nodes.find((node) => node.id === B)).toMatchObject({ title: 'After', path: 'new/place.md' });
    expect(renamed.edges[0]?.targetId).toBe(B);
    expect(before.edges[0]?.targetId).toBe(renamed.edges[0]?.targetId);
    const deleted = graphFromLinkIndex(buildLinkIndex([source]));
    expect(deleted.edges).toEqual([]);
    expect(deleted.unresolvedCount).toBe(1);
  });

  it('filters by title and path, focuses on one-hop neighbors and bounds displayed nodes for large vaults', () => {
    const nodes = Array.from({ length: 501 }, (_, i) => ({ id: `${i}`, title: `Note ${i}`, path: `folder/${i}.md` }));
    const edges = [{ sourceId: '0', targetId: '1', linkCount: 1, snippets: [] }, { sourceId: '2', targetId: '0', linkCount: 1, snippets: [] }];
    const graph = { nodes, edges, unresolvedCount: 0, ambiguousCount: 0 };
    expect(visibleGraph(graph, 'folder/4.md', null).nodes.map((node) => node.id)).toEqual(['4']);
    const focused = visibleGraph(graph, '', '0');
    expect(focused.nodes.map((node) => node.id)).toEqual(['0', '1', '2']);
    expect(focused.edges).toHaveLength(2);
    const bounded = visibleGraph(graph, '', null, 200);
    expect(bounded.nodes).toHaveLength(200);
    expect(bounded.truncated).toBe(true);
    const positions = positionGraph(focused.nodes, '0');
    expect(positions.find((node) => node.id === '0')).toMatchObject({ x: 500, y: 320 });
  });
});
