import { describe, expect, it } from 'vitest';
import { ensureSyntaxTree } from '@codemirror/language';
import { createEditorState } from '../ui/src/editor/createEditorState.js';
import { activeHeadingAt, buildOutlineTree, extractDocumentOutline, headingText, headingSlug, outlineForNavigation } from '../ui/src/editor/documentOutline.js';

describe('Markdown document outline', () => {
  it('extracts ATX and Setext headings while ignoring code and reference definitions', () => {
    const source = [
      '# Start',
      '',
      'Chapter *One* [guide](https://example.test)',
      '=======',
      '',
      '```md',
      '# Not a heading',
      '```',
      '',
      '[guide]: https://example.test',
      '> ### Quoted heading',
    ].join('\n');
    const headings = extractDocumentOutline(createEditorState({ doc: source }));
    expect(headings.map(({ text, level }) => [level, text])).toEqual([
      [1, 'Start'],
      [1, 'Chapter One guide'],
      [3, 'Quoted heading'],
    ]);
    expect(headings.map((heading) => heading.line)).toEqual([1, 3, 11]);
  });

  it('creates unique Unicode-aware IDs for duplicate, formatted, and empty headings', () => {
    const source = '# Café\n\n## Café\n\n## `Café`\n\n## ***\n\n## Topic\n\n## Topic\n\n## Topic-2';
    const headings = extractDocumentOutline(createEditorState({ doc: source }));
    expect(headings.map((heading) => heading.id)).toEqual(['café', 'café-2', 'café-3', 'section', 'topic', 'topic-2', 'topic-2-2']);
    expect(new Set(headings.map((heading) => heading.id)).size).toBe(headings.length);
    expect(headingText('[[target-id|Readable]] and [guide](https://example.test)')).toBe('Readable and guide');
    expect(headingSlug('Résumé & review')).toBe('résumé-review');
  });

  it('builds nested heading hierarchy when levels are skipped and identifies the active section', () => {
    const headings = extractDocumentOutline(createEditorState({ doc: '# A\n### B\n## C\n#### D' }));
    const tree = buildOutlineTree(headings);
    expect(tree.map((node) => ({ id: node.id, children: node.children.map((child) => ({ id: child.id, children: child.children.map((nested) => ({ id: nested.id, children: nested.children })) })) }))).toEqual([
      { id: 'a', children: [{ id: 'b', children: [] }, { id: 'c', children: [{ id: 'd', children: [] }] }] },
    ]);
    expect(activeHeadingAt(headings, 0)).toBe('a');
    expect(activeHeadingAt(headings, headings[2]!.from + 1)).toBe('c');
    expect(activeHeadingAt(headings, 999)).toBe('d');
  });

  it('navigates by the same stable ID used by preview anchors', () => {
    const state = createEditorState({ doc: '# First\n\n## Duplicate\n\n## Duplicate' });
    const headings = extractDocumentOutline(state);
    expect(outlineForNavigation(state, 'duplicate-2')?.from).toBe(headings[2]!.from);
    expect(outlineForNavigation(state, 'missing')).toBeUndefined();
  });

  it('extracts a large outline without dropping headings', () => {
    const source = Array.from({ length: 5000 }, (_, index) => `## Section ${index + 1}\n\nBody text.`).join('\n\n');
    const state = createEditorState({ doc: source });
    let tree = ensureSyntaxTree(state, state.doc.length, 25);
    while (tree === null || tree.length < state.doc.length) tree = ensureSyntaxTree(state, state.doc.length, 25);
    const headings = extractDocumentOutline(state, tree);
    expect(headings).toHaveLength(5000);
    expect(headings[0]).toMatchObject({ id: 'section-1', text: 'Section 1', line: 1 });
    expect(headings.at(-1)).toMatchObject({ id: 'section-5000', text: 'Section 5000' });
  });
});
