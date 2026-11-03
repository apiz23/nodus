import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildLinkIndex } from '../src/links/link-index.js';
import {
  candidateSuggestions,
  countIncomingTitleLinks,
  createLinkSuggester,
  normalizeLinkText,
  suggestLinkTargets,
} from '../src/links/link-repair.js';
import { chooseLinkTarget, rewriteWikiLink, sanitizeLinkDisplay } from '../src/links/link-edit.js';

const NOW = '2026-01-01T00:00:00Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

function note(id: string, title: string, body = '', aliases: string[] = [], path = `notes/${id.slice(0, 8)}.md`) {
  return createNote({ id, title, body, aliases, path, now: NOW });
}

describe('link repair suggestions', () => {
  const notes = [
    note(A, 'Project roadmap', '', [], 'planning/roadmap.md'),
    note(B, 'Meeting notes', '', ['weekly sync'], 'meetings/weekly.md'),
    note(C, 'Archive index', '', [], 'archive/index.md'),
  ];

  it('ranks exact, prefix, token, and typo matches deterministically', () => {
    const exact = suggestLinkTargets('Project roadmap', notes);
    expect(exact[0]).toMatchObject({ noteId: A, reason: 'exact-title', score: 100 });

    const prefix = suggestLinkTargets('Project road', notes);
    expect(prefix[0]).toMatchObject({ noteId: A, reason: 'title-similar' });

    const typo = suggestLinkTargets('Project roadmpa', notes);
    expect(typo[0]).toMatchObject({ noteId: A });
    expect(['title-similar', 'title-words']).toContain(typo[0]?.reason);

    const alias = suggestLinkTargets('weekly sync', notes);
    expect(alias[0]).toMatchObject({ noteId: B, reason: 'exact-alias', score: 100 });
  });

  it('suggests path and shared-word candidates without filesystem access', () => {
    const path = suggestLinkTargets('planning/roadmap.md', notes);
    expect(path[0]).toMatchObject({ noteId: A, reason: 'exact-path' });

    const words = suggestLinkTargets('meeting archive', notes);
    expect(words.map((suggestion) => suggestion.noteId)).toEqual(expect.arrayContaining([B, C]));
  });

  it('never suggests the source note and honors the result bound', () => {
    const all = suggestLinkTargets('note', [
      note(A, 'Note one'),
      note(B, 'Note two'),
      note(C, 'Note three'),
      note(D, 'Note four'),
    ], { sourceId: A, limit: 2 });
    expect(all).toHaveLength(2);
    expect(all.every((suggestion) => suggestion.noteId !== A)).toBe(true);

    const bounded = createLinkSuggester(notes).suggest('roadmap', { limit: 99 });
    expect(bounded.length).toBeLessThanOrEqual(10);
  });

  it('returns no suggestions for empty, very short, or unrelated input', () => {
    expect(suggestLinkTargets('', notes)).toEqual([]);
    expect(suggestLinkTargets('a', notes)).toEqual([]);
    expect(suggestLinkTargets('completely unrelated wording', notes)).toEqual([]);
    expect(suggestLinkTargets('roadmap', [])).toEqual([]);
  });

  it('preserves ambiguous candidate order and excludes the source', () => {
    const candidates = [A, B, C];
    const suggestions = candidateSuggestions(candidates, notes, B);
    expect(suggestions).toEqual([
      { noteId: A, title: 'Project roadmap', path: 'planning/roadmap.md', score: 100, reason: 'candidate' },
      { noteId: C, title: 'Archive index', path: 'archive/index.md', score: 100, reason: 'candidate' },
    ]);
    expect(candidateSuggestions([D], notes)).toEqual([]);
  });

  it('normalizes Unicode and case for comparison', () => {
    expect(normalizeLinkText('  CAFÉ  ')).toBe('café');
    expect(normalizeLinkText('Cafe\u0301')).toBe('café');
  });
});

describe('rename preservation helper', () => {
  it('counts only confirmed incoming links that use the old title', () => {
    const index = buildLinkIndex([
      note(A, 'Target', ''),
      note(B, 'Source', `[[Target]] and [[${A}|pinned]] and [[notes/target]]`),
      note(C, 'Other', '[[Target]]'),
    ]);
    expect(countIncomingTitleLinks(index, A, 'Target')).toBe(2);
    expect(countIncomingTitleLinks(index, A, 'target')).toBe(2);
  });

  it('ignores self-links, aliases, unresolved links, and a different title', () => {
    const index = buildLinkIndex([
      note(A, 'Target', '[[Target]]', ['Old title']),
      note(B, 'Source', '[[Old title]] [[Missing]]'),
    ]);
    expect(countIncomingTitleLinks(index, A, 'Target')).toBe(0);
    expect(countIncomingTitleLinks(index, A, 'Old title')).toBe(1);
    expect(countIncomingTitleLinks(index, A, 'Nope')).toBe(0);
  });
});

describe('safe wiki-link rewriting', () => {
  it('preserves display text and pins to a stable ID', () => {
    const body = 'Before [[Target|the plan]] after';
    const start = body.indexOf('[[');
    const end = body.indexOf(']]', start) + 2;
    const rewritten = rewriteWikiLink(body, { start, end, target: 'Target', display: 'the plan' }, { target: A });
    expect(rewritten.body).toBe(`Before [[${A}|the plan]] after`);
    expect(rewritten.display).toBe('the plan');
    expect(rewritten.raw).toBe(`[[${A}|the plan]]`);
  });

  it('adds explicit display text for a pinned link without a display', () => {
    const body = 'See [[Target]]';
    const start = body.indexOf('[[');
    const rewritten = rewriteWikiLink(
      body,
      { start, end: body.length, target: 'Target' },
      { target: A, display: 'Project roadmap' },
    );
    expect(rewritten.body).toBe(`See [[${A}|Project roadmap]]`);
  });

  it('rewrites exactly one occurrence and leaves duplicate links intact', () => {
    const body = '[[Target]] and [[Target|second]]';
    const second = body.indexOf('[[', 2);
    const rewritten = rewriteWikiLink(
      body,
      { start: second, end: body.length, target: 'Target', display: 'second' },
      { target: A },
    );
    expect(rewritten.body).toBe(`[[Target]] and [[${A}|second]]`);
  });

  it('rejects stale offsets, stale targets, stale display text, and invalid replacements', () => {
    const body = 'See [[Target|plan]]';
    const start = body.indexOf('[[');
    expect(() => rewriteWikiLink(body, { start: start + 1, end: body.length, target: 'Target' }, { target: A }))
      .toThrow(/exactly one wiki link/);
    expect(() => rewriteWikiLink(body, { start, end: body.length, target: 'Other' }, { target: A }))
      .toThrow(/target no longer matches/);
    expect(() => rewriteWikiLink(body, { start, end: body.length, target: 'Target', display: 'other' }, { target: A }))
      .toThrow(/display text no longer matches/);
    expect(() => rewriteWikiLink(body, { start, end: body.length, target: 'Target' }, { target: 'bad|target' }))
      .toThrow(/without brackets or pipes/);
    expect(() => rewriteWikiLink(body, { start, end: body.length, target: 'Target' }, { target: A, display: 'bad]' }))
      .toThrow(/display text/);
    expect(() => rewriteWikiLink(body, { start: -1, end: body.length, target: 'Target' }, { target: A }))
      .toThrow(/outside the note body/);
  });

  it('supports CRLF bodies and Unicode display text', () => {
    const body = 'Line one\r\nSee [[Café|naïve plan]]\r\nLine three';
    const start = body.indexOf('[[');
    const end = body.indexOf(']]', start) + 2;
    const rewritten = rewriteWikiLink(body, { start, end, target: 'Café', display: 'naïve plan' }, { target: A });
    expect(rewritten.body).toBe(`Line one\r\nSee [[${A}|naïve plan]]\r\nLine three`);
  });

  it('chooses an ID target when a title would be ambiguous and sanitizes unsafe display text', () => {
    const notes = [note(A, 'Shared'), note(B, 'Shared'), note(C, 'Unique')];
    expect(chooseLinkTarget(notes[0]!, notes, false)).toEqual({ target: A, pinned: true });
    expect(chooseLinkTarget(notes[2]!, notes, false)).toEqual({ target: 'Unique', pinned: false });
    expect(chooseLinkTarget(notes[0]!, notes, true)).toEqual({ target: A, pinned: true });
    const unsafeTitle = note(D, 'Pipe | title');
    expect(chooseLinkTarget(unsafeTitle, [unsafeTitle], false)).toEqual({ target: D, pinned: true });
    expect(sanitizeLinkDisplay('  Safe title  ')).toBe('Safe title');
    expect(sanitizeLinkDisplay('bad [title]')).toBeUndefined();
    expect(sanitizeLinkDisplay('line\nbreak')).toBeUndefined();
  });
});
