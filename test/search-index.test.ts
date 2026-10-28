import { describe, expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { createSnapshotCache } from '../src/indexing/snapshot-cache.js';
import { buildSearchIndex, searchIndex } from '../src/search/search-index.js';
const now = '2026-10-28T00:00:00Z';
const note = (number: number, title: string, body = '', aliases: string[] = []) => createNote({
  id: `${String(number).padStart(8, '0')}-1111-4111-8111-111111111111`,
  title, body, aliases, path: `notes/${number}.md`, now,
});

describe('derived global search index', () => {
  it('ranks exact titles above exact/partial aliases, partial titles, paths, and Markdown content', () => {
    const notes = [note(7, 'Content only', 'A **planning** phrase.'), note(4, 'Planning board'), note(3, 'Alias partial', '', ['Long planning name']),
      note(5, 'Board planning'), note(2, 'Alias exact', '', ['Planning']), note(1, 'Planning'), { ...note(6, 'Path only'), path: 'planning.md' }];
    const index = buildSearchIndex(notes);
    const results = searchIndex(index, ' PLANNING ');
    expect(results.map((result) => result.id)).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => note(n, 'Any').id));
    expect(results.map((result) => result.match.field)).toEqual(['title', 'alias', 'alias', 'title', 'title', 'path', 'content']);
    expect(results[1]?.snippet).toBe('Alias: Planning');
    expect(results[6]?.snippet).toContain('**planning**');
    expect(searchIndex(index, '')).toEqual([]);
    expect(searchIndex(index, '  \t ')).toEqual([]);
    expect(searchIndex(index, 'absent')).toEqual([]);
  });

  it('finds aliases once per note, matches Unicode and whitespace, and highlights the correct display text', () => {
    const index = buildSearchIndex([note(1, 'Other', '  introductory\n\nCafe\u0301\t research  İdea', ['Café', 'cafe\u0301'])]);
    const aliases = searchIndex(index, 'cafe\u0301');
    expect(aliases).toHaveLength(1);
    expect(aliases[0]?.match.text).toBe('Café');
    const content = searchIndex(index, 'CAFÉ   research');
    expect(content[0]?.match.field).toBe('content');
    for (const query of ['i', 'İ', 'research i']) {
      const match = searchIndex(index, query)[0]!.match;
      expect(match.text.slice(match.start, match.end).toLowerCase()).toContain(query.toLowerCase());
    }
  });

  it('centers bounded excerpts on late content matches and escapes nothing into executable markup', () => {
    const body = `${'before '.repeat(150)}<script>alert('needle')</script>${' after'.repeat(150)}`;
    const result = searchIndex(buildSearchIndex([note(1, 'Other', body)]), 'needle')[0]!;
    expect(result.snippet.startsWith('…')).toBe(true);
    expect(result.snippet.endsWith('…')).toBe(true);
    expect(result.snippet.length).toBeLessThan(150);
    expect(result.match.text.slice(result.match.start, result.match.end)).toBe('needle');
  });

  it('limits results deterministically and keeps stable IDs for duplicate titles and moves', () => {
    const notes = Array.from({ length: 70 }, (_, i) => note(i + 1, 'Shared'));
    const index = buildSearchIndex(notes.reverse());
    const results = searchIndex(index, 'shared');
    expect(results).toHaveLength(50);
    expect(results.map((result) => result.path)).toEqual([...results.map((result) => result.path)].sort((a, b) => a.localeCompare(b)));
    const moved = { ...note(1, 'Renamed'), path: 'moved.md' };
    expect(searchIndex(buildSearchIndex([moved]), 'Renamed')[0]?.id).toBe(note(1, 'Any').id);
  });

  it('reuses normalized documents across queries and rebuilds after invalidation/expiry', async () => {
    let time = 0;
    const load = vi.fn(async () => [note(1, 'First')]);
    const build = vi.fn(buildSearchIndex);
    const cache = createSnapshotCache(load, build, 5000, () => time);
    const [first, concurrent] = await Promise.all([cache.get(), cache.get()]);
    expect(first).toBe(concurrent);
    searchIndex(first, 'first'); searchIndex(await cache.get(), 'other');
    expect(load).toHaveBeenCalledTimes(1); expect(build).toHaveBeenCalledTimes(1);
    load.mockResolvedValue([note(2, 'New')]); cache.markDirty();
    expect(searchIndex(await cache.get(), 'New')).toHaveLength(1);
    time = 5000; await cache.get();
    expect(load).toHaveBeenCalledTimes(3);
    load.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(cache.get(true)).rejects.toThrow('disk unavailable');
    expect(searchIndex(await cache.get(), 'New')).toHaveLength(1);
  });
});
