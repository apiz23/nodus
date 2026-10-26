import { describe, expect, it } from 'vitest';
import { createNote, type Note } from '../src/domain/note.js';
import { createBacklinkIndex, snippetAround } from '../src/links/backlinks.js';

const NOW = '2026-01-01T00:00:00Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

function note(id: string, title: string, body: string, aliases: string[] = []): Note {
  return { ...createNote({ id, title, path: `notes/${title.toLowerCase().replace(/\s+/g, '-')}.md`, body, now: NOW }), aliases };
}

describe('backlink index', () => {
  it('collects a confirmed backlink with stable source ID and current title', () => {
    const index = createBacklinkIndex();
    const notes = [note(A, 'Target', 'content'), note(B, 'Source', 'See [[Target]].')];
    index.rebuild(notes);
    expect(index.getBacklinks(A, notes)).toEqual([
      { sourceId: B, sourceTitle: 'Source', snippet: 'See [[Target]].', count: 1, ambiguous: false },
    ]);
    expect(index.getBacklinks(B, notes)).toEqual([]);
  });

  it('aggregates multiple links from one source into a single entry with count', () => {
    const index = createBacklinkIndex();
    const notes = [
      note(A, 'Target', ''),
      note(B, 'Source', 'A [[Target]] and another [[Target]] link.'),
    ];
    index.rebuild(notes);
    const backlinks = index.getBacklinks(A, notes);
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]).toMatchObject({ sourceId: B, count: 2, ambiguous: false });
  });

  it('excludes links inside inline code and fenced code blocks', () => {
    const index = createBacklinkIndex();
    const notes = [
      note(A, 'Target', ''),
      note(B, 'Source', 'Use `[[Target]]` inline.\n\n```\n[[Target]]\n```\n\n~~~\n[[Target]]\n~~~\n\nReal: [[Target]]'),
    ];
    index.rebuild(notes);
    const backlinks = index.getBacklinks(A, notes);
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]?.count).toBe(1);
  });

  it('omits unresolved links entirely', () => {
    const index = createBacklinkIndex();
    const notes = [note(A, 'Target', ''), note(B, 'Source', 'Links [[Nowhere]].')];
    index.rebuild(notes);
    expect(index.getBacklinks(A, notes)).toEqual([]);
  });

  it('reports ambiguous links under every candidate and never as confirmed', () => {
    const index = createBacklinkIndex();
    const notes = [
      note(A, 'Duplicated', ''),
      note(B, 'Duplicated', ''),
      note(C, 'Source', 'Points at [[Duplicated]].'),
    ];
    index.rebuild(notes);
    for (const target of [A, B]) {
      expect(index.getBacklinks(target, notes)).toEqual([
        { sourceId: C, sourceTitle: 'Source', snippet: 'Points at [[Duplicated]].', count: 1, ambiguous: true },
      ]);
    }
    expect(index.getBacklinks(C, notes)).toEqual([]);
  });

  it('mixing ambiguous and confirmed links keeps each pair classified correctly', () => {
    const index = createBacklinkIndex();
    const notes = [
      note(A, 'Unique', ''),
      note(B, 'Shared', ''),
      note(C, 'Shared', ''),
      note(D, 'Source', 'One [[Unique]] and one [[Shared]].'),
    ];
    index.rebuild(notes);
    // Link to A resolves uniquely: confirmed backlink.
    expect(index.getBacklinks(A, notes)[0]).toMatchObject({ sourceId: D, count: 1, ambiguous: false });
    // Link to "Shared" is ambiguous: flagged for both candidates.
    expect(index.getBacklinks(B, notes)[0]).toMatchObject({ ambiguous: true });
    expect(index.getBacklinks(C, notes)[0]).toMatchObject({ ambiguous: true });
  });

  it('resolves aliases and UUID-pinned targets', () => {
    const index = createBacklinkIndex();
    const notes = [
      note(A, 'Real title', '', ['Alias']),
      note(B, 'Source', `Ref [[Alias]] and [[${A}|pinned]].`),
    ];
    index.rebuild(notes);
    const backlinks = index.getBacklinks(A, notes);
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]?.count).toBe(2);
  });

  it('a note never backlinks itself', () => {
    const index = createBacklinkIndex();
    const notes = [note(A, 'Self', 'Points at [[Self]].')];
    index.rebuild(notes);
    expect(index.getBacklinks(A, notes)).toEqual([]);
  });

  it('rebuild refreshes stale entries after mutations', () => {
    const index = createBacklinkIndex();
    const before = [note(A, 'Target', ''), note(B, 'Source', 'See [[Target]].')];
    index.rebuild(before);
    expect(index.getBacklinks(A, before)).toHaveLength(1);

    const after = [note(A, 'Target', ''), note(B, 'Renamed source', 'No link anymore.')];
    index.markDirty();
    expect(index.getBacklinks(A, after)).toEqual([]);

    index.markDirty();
    const relinked = [note(A, 'Target', ''), note(B, 'Renamed source', 'Back to [[Target]].')];
    expect(index.getBacklinks(A, relinked)).toHaveLength(1);
  });

  it('rebuild from scratch equals incremental results (restart recovery)', () => {
    const fresh = createBacklinkIndex();
    const notes = [note(A, 'Target', ''), note(B, 'Source', 'See [[Target]].')];
    fresh.rebuild(notes);
    expect(fresh.getBacklinks(A, notes)).toEqual([
      { sourceId: B, sourceTitle: 'Source', snippet: 'See [[Target]].', count: 1, ambiguous: false },
    ]);
  });

  it('handles empty vaults', () => {
    const index = createBacklinkIndex();
    index.rebuild([]);
    expect(index.getBacklinks(A, [])).toEqual([]);
  });
});

describe('snippetAround', () => {
  it('centers context on the link and compacts whitespace', () => {
    const body = 'Intro line.\n\nA    link [[Target]] here with trailing text.';
    const snippet = snippetAround(body, body.indexOf('[['), body.indexOf(']]') + 2);
    expect(snippet).toBe('Intro line. A link [[Target]] here with trailing text.');
  });

  it('adds ellipses when truncated', () => {
    const filler = 'x'.repeat(300);
    const body = `${filler} [[Target]] ${filler}`;
    const snippet = snippetAround(body, body.indexOf('[['), body.indexOf(']]') + 2);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });
});
