import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildLinkIndex } from '../src/links/link-index.js';
import { graphFromLinkIndex } from '../src/links/graph.js';
import { relatedNotes } from '../src/links/related-notes.js';

const NOW = '2026-11-03T00:00:00Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';
const note = (id: string, title: string, body: string, path: string, aliases: string[] = []) =>
  createNote({ id, title, body, path, aliases, now: NOW });

function index() {
  const notes = [
    note(A, 'Knowledge graph', '[[Graph notes]] [[Shared target]]', 'notes/a.md', ['Graph map']),
    note(B, 'Graph notes', '[[Pizza]] [[Shared target]]', 'notes/b.md'),
    note(C, 'Pizza', '[[Shared target]]', 'notes/c.md'),
    note(D, 'Shared target', '[[Knowledge graph]] [[Graph notes]]', 'other/d.md'),
    note(E, 'Knowledge map', '[[Graph notes]]', 'notes/e.md'),
  ];
  return { linkIndex: buildLinkIndex(notes), graph: graphFromLinkIndex(buildLinkIndex(notes)) };
}

describe('related notes', () => {
  it('explains link, lexical, and folder evidence deterministically', () => {
    const { linkIndex, graph } = index();
    const related = relatedNotes(linkIndex, graph, A, { limit: 6 });
    expect(related.map((item) => item.note.id)).not.toContain(A);
    expect(new Set(related.map((item) => item.note.id)).size).toBe(related.length);
    expect(related[0]?.note.id).toBe(B);
    expect(related[0]?.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'shared-outgoing', count: 1 }),
      expect.objectContaining({ code: 'similar-title' }),
      expect.objectContaining({ code: 'same-folder' }),
    ]));
    expect(related.every((item) => item.score > 0)).toBe(true);
    expect(related.map((item) => item.note.id)).toEqual([...related].sort((left, right) =>
      right.score - left.score || left.note.title.localeCompare(right.note.title) || left.note.path.localeCompare(right.note.path) || left.note.id.localeCompare(right.note.id),
    ).map((item) => item.note.id));
  });

  it('returns bounded, empty, and deleted-safe results', () => {
    const { linkIndex, graph } = index();
    expect(relatedNotes(linkIndex, graph, A, { limit: 1 })).toHaveLength(1);
    expect(relatedNotes(linkIndex, graph, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toEqual([]);
    const deleted = graphFromLinkIndex(buildLinkIndex([note(A, 'Knowledge graph', '[[Missing]]', 'notes/a.md')]));
    expect(relatedNotes(buildLinkIndex([note(A, 'Knowledge graph', '[[Missing]]', 'notes/a.md')]), deleted, A)).toEqual([]);
  });
});
