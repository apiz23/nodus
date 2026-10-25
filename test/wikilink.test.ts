import { describe, expect, it } from 'vitest';
import { parseWikiLinks, resolveLink, type LinkableNote } from '../src/links/wikilink.js';
import validNote from './fixtures/valid-note.md?raw';

const ROADMAP_ID = '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';
const PINNED_ID = 'a0d3c1f2-8e4b-4f6a-9c2d-7b1e5f3a9d88';
const OTHER_ID = '0b7c9e1a-2d3f-4a5b-8c6d-7e8f9a0b1c2d';

const notes: LinkableNote[] = [
  { id: ROADMAP_ID, title: 'Nodus roadmap', aliases: ['Roadmap'] },
  { id: PINNED_ID, title: 'Data format', aliases: [] },
  { id: OTHER_ID, title: 'Café', aliases: [] },
];

describe('parseWikiLinks', () => {
  it('parses plain and aliased links with exact raw text and offsets', () => {
    const body = 'See [[Data format]] and [[Data format|format]].';
    const links = parseWikiLinks(body);
    expect(links).toEqual([
      { raw: '[[Data format]]', target: 'Data format', start: 4, end: 19 },
      { raw: '[[Data format|format]]', target: 'Data format', display: 'format', start: 24, end: 46 },
    ]);
    for (const link of links) {
      expect(body.slice(link.start, link.end)).toBe(link.raw);
    }
  });

  it('finds the two real links in the valid fixture and ignores code', () => {
    const links = parseWikiLinks(validNote);
    expect(links.map((link) => link.target)).toEqual(['Data format', PINNED_ID]);
    expect(links[1]?.display).toBe('pinned data-format note');
  });

  it('ignores links inside fenced code blocks', () => {
    const body = '```\n[[Hidden]]\n```\n[[Visible]]';
    expect(parseWikiLinks(body).map((link) => link.target)).toEqual(['Visible']);
  });

  it('ignores links inside tilde fences and keeps the fence open until a matching close', () => {
    const body = '~~~\n```\n[[Hidden]]\n```\n~~~\n[[Visible]]';
    expect(parseWikiLinks(body).map((link) => link.target)).toEqual(['Visible']);
  });

  it('ignores links inside inline code spans', () => {
    const body = 'Use `[[Literal]]` but link [[Real]].';
    expect(parseWikiLinks(body).map((link) => link.target)).toEqual(['Real']);
  });

  it('keeps a second pipe as literal display text', () => {
    const [link] = parseWikiLinks('[[Target|a|b]]');
    expect(link?.target).toBe('Target');
    expect(link?.display).toBe('a|b');
  });

  it.each(['[[]]', '[[|x]]', '[[ ]]', '[[Open', 'Closed]]', '[[a\nb]]', '[[a]b]]'])('does not treat %j as a link', (body) => {
    expect(parseWikiLinks(body)).toEqual([]);
  });

  it('accepts an ID-pinned target', () => {
    const [link] = parseWikiLinks(`[[${PINNED_ID}|pinned]]`);
    expect(link?.target).toBe(PINNED_ID);
  });

  it('keeps Unicode targets intact', () => {
    const [link] = parseWikiLinks('[[日本語 notes]]');
    expect(link?.target).toBe('日本語 notes');
  });
});

describe('resolveLink', () => {
  it('resolves a title match', () => {
    expect(resolveLink('Data format', notes)).toEqual({ status: 'resolved', noteId: PINNED_ID });
  });

  it('resolves an alias match', () => {
    expect(resolveLink('Roadmap', notes)).toEqual({ status: 'resolved', noteId: ROADMAP_ID });
  });

  it('matches titles case-insensitively and ignores surrounding whitespace', () => {
    expect(resolveLink('  data FORMAT ', notes)).toEqual({ status: 'resolved', noteId: PINNED_ID });
  });

  it('resolves an ID-pinned target by id', () => {
    expect(resolveLink(PINNED_ID, notes)).toEqual({ status: 'resolved', noteId: PINNED_ID });
  });

  it('reports an ID-pinned target that matches no note as unresolved', () => {
    expect(resolveLink('1d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6', notes)).toEqual({ status: 'unresolved' });
  });

  it('reports a missing title as unresolved', () => {
    expect(resolveLink('Nowhere', notes)).toEqual({ status: 'unresolved' });
  });

  it('reports two notes with the same title as ambiguous and returns both ids', () => {
    const duplicates: LinkableNote[] = [
      { id: ROADMAP_ID, title: 'Plan', aliases: [] },
      { id: OTHER_ID, title: 'Plan', aliases: [] },
    ];
    expect(resolveLink('Plan', duplicates)).toEqual({ status: 'ambiguous', noteIds: [ROADMAP_ID, OTHER_ID] });
  });

  it('reports a title that matches another note alias as ambiguous', () => {
    const clash: LinkableNote[] = [
      { id: ROADMAP_ID, title: 'Roadmap', aliases: [] },
      { id: OTHER_ID, title: 'Plan', aliases: ['Roadmap'] },
    ];
    expect(resolveLink('Roadmap', clash)).toEqual({ status: 'ambiguous', noteIds: [ROADMAP_ID, OTHER_ID] });
  });

  it('keeps ID-pinned links resolving after a rename while title links break', () => {
    const renamed: LinkableNote[] = [{ id: PINNED_ID, title: 'Data model', aliases: [] }];
    expect(resolveLink(PINNED_ID, renamed)).toEqual({ status: 'resolved', noteId: PINNED_ID });
    expect(resolveLink('Data format', renamed)).toEqual({ status: 'unresolved' });
  });

  it('treats NFC and NFD spellings of the same title as one match', () => {
    const nfd = 'Cafe\u0301';
    expect(resolveLink(nfd, notes)).toEqual({ status: 'resolved', noteId: OTHER_ID });
  });
});
