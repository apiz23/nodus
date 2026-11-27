import { describe, expect, it } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { insertNodusViewBlock } from '@/editor/markdownCommands';
import { createEditorState } from '../ui/src/editor/createEditorState.js';

const DIRECTIVE = `database: 11111111-1111-4111-8111-111111111111\nview: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1`;

function insert(doc: string, selection: EditorSelection | { anchor: number; head?: number }) {
  const base = createEditorState({ doc });
  let state = base.update({
    selection: selection instanceof EditorSelection ? selection : EditorSelection.cursor(selection.anchor),
  }).state;
  const target = {
    get state() { return state; },
    dispatch(transaction: { state: EditorState }) { state = transaction.state; },
  };
  const ok = insertNodusViewBlock(DIRECTIVE)(target as never);
  return { ok, doc: state.doc.toString() };
}

describe('P0 insertion context', () => {
  it('inserts in a paragraph without touching the text', () => {
    const result = insert('Hello world.\n', { anchor: 6 });
    expect(result.ok).toBe(true);
    expect(result.doc).toContain('Hello world.');
    expect(result.doc).toContain('nodus-view');
  });

  it('refuses inside an existing fenced code block', () => {
    const source = '```js\nconst x = 1;\n```\n';
    const result = insert(source, { anchor: source.indexOf('const') });
    expect(result.ok).toBe(false);
    expect(result.doc).toBe(source);
  });

  it('refuses inside a table cell', () => {
    const source = '| a | b |\n| - | - |\n| 1 | 2 |\n';
    const result = insert(source, { anchor: source.indexOf('1') });
    expect(result.ok).toBe(false);
    expect(result.doc).toBe(source);
  });

  it('allows the fence boundary itself', () => {
    const source = '```js\nconst x = 1;\n```\n';
    expect(insert(source, { anchor: 0 }).ok).toBe(true);
    expect(insert(source, { anchor: source.length }).ok).toBe(true);
  });

  it('allows the document end and preserves a spanning selection', () => {
    const source = 'alpha\nbeta\n';
    const end = insert(source, { anchor: source.length });
    expect(end.ok).toBe(true);
    const selection = insert(source, EditorSelection.range(0, 5));
    expect(selection.ok).toBe(true);
    expect(selection.doc).toContain('alpha');
    expect(selection.doc).toContain('beta');
  });

  it('rejects an empty directive body', () => {
    let state = createEditorState({ doc: 'text\n' });
    const target = { get state() { return state; }, dispatch(transaction: { state: EditorState }) { state = transaction.state; } };
    expect(insertNodusViewBlock('   ')(target as never)).toBe(false);
    expect(state.doc.toString()).toBe('text\n');
  });
});
