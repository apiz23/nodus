import { describe, expect, it } from 'vitest';
import { createEditorState } from '../ui/src/editor/createEditorState.js';
import { collectWikiLinks, collectWikiLinksInRanges } from '../ui/src/editor/wikiLinkData.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

const notes = [
  { id: A, title: 'Alpha', aliases: [] },
  { id: B, title: 'Beta', aliases: ['Second'] },
  { id: C, title: 'Plan', aliases: [] },
  { id: D, title: 'Plan', aliases: [] },
];

describe('wiki-link collection', () => {
  it('collects resolved title, alias, and UUID links with display text', () => {
    const state = createEditorState({
      doc: `[[Alpha]] [[Second|alt]] [[${A}|pinned]]`,
    });
    const links = collectWikiLinks(state, notes);
    expect(links.map((link) => link.target)).toEqual(['Alpha', 'Second', A]);
    expect(links.map((link) => link.display)).toEqual(['Alpha', 'alt', 'pinned']);
    expect(links.every((link) => link.status === 'resolved')).toBe(true);
  });

  it('excludes links inside fenced code and inline code', () => {
    const state = createEditorState({
      doc: 'See [[Alpha]] and `[[Alpha]]`\n\n```\n[[Alpha]]\n```\n',
    });
    expect(collectWikiLinks(state, notes).map((link) => link.target)).toEqual(['Alpha']);
  });

  it('keeps unresolved targets distinct and non-navigating', () => {
    const [link] = collectWikiLinks(createEditorState({ doc: '[[Missing]]' }), notes);
    expect(link).toMatchObject({
      target: 'Missing',
      status: 'unresolved',
    });
  });

  it('reports ambiguous targets with every candidate and never chooses one', () => {
    const [link] = collectWikiLinks(createEditorState({ doc: '[[Plan]]' }), notes);
    expect(link).toMatchObject({
      target: 'Plan',
      status: 'ambiguous',
      candidateIds: [C, D],
    });
  });

  it('does not mutate the Markdown source', () => {
    const doc = 'See [[Alpha]] and [[Missing]].\n';
    const state = createEditorState({ doc });
    collectWikiLinks(state, notes);
    expect(state.doc.toString()).toBe(doc);
  });

  it('collects only links in visible line ranges', () => {
    const state = createEditorState({
      doc: '[[Alpha]]\n\n[[Beta]]\n\n[[Missing]]\n',
    });
    const line = state.doc.line(3);
    const links = collectWikiLinksInRanges(state, notes, [
      { from: line.from, to: line.to },
    ]);
    expect(links.map((link) => link.target)).toEqual(['Beta']);
  });

  it('excludes code while collecting a visible range', () => {
    const state = createEditorState({
      doc: '[[Alpha]] and `[[Alpha]]`\n```\n[[Alpha]]\n```\n',
    });
    const links = collectWikiLinksInRanges(state, notes, [
      { from: 0, to: state.doc.length },
    ]);
    expect(links.map((link) => link.target)).toEqual(['Alpha']);
  });

  it('bounds title lookup work for a large vault and a viewport in a large document', () => {
    let titleReads = 0;
    const largeVault = Array.from({ length: 10_000 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      get title() { titleReads++; return `Note ${index}`; }, aliases: [],
    }));
    const visible = Array.from({ length: 40 }, (_, index) => `[[Note ${index}]]`).join('\n');
    const doc = `${visible}\n${'Large Markdown paragraph with **formatting**.\n'.repeat(20_000)}`;
    const start = performance.now();
    const state = createEditorState({ doc });
    const links = collectWikiLinksInRanges(state, largeVault, [{ from: 0, to: visible.length }]);
    const elapsedMs = performance.now() - start;
    if (process.env.NODUS_EDITOR_PROFILE === '1') process.stdout.write(`${JSON.stringify({ bytes: Buffer.byteLength(doc), notes: largeVault.length, visibleLinks: links.length, titleReads, elapsedMs })}\n`);
    expect(links).toHaveLength(40);
    expect(links.every((link) => link.status === 'resolved')).toBe(true);
    expect(titleReads).toBe(largeVault.length);
    expect(state.doc.toString()).toBe(doc);
  });
});
