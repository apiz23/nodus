import { describe, expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildLinkIndex, createLinkIndexCache } from '../src/links/link-index.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { withTempDir } from './tmp.js';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const now = '2026-10-28T00:00:00Z';
const note = (id: string, title: string, body = '', aliases: string[] = []) => createNote({ id, title, body, aliases, path: `notes/${id}.md`, now });

describe('discovery link index', () => {
  it('records literal references, displays, locations, aliases and confirmed incoming links', () => {
    const source = note(A, 'Source', 'First\nSee [[Alias|label]] and [[Missing|idea]].\n`[[Literal]]`\n~~~\n[[Fenced]]\n~~~');
    const target = note(B, 'Target', `[[${B}]]`, ['Alias']);
    const index = buildLinkIndex([source, target]);
    expect(index.links).toHaveLength(3);
    expect(index.links[0]).toMatchObject({ sourceId: A, sourcePath: source.path, line: 2, display: 'label', resolution: { status: 'resolved', noteId: B } });
    for (const link of index.links.filter((link) => link.sourceId === A)) expect(source.body.slice(link.start, link.end)).toBe(link.raw);
    expect(index.links[1]?.resolution.status).toBe('unresolved');
    expect(index.orphanNotes.map((note) => note.id)).toEqual([A]);
    expect(source.body).toContain('[[Missing|idea]]');
  });

  it('keeps duplicate titles ambiguous, and recomputes rename, move and deletion by ID', () => {
    const source = note(A, 'Source', `[[Shared]] [[${B}|pinned]]`);
    const target = note(B, 'Shared');
    const duplicate = note(C, 'Shared');
    expect(buildLinkIndex([source, target, duplicate]).links[0]?.resolution).toEqual({ status: 'ambiguous', noteIds: [B, C] });
    const changed = buildLinkIndex([source, { ...target, title: 'Renamed', path: 'moved.md' }]);
    expect(changed.links[0]?.resolution.status).toBe('unresolved');
    expect(changed.links[1]?.resolution).toEqual({ status: 'resolved', noteId: B });
    expect(buildLinkIndex([source]).links.every((link) => link.resolution.status === 'unresolved')).toBe(true);
    expect(buildLinkIndex([note(B, 'Self', '[[Self]]')]).orphanNotes).toHaveLength(1);
    expect(buildLinkIndex([])).toEqual({ notes: [], links: [], orphanNotes: [] });
  });

  it('shares rebuilds, bounds external staleness, refreshes explicitly and retries failed reads', async () => {
    let clock = 0;
    const load = vi.fn(async () => [note(A, 'First')]);
    const cache = createLinkIndexCache(load, 5000, () => clock);
    const [first, second] = await Promise.all([cache.get(), cache.get()]);
    expect(first).toBe(second);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.get();
    expect(load).toHaveBeenCalledTimes(1);
    clock = 5000;
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);
    cache.markDirty();
    await cache.get();
    await cache.get(true);
    expect(load).toHaveBeenCalledTimes(4);
    load.mockRejectedValueOnce(new Error('unavailable'));
    await expect(cache.get(true)).rejects.toThrow('unavailable');
    await expect(cache.get()).resolves.toMatchObject({ notes: [{ title: 'First' }] });
  });

  it('does not publish a snapshot invalidated while loading', async () => {
    let finish!: (notes: ReturnType<typeof note>[]) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue([note(B, 'New')]);
    const cache = createLinkIndexCache(load);
    const old = cache.get();
    cache.markDirty();
    finish([note(A, 'Old')]);
    await old;
    expect((await cache.get()).notes[0]?.id).toBe(B);
  });

  it('rechecks aliases and IDs under the root lock and never duplicates a newly resolved target', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      await vault.createNote(note(A, 'Existing', '', ['Intended']));
      expect((await vault.createNoteForLink('Intended', note(B, 'Intended'))).id).toBe(A);
      const candidate = note(B, 'New');
      const results = await Promise.all([vault.createNoteForLink('New', candidate), vault.createNoteForLink('New', note(C, 'New'))]);
      expect(results.map((note) => note.id)).toEqual([B, B]);
      expect(await vault.snapshotNotes()).toHaveLength(2);
      await vault.createNote(note(C, 'Existing'));
      await expect(vault.createNoteForLink('Existing', note(B, 'Existing'))).rejects.toThrow('multiple notes');
    });
  });
});
