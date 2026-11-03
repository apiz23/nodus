import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildSearchIndex, searchIndex } from '../src/search/search-index.js';
import { parseSearchQuery, SearchSyntaxError } from '../src/search/query.js';

const note = (id: number, title: string, path: string, updatedAt: string, body = '', tags: string[] = [], aliases: string[] = []) => ({
  ...createNote({ id: `${String(id).padStart(8, '0')}-1111-4111-8111-111111111111`, title, path, body, tags, aliases, now: '2026-01-01T00:00:00Z' }), updatedAt,
});

describe('advanced search query grammar', () => {
  it('parses free text, quoted phrases, and repeatable operators', () => {
    expect(parseSearchQuery('weekly "design review" tag:research folder:"Project Notes" before:2026-02-01')).toEqual({
      raw: 'weekly "design review" tag:research folder:"Project Notes" before:2026-02-01',
      text: ['weekly', 'design review'], constraints: [
        { operator: 'tag', value: 'research', start: 23, end: 35 }, { operator: 'folder', value: 'Project Notes', start: 36, end: 58 }, { operator: 'before', value: '2026-02-01', start: 59, end: 76 },
      ],
    });
    expect(parseSearchQuery('foo bar').text).toEqual(['foo bar']);
  });

  it('rejects malformed syntax with useful errors and offsets', () => {
    for (const query of ['tag:', 'what:ever', 'title:"unfinished', 'before:2026-02-30', 'type:database', 'title:"a"tail']) {
      expect(() => parseSearchQuery(query), query).toThrow(SearchSyntaxError);
    }
  });

  it('combines constraints with AND and scopes title, alias, path, tags and dates', () => {
    const docs = [
      note(1, 'Weekly review', 'Projects/Weekly.md', '2026-02-01T00:00:00Z', 'design planning', ['Research'], ['Review notes']),
      note(2, 'Weekly review', 'Archive/Weekly.md', '2025-12-01T00:00:00Z', 'design planning', ['research']),
      note(3, 'Other', 'Projects/Other.md', '2026-01-01T00:00:00Z', 'weekly design', ['Research']),
    ];
    const index = buildSearchIndex(docs);
    expect(searchIndex(index, 'weekly folder:Projects tag:research').map((item) => item.id)).toEqual([docs[0]!.id, docs[2]!.id]);
    expect(searchIndex(index, 'title:weekly alias:"review notes"').map((item) => item.id)).toEqual([docs[0]!.id]);
    expect(searchIndex(index, 'path:Archive before:2026-01-01').map((item) => item.id)).toEqual([docs[1]!.id]);
    expect(searchIndex(index, 'weekly "design" type:note').map((item) => item.id)).toHaveLength(3);
    expect(searchIndex(index, 'tag:research folder:Archive').map((item) => item.id)).toEqual([docs[1]!.id]);
  });

  it('filters creation and modification dates with strict calendar-date boundaries', () => {
    const older = { ...note(1, 'Older', 'older.md', '2026-03-15T00:00:00Z'), createdAt: '2025-12-31T23:00:00Z' };
    const newer = { ...note(2, 'Newer', 'newer.md', '2026-04-01T00:00:00Z'), createdAt: '2026-03-01T00:00:00Z' };
    const index = buildSearchIndex([older, newer]);
    expect(searchIndex(index, 'created-before:2026-01-01').map((item) => item.id)).toEqual([older.id]);
    expect(searchIndex(index, 'created-after:2026-01-01').map((item) => item.id)).toEqual([newer.id]);
    expect(searchIndex(index, 'modified-before:2026-04-01').map((item) => item.id)).toEqual([older.id]);
    expect(searchIndex(index, 'modified-after:2026-03-15').map((item) => item.id)).toEqual([newer.id]);
    expect(searchIndex(index, 'after:2026-03-15').map((item) => item.id)).toEqual([newer.id]);
  });

  it('keeps exact title ranking above aliases and partial/content matches', () => {
    const docs = [note(1, 'Planning', 'a.md', '2026-01-01T00:00:00Z'), note(2, 'Other', 'b.md', '2026-01-01T00:00:00Z', '', [], ['Planning']), note(3, 'Planning ideas', 'c.md', '2026-01-01T00:00:00Z')];
    expect(searchIndex(buildSearchIndex(docs), 'planning').map((item) => item.id)).toEqual(docs.map((item) => item.id));
  });
});
