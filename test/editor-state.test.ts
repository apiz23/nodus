import { describe, expect, it } from 'vitest';
import {
  createEditorState,
  detectLineSeparator,
  getDocumentString,
} from '../ui/src/editor/createEditorState.js';

describe('editor state', () => {
  it('round-trips the document unchanged', () => {
    const doc = '# Hello\n\nBody text.\n';
    const state = createEditorState({ doc });
    expect(getDocumentString(state)).toBe(doc);
  });

  it('preserves LF line endings', () => {
    const doc = 'a\nb\nc\n';
    const state = createEditorState({ doc });
    expect(detectLineSeparator(doc)).toBe('\n');
    expect(getDocumentString(state)).toBe(doc);
  });

  it('preserves homogeneous CRLF line endings', () => {
    const doc = 'a\r\nb\r\nc\r\n';
    const state = createEditorState({ doc });
    expect(detectLineSeparator(doc)).toBe('\r\n');
    expect(getDocumentString(state)).toBe(doc);
  });

  it('falls back to LF for mixed line endings', () => {
    const doc = 'a\r\nb\nc\r\n';
    expect(detectLineSeparator(doc)).toBe('\n');
    const state = createEditorState({ doc });
    expect(getDocumentString(state)).toBe(doc);
  });

  it('falls back to LF for empty documents', () => {
    expect(detectLineSeparator('')).toBe('\n');
    const state = createEditorState({ doc: '' });
    expect(getDocumentString(state)).toBe('');
  });

  it('loads the markdown language extension', () => {
    const state = createEditorState({ doc: '# Hello' });
    const data = state.languageDataAt('autocomplete', 0);
    expect(Array.isArray(data)).toBe(true);
  });
});
