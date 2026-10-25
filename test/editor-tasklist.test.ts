import { describe, expect, it } from 'vitest';
import { createEditorState } from '../ui/src/editor/createEditorState.js';
import { findTaskMarker, toggleTaskMarker } from '../ui/src/editor/taskMarkers.js';

describe('task list markers', () => {
  it('finds an unchecked marker', () => {
    const state = createEditorState({ doc: '- [ ] one\n- [x] two\n' });
    expect(findTaskMarker(state, 3)).toEqual({ from: 2, to: 5, checked: false });
  });

  it('finds a checked marker', () => {
    const state = createEditorState({ doc: '- [ ] one\n- [x] two\n' });
    expect(findTaskMarker(state, 13)).toEqual({ from: 12, to: 15, checked: true });
  });

  it('returns null outside a task marker', () => {
    const state = createEditorState({ doc: '- [ ] one\n\nplain text\n' });
    expect(findTaskMarker(state, 20)).toBeNull();
  });

  it('toggles an unchecked marker without touching the rest of the line', () => {
    const state = createEditorState({ doc: '- [ ] one\n' });
    const change = toggleTaskMarker(state, 3);
    expect(change).toEqual({ from: 3, to: 4, insert: 'x' });
    if (change === null) throw new Error('expected a task change');
    expect(state.update({ changes: change }).state.doc.toString()).toBe('- [x] one\n');
  });

  it('toggles a checked marker back to unchecked', () => {
    const state = createEditorState({ doc: '- [x] one\n' });
    const change = toggleTaskMarker(state, 3);
    expect(change).toEqual({ from: 3, to: 4, insert: ' ' });
  });
});
