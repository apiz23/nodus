import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, StateEffect, type StateCommand, type Transaction } from '@codemirror/state';
import { history, redo, undo } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { createEditorState, getDocumentString } from '../ui/src/editor/createEditorState.js';
import { indentMarkdown, insertCodeBlock, insertMarkdownLink, markdownEnter, outdentMarkdown, toggleBlockquote, toggleBold, toggleHeading, toggleInlineCode, toggleItalic, toggleList, toggleStrikethrough } from '../ui/src/editor/markdownCommands.js';
import { collectWikiLinks } from '../ui/src/editor/wikiLinkData.js';
import { findTaskMarker } from '../ui/src/editor/taskMarkers.js';

function editor(doc: string, anchor = 0, head = anchor) {
  let state = createEditorState({ doc, extensions: [history()] });
  state = state.update({ selection: EditorSelection.single(anchor, head) }).state;
  return {
    get state() { return state; },
    dispatch(transaction: Transaction) { state = transaction.state; },
    select(anchor: number, head = anchor) { state = state.update({ selection: EditorSelection.single(anchor, head) }).state; },
    text() { return getDocumentString(state); },
    selected() { return state.sliceDoc(state.selection.main.from, state.selection.main.to); },
  };
}

describe('Markdown inline formatting transactions', () => {
  it.each<[string, StateCommand, string]>([
    ['bold', toggleBold, '**'], ['italic', toggleItalic, '*'], ['strikethrough', toggleStrikethrough, '~~'], ['code', toggleInlineCode, '`'],
  ])('toggles %s while preserving selected text, direction, and surrounding source', (_name, command, marker) => {
    const view = editor('before word after', 11, 7);
    expect(command(view)).toBe(true);
    expect(view.text()).toBe(`before ${marker}word${marker} after`);
    expect(view.selected()).toBe('word');
    expect(view.state.selection.main.anchor).toBeGreaterThan(view.state.selection.main.head);
    expect(command(view)).toBe(true);
    expect(view.text()).toBe('before word after');
    expect(view.selected()).toBe('word');
  });

  it('inserts paired markers with the cursor between them when there is no selection', () => {
    const view = editor('ab', 1);
    toggleBold(view);
    expect(view.text()).toBe('a****b');
    expect(view.state.selection.main).toMatchObject({ anchor: 3, head: 3 });
    toggleBold(view);
    expect(view.text()).toBe('ab');
    expect(view.state.selection.main.head).toBe(1);
  });

  it('removes existing underscore formatting at a caret without nesting another delimiter', () => {
    const view = editor('__hello__', 4);
    toggleBold(view);
    expect(view.text()).toBe('hello');
    expect(view.state.selection.main.head).toBe(2);
  });

  it('handles multiline selections, blank lines, whitespace, and mixed existing formatting', () => {
    const view = editor('**one**\n\n two \nthree\n', 0, 21);
    toggleBold(view);
    expect(view.text()).toBe('**one**\n\n **two** \n**three**\n');
    view.select(0, view.state.doc.length);
    toggleBold(view);
    expect(view.text()).toBe('one\n\n two \nthree\n');
  });

  it('keeps disjoint selections and makes one formatting transaction undoable and redoable', () => {
    const view = editor('one two');
    view.dispatch(view.state.update({ selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(4, 7)]) }));
    toggleBold(view);
    expect(view.text()).toBe('**one** **two**');
    expect(view.state.selection.ranges.map((range) => view.state.sliceDoc(range.from, range.to))).toEqual(['one', 'two']);
    expect(undo(view)).toBe(true);
    expect(view.text()).toBe('one two');
    expect(redo(view)).toBe(true);
    expect(view.text()).toBe('**one** **two**');
  });

  it('uses safe code delimiters and retains literal whitespace when unwrapping', () => {
    for (const text of ['a`b`c', '`x` tail', ' a ']) {
      const view = editor(text, 0, text.length);
      toggleInlineCode(view);
      expect(view.selected()).toBe(text);
      toggleInlineCode(view);
      expect(view.text()).toBe(text);
    }
  });

  it('adds emphasis without replacing existing bold and removes shared delimiters only once', () => {
    const nested = editor('**bold**', 0, 8);
    toggleItalic(nested);
    expect(nested.text()).toBe('***bold***');
    toggleItalic(nested);
    expect(nested.text()).toBe('**bold**');
    const multi = editor('**abcdef**');
    multi.dispatch(multi.state.update({ selection: EditorSelection.create([EditorSelection.range(3, 4), EditorSelection.range(6, 7)]) }));
    toggleBold(multi);
    expect(multi.text()).toBe('abcdef');
    expect(multi.state.selection.ranges.map((range) => multi.state.sliceDoc(range.from, range.to))).toEqual(['b', 'e']);
  });

  it('does not apply emphasis inside existing code, or inline code across multiple lines', () => {
    const literal = editor('`**literal**`', 3);
    expect(toggleBold(literal)).toBe(false);
    expect(literal.text()).toBe('`**literal**`');
    const multiline = editor('one\ntwo', 0, 7);
    expect(toggleInlineCode(multiline)).toBe(false);
    expect(multiline.text()).toBe('one\ntwo');
    const mixedSource = 'plain\n```\ncode\n```\nlast';
    const mixed = editor(mixedSource, 0, mixedSource.length);
    toggleBold(mixed);
    expect(mixed.text()).toBe('**plain**\n```\ncode\n```\n**last**');
  });

  it('parses strikethrough as GFM without rewriting the source', () => {
    const view = editor('deleted', 0, 7);
    toggleStrikethrough(view);
    expect(syntaxTree(view.state).toString()).toContain('Strikethrough');
    expect(view.text()).toBe('~~deleted~~');
  });

  it('formats a complete wiki link without changing its identity, but does not format within its target', () => {
    const source = '[[Target|label]]';
    const view = editor(source, 4);
    expect(toggleBold(view)).toBe(false);
    expect(view.text()).toBe(source);
    view.select(0, source.length);
    toggleBold(view);
    expect(view.text()).toBe(`**${source}**`);
    expect(collectWikiLinks(view.state, [{ id: 'target', title: 'Target', aliases: [] }])[0]?.noteId).toBe('target');
  });
});

describe('Markdown line formatting', () => {
  it('changes heading levels and toggles them while preserving quote/list/task containers', () => {
    const view = editor('> - [x] ## Task', 12);
    toggleHeading(3)(view);
    expect(view.text()).toBe('> - [x] ### Task');
    toggleHeading(3)(view);
    expect(view.text()).toBe('> - [x] Task');
  });

  it('formats only selected lines, excluding a next-line boundary, and preserves caret mapping', () => {
    const view = editor('one\ntwo\nthree', 0, 8);
    toggleHeading(2)(view);
    expect(view.text()).toBe('## one\n## two\nthree');
    expect(view.state.selection.main.from).toBe(3);
    expect(view.state.selection.main.to).toBe(14);
  });

  it('adds and removes one quote level without losing indentation or Markdown', () => {
    const view = editor('  **one**\n  [[Target]]', 0, 22);
    toggleBlockquote(view);
    expect(view.text()).toBe('  > **one**\n  > [[Target]]');
    toggleBlockquote(view);
    expect(view.text()).toBe('  **one**\n  [[Target]]');
  });

  it('preserves mixed existing quotes and removes optional heading closing marks only when unformatting', () => {
    const quotes = editor('> quoted\nplain', 0, 14);
    toggleBlockquote(quotes);
    expect(quotes.text()).toBe('> quoted\n> plain');
    const heading = editor('## Heading ##', 5);
    toggleHeading(0)(heading);
    expect(heading.text()).toBe('Heading');
  });

  it('converts lists, numbers each indentation level, and retains checkbox states', () => {
    const view = editor('- [x] first\n    - child\n- [ ] second', 0, 35);
    toggleList(true)(view);
    expect(view.text()).toBe('1. [x] first\n    1. child\n2. [ ] second');
    toggleList(false)(view);
    expect(view.text()).toBe('- [x] first\n    - child\n- [ ] second');
  });

  it('toggles existing lists without modifying unrelated lines or blank separators', () => {
    const view = editor('- one\n- two\n\nlast', 0, 11);
    toggleList(false)(view);
    expect(view.text()).toBe('one\ntwo\n\nlast');
    const plain = editor('one\n\ntwo', 0, 8);
    toggleList(true)(plain);
    expect(plain.text()).toBe('1. one\n\n1. two');
  });

  it('restarts numbering in a new nested list beneath the next parent', () => {
    const source = '- a\n    - child a\n- b\n    - child b';
    const view = editor(source, 0, source.length);
    toggleList(true)(view);
    expect(view.text()).toBe('1. a\n    1. child a\n2. b\n    1. child b');
  });
});

describe('Markdown Enter and indentation', () => {
  it.each([
    ['- one', '- one\n- '],
    ['- ', ''],
    ['1. ', ''],
    ['- [ ] ', ''],
    ['- [x] done', '- [x] done\n- [ ] '],
    ['- parent\n    - [x] child', '- parent\n    - [x] child\n    - [ ] '],
    ['> quote', '> quote\n> '],
  ])('continues or exits %j using the native Markdown command', (before, after) => {
    const view = editor(before, before.length);
    markdownEnter(view);
    expect(view.text()).toBe(after);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it('renumbers following ordered siblings on Enter', () => {
    const view = editor('1. one\n2. two', 6);
    markdownEnter(view);
    expect(view.text()).toBe('1. one\n2. \n3. two');
    expect(view.state.selection.main.head).toBe(10);
  });

  it('indents and outdents nested checkboxes with Tab without changing their contents', () => {
    const source = '- parent\n- [x] child';
    const view = editor(source, source.length);
    indentMarkdown(view);
    expect(view.text()).toBe('- parent\n    - [x] child');
    const marker = view.text().indexOf('[x]');
    expect(findTaskMarker(view.state, marker + 1)?.checked).toBe(true);
    outdentMarkdown(view);
    expect(view.text()).toBe(source);
    expect(view.state.selection.main.head).toBe(source.length);
  });

  it('lets plain-text Tab move focus, and indents multiline selections', () => {
    const view = editor('plain\ntext', 3);
    expect(indentMarkdown(view)).toBe(false);
    view.select(0, view.state.doc.length);
    expect(indentMarkdown(view)).toBe(true);
    expect(view.text()).toBe('    plain\n    text');
  });
});

describe('Code blocks and links', () => {
  it('inserts a fenced block and places an empty cursor inside it', () => {
    const view = editor('');
    insertCodeBlock('typescript')(view);
    expect(view.text()).toBe('```typescript\n\n```');
    expect(view.state.selection.main.head).toBe(14);
    expect(undo(view)).toBe(true);
    expect(view.text()).toBe('');
  });

  it('preserves multiline source, uses a longer fence for embedded backticks, and keeps the selection', () => {
    const source = 'one\n```\ntwo';
    const view = editor(source, 0, source.length);
    insertCodeBlock('text')(view);
    expect(view.text()).toBe('````text\none\n```\ntwo\n````');
    expect(view.selected()).toBe(source);
  });

  it('splits surrounding prose safely and changes existing fence languages without nesting', () => {
    const view = editor('left right', 5, 10);
    insertCodeBlock('js')(view);
    expect(view.text()).toBe('left \n```js\nright\n```');
    expect(view.selected()).toBe('right');
    insertCodeBlock('typescript')(view);
    expect(view.text()).toBe('left \n```typescript\nright\n```');
    expect(view.selected()).toBe('right');
  });

  it('preserves code indentation on Enter and rejects invalid language identifiers', () => {
    const view = editor('```js\n  value\n```', 13);
    markdownEnter(view);
    expect(view.text()).toBe('```js\n  value\n  \n```');
    expect(insertCodeBlock('js\n```')(view)).toBe(false);
  });

  it('completes a manually typed opening fence on Enter without duplicating an existing closing fence', () => {
    const unclosed = editor('  ```ts', 7);
    markdownEnter(unclosed);
    expect(unclosed.text()).toBe('  ```ts\n  \n  ```');
    expect(unclosed.state.selection.main.head).toBe(10);
    const closed = editor('```ts\n```', 5);
    markdownEnter(closed);
    expect(closed.text()).toBe('```ts\n\n```');
  });

  it('preserves CRLF source through code insertion and undo/redo', () => {
    const view = editor('one\r\ntwo');
    view.select(0, view.state.doc.length);
    insertCodeBlock()(view);
    expect(view.text()).toBe('```\r\none\r\ntwo\r\n```');
    undo(view); expect(view.text()).toBe('one\r\ntwo');
    redo(view); expect(view.text()).toBe('```\r\none\r\ntwo\r\n```');
  });

  it('updates a shared code fence once when multiple cursors are in it', () => {
    const view = editor('```js\none two\n```');
    view.dispatch(view.state.update({ selection: EditorSelection.create([EditorSelection.cursor(7), EditorSelection.cursor(11)]) }));
    expect(insertCodeBlock('ts')(view)).toBe(true);
    expect(view.text()).toBe('```ts\none two\n```');
  });

  it('wraps selected link text and selects its destination placeholder', () => {
    const view = editor('before label after', 7, 12);
    insertMarkdownLink()(view);
    expect(view.text()).toBe('before [label](https://) after');
    expect(view.selected()).toBe('https://');
  });

  it('inserts an empty link label and safely encodes whitespace and parentheses in a supplied destination', () => {
    const view = editor('');
    insertMarkdownLink('docs/a b(1).md')(view);
    expect(view.text()).toBe('[link text](docs/a%20b%281%29.md)');
    expect(view.selected()).toBe('link text');
  });

  it('edits existing links without nesting, preserving the label and surrounding Markdown', () => {
    const view = editor('**[label](old.md)**', 5);
    insertMarkdownLink('new.md')(view);
    expect(view.text()).toBe('**[label](new.md)**');
    expect(view.selected()).toBe('new.md');
    undo(view); expect(view.text()).toBe('**[label](old.md)**');
  });

  it('handles multiline labels and leaves wiki links and literal code untouched', () => {
    const view = editor('one\ntwo', 0, 7);
    insertMarkdownLink('#section')(view);
    expect(view.text()).toBe('[one](#section)\n[two](#section)');
    expect(view.state.selection.main.from).toBe(1);
    expect(view.state.selection.main.to).toBe(view.text().lastIndexOf(']'));
    const wiki = editor('[[Target|label]]', 4);
    expect(insertMarkdownLink('new.md')(wiki)).toBe(false);
    expect(collectWikiLinks(wiki.state, [{ id: 'target', title: 'Target', aliases: [] }])[0]?.noteId).toBe('target');
    expect(wiki.text()).toBe('[[Target|label]]');
  });

  it('preserves existing links in a mixed multiline selection and safely updates a shared URL once', () => {
    const source = '[one](old.md)\ntwo';
    const mixed = editor(source, 0, source.length);
    insertMarkdownLink('new.md')(mixed);
    expect(mixed.text()).toBe('[one](new.md)\n[two](new.md)');
    const same = editor('[one](old.md)');
    same.dispatch(same.state.update({ selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]) }));
    expect(insertMarkdownLink('new.md')(same)).toBe(true);
    expect(same.text()).toBe('[one](new.md)');
  });

  it('does not mutate read-only Markdown', () => {
    const view = editor('unchanged', 0, 9);
    view.dispatch(view.state.update({ effects: StateEffect.reconfigure.of([EditorState.readOnly.of(true)]) }));
    expect(toggleBold(view)).toBe(false);
    expect(insertCodeBlock()(view)).toBe(false);
    expect(view.text()).toBe('unchanged');
  });
});
