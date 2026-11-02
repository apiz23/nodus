import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildLinkIndex } from '../src/links/link-index.js';
import { graphFromLinkIndex } from '../src/links/graph.js';
import { outgoingLinksForNote } from '../src/links/backlinks.js';
import { graphConnections, graphFolders, visibleGraph } from '../ui/src/graph-model.js';

const NOW = '2026-01-01T00:00:00Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

function note(id: string, title: string, body = '', aliases: string[] = [], path = `notes/${id.slice(0, 8)}.md`) {
  return createNote({ id, title, body, aliases, path, now: NOW });
}

describe('relationship indexing', () => {
  it('resolves title, alias, stable ID, and workspace path links', () => {
    const index = buildLinkIndex([
      note(A, 'Alpha', '[[Alpha]] [[A alias]] [[22222222-2222-4222-8222-222222222222]] [[notes/11111111]] [[notes/22222222.md]]', ['A alias'], 'notes/11111111.md'),
      note(B, 'Beta', '', [], 'notes/22222222.md'),
    ]);
    expect(index.links.map((link) => link.resolution)).toEqual([
      { status: 'resolved', noteId: A },
      { status: 'resolved', noteId: A },
      { status: 'resolved', noteId: B },
      { status: 'resolved', noteId: A },
      { status: 'resolved', noteId: B },
    ]);
  });

  it('prefers title and alias over a path fallback', () => {
    const index = buildLinkIndex([
      note(A, 'Shared', '', [], 'notes/a.md'),
      note(B, 'Other', '', [], 'notes/shared.md'),
    ]);
    const resolution = index.links.length === 0 ? null : index.links[0]?.resolution;
    expect(resolution).toBeNull();
    const withLink = buildLinkIndex([
      note(A, 'Shared', '', [], 'notes/a.md'),
      note(B, 'Other', '[[Shared]]', [], 'notes/shared.md'),
    ]);
    expect(withLink.links[0]?.resolution).toEqual({ status: 'resolved', noteId: A });
  });

  it('does not treat external URLs as internal links', () => {
    const index = buildLinkIndex([note(A, 'Source', '[[https://example.com]] [[mailto:hi@example.com]] [[//cdn.example/x]]')]);
    expect(index.links).toEqual([]);
    expect(index.isolatedNotes.map((entry) => entry.id)).toEqual([A]);
    const graph = graphFromLinkIndex(index);
    expect(graph.unresolvedCount).toBe(0);
    expect(graph.unresolvedLinks).toEqual([]);
  });

  it('handles duplicate links, unresolved targets, and self-references without duplicate edges', () => {
    const notes = [note(A, 'Source', '[[Target]] [[Target|again]] [[Missing]] [[Source]]'), note(B, 'Target')];
    const index = buildLinkIndex(notes);
    const graph = graphFromLinkIndex(index);
    expect(graph.edges).toEqual([
      { sourceId: A, targetId: A, linkCount: 1, snippets: expect.any(Array) },
      { sourceId: A, targetId: B, linkCount: 2, snippets: expect.any(Array) },
    ]);
    expect(graph.unresolvedLinks).toEqual([{
      sourceId: A,
      target: 'Missing',
      linkCount: 1,
      snippets: expect.any(Array),
    }]);
    expect(graph.isolatedNodeIds).toEqual([]);
    const outgoing = outgoingLinksForNote(index, A);
    expect(outgoing.filter((link) => link.selfReference)).toHaveLength(1);
    expect(outgoing.filter((link) => link.resolution.status === 'unresolved')).toHaveLength(1);
  });

  it('detects isolated notes from both directions and excludes self-only links', () => {
    const index = buildLinkIndex([
      note(A, 'Source', ''),
      note(B, 'Target', ''),
      note(C, 'Self', '[[Self]]'),
      note(D, 'Outgoing', '[[Target]]'),
    ]);
    expect(index.isolatedNotes.map((entry) => entry.id)).toEqual([A, C]);
    expect(graphFromLinkIndex(index).isolatedNodeIds).toEqual([A, C]);
  });

  it('keeps ID links stable across rename and move, and drops deleted targets', () => {
    const source = note(A, 'Source', `[[${B}|stable]] [[Old title]] [[notes/old-path]]`);
    const before = buildLinkIndex([source, note(B, 'Old title', '', [], 'notes/old-path.md')]);
    expect(before.links.every((link) => link.resolution.status === 'resolved')).toBe(true);
    const moved = buildLinkIndex([source, note(B, 'New title', '', [], 'archive/new-path.md')]);
    expect(moved.links[0]?.resolution).toEqual({ status: 'resolved', noteId: B });
    expect(moved.links[1]?.resolution.status).toBe('unresolved');
    expect(moved.links[2]?.resolution.status).toBe('unresolved');
    const deleted = buildLinkIndex([source]);
    expect(graphFromLinkIndex(deleted).edges).toEqual([]);
    expect(graphFromLinkIndex(deleted).unresolvedCount).toBe(3);
  });

  it('reports ambiguous ambiguous targets with candidate IDs', () => {
    const index = buildLinkIndex([
      note(A, 'Source', '[[Shared]]'),
      note(B, 'Shared'),
      note(C, 'Shared'),
    ]);
    expect(index.links[0]?.resolution).toEqual({ status: 'ambiguous', noteIds: [B, C] });
    expect(outgoingLinksForNote(index, A)[0]).toMatchObject({
      resolution: { status: 'ambiguous', noteIds: [B, C] },
      candidateIds: [B, C],
      selfReference: false,
    });
  });
});

describe('graph filtering and exploration model', () => {
  const graph = {
    nodes: [
      { id: A, title: 'Alpha', path: 'notes/alpha.md' },
      { id: B, title: 'Beta', path: 'notes/beta.md' },
      { id: C, title: 'Gamma', path: 'archive/gamma.md' },
      { id: D, title: 'Isolated', path: 'archive/isolated.md' },
    ],
    edges: [
      { sourceId: A, targetId: B, linkCount: 2, snippets: ['[[Beta]]'] },
      { sourceId: B, targetId: C, linkCount: 1, snippets: ['[[Gamma]]'] },
    ],
    unresolvedLinks: [{ sourceId: A, target: 'Missing', linkCount: 1, snippets: ['[[Missing]]'] }],
    unresolvedCount: 1,
    ambiguousCount: 0,
    isolatedNodeIds: [D],
  };

  it('lists folders and filters nodes without mutating the source graph', () => {
    expect(graphFolders(graph.nodes)).toEqual(['archive', 'notes']);
    const notesFolder = visibleGraph(graph, '', null, 200, { folder: 'notes', showUnresolved: false });
    expect(notesFolder.nodes.map((node) => node.id).sort()).toEqual([A, B]);
    expect(graph.nodes).toHaveLength(4);
    const archive = visibleGraph(graph, '', null, 200, { folder: 'archive', showUnresolved: false });
    expect(archive.nodes.map((node) => node.id).sort()).toEqual([C, D]);
  });

  it('shows or hides isolated notes and unresolved targets', () => {
    const withoutIsolated = visibleGraph(graph, '', null, 200, { showIsolated: false, showUnresolved: false });
    expect(withoutIsolated.nodes.map((node) => node.id)).not.toContain(D);
    const withUnresolved = visibleGraph(graph, '', null, 200, { showIsolated: true, showUnresolved: true });
    expect(withUnresolved.unresolvedCount).toBe(1);
    expect(withUnresolved.nodes.find((node) => node.unresolved === true)).toMatchObject({ title: 'Missing' });
    expect(withUnresolved.edges.find((edge) => edge.unresolved === true)).toMatchObject({ sourceId: A, targetId: 'unresolved:missing' });
    const withoutUnresolved = visibleGraph(graph, '', null, 200, { showUnresolved: false });
    expect(withoutUnresolved.unresolvedCount).toBe(0);
  });

  it('focuses a one-hop neighborhood and keeps selected edges', () => {
    const focused = visibleGraph(graph, '', A, 200, { showUnresolved: true });
    expect(focused.nodes.map((node) => node.id)).toEqual([A, B, 'unresolved:missing']);
    expect(focused.edges).toHaveLength(2);
    expect(graphConnections(graph.edges, B).incoming.map((edge) => edge.sourceId)).toEqual([A]);
    expect(graphConnections(graph.edges, B).outgoing.map((edge) => edge.targetId)).toEqual([C]);
  });

  it('bounds large graphs and reports truncation deterministically', () => {
    const large = {
      nodes: Array.from({ length: 501 }, (_, index) => ({ id: `id-${index}`, title: `Note ${index}`, path: `folder/${index}.md` })),
      edges: [],
      unresolvedCount: 0,
      ambiguousCount: 0,
      isolatedNodeIds: [],
    };
    const bounded = visibleGraph(large, '', null, 200);
    expect(bounded.nodes).toHaveLength(200);
    expect(bounded.total).toBe(501);
    expect(bounded.truncated).toBe(true);
  });

  it('returns an empty result for a query with no matches', () => {
    const empty = visibleGraph(graph, 'nothing-matches', null, 200, { showUnresolved: false });
    expect(empty.nodes).toEqual([]);
    expect(empty.edges).toEqual([]);
    expect(empty.truncated).toBe(false);
  });
});
