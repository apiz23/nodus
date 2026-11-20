import { describe, expect, it } from 'vitest';
import { createLinkResolver, parseWikiLinks } from '../src/links/wikilink.js';
import {
  compareResolverStability,
  type ResolverSnapshot,
  type ResolverSnapshotNote,
  type ResolverStabilityTestEngine,
} from '../src/links/resolver-stability.js';

const SOURCE = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const LINKER = '10000000-0000-4000-8000-000000000003';
const TWIN_A = '10000000-0000-4000-8000-000000000004';
const TWIN_B = '10000000-0000-4000-8000-000000000005';
const COPY = '10000000-0000-4000-8000-000000000006';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

function note(
  id: string,
  title: string,
  path: string,
  body = '',
  sourceRawContentHash = H1,
  aliases: string[] = [],
): ResolverSnapshotNote {
  return { id, title, path, body, sourceRawContentHash, aliases };
}

function snapshot(notes: ResolverSnapshotNote[], complete = true): ResolverSnapshot {
  return { complete, notes };
}

function changed(result: ReturnType<typeof compareResolverStability>, code: string): boolean {
  return result.issues.some((issue) => issue.code === code);
}

const productionEngine: ResolverStabilityTestEngine = { parse: parseWikiLinks, createResolver: createLinkResolver };

function stableBefore(): ResolverSnapshot {
  return snapshot([
    note(SOURCE, 'Source', 'notes/source.md'),
    note(OTHER, 'Other', 'notes/other.md'),
    note(TWIN_A, 'Twin', 'notes/twin-a.md'),
    note(TWIN_B, 'Twin', 'notes/twin-b.md'),
    note(LINKER, 'Links', 'notes/links.md', '[[Source]] [[Other]] [[Missing]] [[Twin]] [[10000000-0000-4000-8000-000000000001]] [[https://example.com]]'),
  ]);
}

function stableAfter(copy = note(COPY, 'Distinct copy title', 'copies/source-copy.md', '[[Missing from copy]]')): ResolverSnapshot {
  return snapshot([...stableBefore().notes, copy]);
}

describe('Phase 19 resolver-stability projection', () => {
  it('captures source, unrelated, unresolved, and ambiguous links and preserves all outcomes', () => {
    const result = compareResolverStability(stableBefore(), stableAfter(), COPY);
    expect(result.stable).toBe(true);
    expect(result.before.map(({ target, resolution }) => [target, resolution])).toEqual([
      ['Source', { status: 'resolved', noteId: SOURCE }],
      ['Other', { status: 'resolved', noteId: OTHER }],
      ['Missing', { status: 'unresolved' }],
      ['Twin', { status: 'ambiguous', noteIds: [TWIN_A, TWIN_B] }],
      [SOURCE, { status: 'resolved', noteId: SOURCE }],
      ['https://example.com', { status: 'external' }],
    ]);
    expect(result.before).toHaveLength(6);
    expect(result.afterExisting).toHaveLength(6);
  });

  it('changes no existing link outcome merely because the copied note has outgoing links', () => {
    const result = compareResolverStability(stableBefore(), stableAfter(), COPY);
    expect(result.stable).toBe(true);
    expect(result.copiedNoteOutgoing.map(({ target, resolution }) => [target, resolution])).toEqual([
      ['Missing from copy', { status: 'unresolved' }],
    ]);
    expect(result.before).toHaveLength(6);
  });

  it('keeps copied-note outgoing analysis separate when an old resolution changes', () => {
    const before = snapshot([
      note(SOURCE, 'Source', 'notes/source.md'),
      note(LINKER, 'Links', 'notes/links.md', '[[Source]]'),
    ]);
    const after = snapshot([
      ...before.notes,
      note(COPY, 'Source', 'copies/source.md', '[[Source]] [[Copy-owned missing link]]'),
    ]);
    const result = compareResolverStability(before, after, COPY);
    expect(result.stable).toBe(false);
    expect(changed(result, 'RESOLUTION_CHANGED')).toBe(true);
    expect(result.copiedNoteOutgoing.map((item) => item.target)).toEqual(['Source', 'Copy-owned missing link']);
  });

  it.each([
    ['resolved link to source becomes ambiguous', 'Source', [note(COPY, 'Source', 'copies/source.md')], 'RESOLUTION_CHANGED'],
    ['unresolved link becomes resolved', 'Missing', [note(COPY, 'Missing', 'copies/missing.md')], 'RESOLUTION_CHANGED'],
    ['ambiguous candidate set changes', 'Twin', [note(COPY, 'Twin', 'copies/twin.md')], 'RESOLUTION_CHANGED'],
  ])('rejects when a new copy makes a %s', (_name, _target, copies, expected) => {
    const before = snapshot([note(SOURCE, 'Source', 'notes/source.md'), note(LINKER, 'Links', 'notes/links.md', '[[Source]] [[Missing]] [[Twin]]'), note(TWIN_A, 'Twin', 'notes/a.md'), note(TWIN_B, 'Twin', 'notes/b.md')]);
    const after = snapshot([...before.notes, ...copies as ResolverSnapshotNote[]]);
    const result = compareResolverStability(before, after, COPY);
    expect(result.stable).toBe(false);
    expect(changed(result, expected)).toBe(true);
  });

  it('detects path-fallback resolution shadowed by the new copy title', () => {
    const before = snapshot([
      note(OTHER, 'Other', 'folder/target.md'),
      note(LINKER, 'Links', 'links.md', '[[folder/target]]'),
    ]);
    const after = snapshot([...before.notes, note(COPY, 'folder/target', 'copies/new.md')]);
    const result = compareResolverStability(before, after, COPY);
    expect(result.issues.some((issue) => issue.code === 'RESOLUTION_CHANGED')).toBe(true);
  });

  it('detects a changed source raw-content hash before comparing link outcomes', () => {
    const before = snapshot([note(SOURCE, 'Source', 'source.md'), note(LINKER, 'Links', 'links.md', '[[Source]]')]);
    const after = snapshot([note(SOURCE, 'Source', 'source.md'), note(LINKER, 'Links', 'links.md', '[[Source]]', H2), note(COPY, 'Copy', 'copy.md')]);
    expect(changed(compareResolverStability(before, after, COPY), 'SOURCE_HASH_CHANGED')).toBe(true);
  });

  it('detects missing and altered-token occurrences', () => {
    const before = snapshot([note(SOURCE, 'Source', 'source.md'), note(LINKER, 'Links', 'links.md', '[[Source]]')]);
    const missing = snapshot([note(SOURCE, 'Source', 'source.md'), note(LINKER, 'Links', 'links.md', 'no link'), note(COPY, 'Copy', 'copy.md')]);
    expect(changed(compareResolverStability(before, missing, COPY), 'MISSING_OCCURRENCE')).toBe(true);

    const altered = snapshot([note(SOURCE, 'Source', 'source.md'), note(LINKER, 'Links', 'links.md', '[[Other]]'), note(COPY, 'Copy', 'copy.md')]);
    const result = compareResolverStability(before, altered, COPY);
    expect(changed(result, 'MISSING_OCCURRENCE')).toBe(true);
    expect(changed(result, 'ADDED_EXISTING_OCCURRENCE')).toBe(true);
  });

  it('rejects incomplete inventories, missing notes, unexpected notes, and duplicate IDs', () => {
    const before = stableBefore();
    expect(changed(compareResolverStability(snapshot([...before.notes], false), stableAfter(), COPY), 'INCOMPLETE_SNAPSHOT')).toBe(true);
    expect(changed(compareResolverStability(before, snapshot(stableAfter().notes.filter((item) => item.id !== OTHER)), COPY), 'MISSING_EXISTING_NOTE')).toBe(true);
    expect(changed(compareResolverStability(snapshot([]), snapshot([note(OTHER, 'Unexpected', 'u.md'), note(COPY, 'Copy', 'copy.md')]), COPY), 'UNEXPECTED_NOTE')).toBe(true);
    expect(changed(compareResolverStability(snapshot([note(SOURCE, 'S', 's.md'), note(SOURCE, 'S2', 's2.md')]), stableAfter(), COPY), 'DUPLICATE_NOTE_ID')).toBe(true);
  });

  it('rejects duplicate, overlapping, out-of-range, and raw-token-mismatched parser output', () => {
    const before = snapshot([note(SOURCE, 'Source', 'source.md'), note(LINKER, 'Links', 'links.md', '[[A]][[B]]')]);
    const after = snapshot([...before.notes, note(COPY, 'Copy', 'copy.md')]);
    const links = parseWikiLinks('[[A]][[B]]');
    const first = links[0]!;
    const second = links[1]!;
    const engine = (parse: ResolverStabilityTestEngine['parse']): ResolverStabilityTestEngine => ({
      parse: (body) => body === '[[A]][[B]]' ? parse(body) : parseWikiLinks(body),
      createResolver: createLinkResolver,
    });

    expect(changed(compareResolverStability(before, after, COPY, engine(() => [first, first])), 'DUPLICATE_OCCURRENCE')).toBe(true);
    const overlapping = { raw: 'A]][[', target: 'B', start: 2, end: 7 };
    expect(changed(compareResolverStability(before, after, COPY, engine(() => [first, overlapping])), 'OVERLAPPING_OCCURRENCES')).toBe(true);
    expect(changed(compareResolverStability(before, after, COPY, engine(() => [{ ...first, start: -1 }])), 'INVALID_OCCURRENCE')).toBe(true);
    expect(changed(compareResolverStability(before, after, COPY, engine(() => [{ ...first, raw: '[[X]]' }])), 'INVALID_OCCURRENCE')).toBe(true);
  });

  it('fails closed when parsing, resolver construction, or resolution fails', () => {
    const before = snapshot([note(SOURCE, 'Source', 'source.md'), note(LINKER, 'Links', 'links.md', '[[Source]]')]);
    const after = snapshot([...before.notes, note(COPY, 'Copy', 'copy.md')]);
    expect(changed(compareResolverStability(before, after, COPY, { ...productionEngine, parse: () => { throw new Error('parse failed'); } }), 'PARSER_FAILURE')).toBe(true);
    expect(changed(compareResolverStability(before, after, COPY, { ...productionEngine, createResolver: () => { throw new Error('resolver construction failed'); } }), 'RESOLVER_FAILURE')).toBe(true);
    expect(changed(compareResolverStability(before, after, COPY, { ...productionEngine, createResolver: () => () => { throw new Error('resolve failed'); } }), 'RESOLVER_FAILURE')).toBe(true);
  });

  it('sorts occurrence projections and ambiguous candidate sets deterministically', () => {
    const before = snapshot([
      note(TWIN_B, 'Twin', 'b.md'), note(TWIN_A, 'Twin', 'a.md'),
      note(LINKER, 'Links', 'links.md', '[[Twin]] [[Unknown]]'), note(SOURCE, 'Source', 'source.md'),
    ]);
    const after = snapshot([...before.notes].reverse().concat(note(COPY, 'Copy', 'copy.md')));
    const first = compareResolverStability(before, after, COPY);
    const second = compareResolverStability(snapshot([...before.notes].reverse()), snapshot([...after.notes].reverse()), COPY);
    expect(first).toEqual(second);
    expect(first.before[0]?.identity.sourceNoteId).toBe(LINKER);
    expect(first.before[0]?.resolution).toEqual({ status: 'ambiguous', noteIds: [TWIN_A, TWIN_B] });
  });

  it('partitions successful after diagnostics when before resolver construction fails', () => {
    const before = snapshot([note(SOURCE, 'Source', 'source.md', '[[Missing]]')]);
    const after = snapshot([...before.notes, note(COPY, 'Copy', 'copy.md', '[[Source]]')]);
    let calls = 0;
    const result = compareResolverStability(before, after, COPY, {
      ...productionEngine,
      createResolver: (notes) => {
        if (++calls === 1) throw new Error('before construction failure');
        return createLinkResolver(notes);
      },
    });
    expect(result.stable).toBe(false);
    expect(result.before).toEqual([]);
    expect(result.afterExisting.map((item) => item.identity.sourceNoteId)).toEqual([SOURCE]);
    expect(result.copiedNoteOutgoing.map((item) => item.identity.sourceNoteId)).toEqual([COPY]);
    expect(result.issues).toContainEqual({ code: 'RESOLVER_FAILURE', message: 'before construction failure' });
  });

  it.each(['日本語 ', '🙂 café '])('preserves actual UTF-16 parser offsets after %s', (prefix) => {
    const body = `${prefix}[[Target]]`;
    const before = snapshot([note(SOURCE, 'Source', 'source.md', body)]);
    const after = snapshot([...before.notes, note(COPY, 'Copy', 'copy.md')]);
    const result = compareResolverStability(before, after, COPY);
    expect(result.stable).toBe(true);
    const parsed = parseWikiLinks(body)[0]!;
    const identity = result.before[0]!.identity;
    expect(identity.startOffset).toBe(prefix.length);
    expect(identity.startOffset).toBe(parsed.start);
    expect(identity.endOffset).toBe(parsed.end);
    expect(body.slice(identity.startOffset, identity.endOffset)).toBe(identity.rawToken);
    expect(identity.rawToken).toBe('[[Target]]');
  });

  it('rejects a new copy alias changing an unrelated link resolution', () => {
    const before = snapshot([note(SOURCE, 'Source', 'source.md'), note(OTHER, 'Other', 'other.md'), note(LINKER, 'Links', 'links.md', '[[Other]]')]);
    const after = snapshot([...before.notes, note(COPY, 'Copy', 'copy.md', '', H1, ['Other'])]);
    const result = compareResolverStability(before, after, COPY);
    expect(result.stable).toBe(false);
    expect(changed(result, 'RESOLUTION_CHANGED')).toBe(true);
    expect(result.before[0]!.resolution).toEqual({ status: 'resolved', noteId: OTHER });
    expect(result.afterExisting[0]!.resolution).toEqual({ status: 'ambiguous', noteIds: [OTHER, COPY] });
  });

  it('rejects resolved-to-unresolved outcomes using the production resolver', () => {
    const before = snapshot([note(SOURCE, 'Target', 'source.md'), note(LINKER, 'Links', 'links.md', '[[Target]]')]);
    // Deliberately inconsistent trusted metadata exercises comparison independently
    // of storage hash verification, which belongs to the future snapshot owner.
    const after = snapshot([note(SOURCE, 'Renamed', 'source.md'), before.notes[1]!, note(COPY, 'Copy', 'copy.md')]);
    const result = compareResolverStability(before, after, COPY);
    expect(result.stable).toBe(false);
    expect(changed(result, 'RESOLUTION_CHANGED')).toBe(true);
    expect(result.afterExisting[0]!.resolution).toEqual({ status: 'unresolved' });
  });

  it('rejects a token changing from internal to external classification', () => {
    const before = snapshot([note(SOURCE, 'Source', 'source.md', '[[Missing]]')]);
    const after = snapshot([note(SOURCE, 'Source', 'source.md', '[[https://example.com]]'), note(COPY, 'Copy', 'copy.md')]);
    const result = compareResolverStability(before, after, COPY);
    expect(result.stable).toBe(false);
    expect(changed(result, 'MISSING_OCCURRENCE')).toBe(true);
    expect(changed(result, 'ADDED_EXISTING_OCCURRENCE')).toBe(true);
    expect(result.before[0]!.resolution).toEqual({ status: 'unresolved' });
    expect(result.afterExisting[0]!.resolution).toEqual({ status: 'external' });
  });

});
