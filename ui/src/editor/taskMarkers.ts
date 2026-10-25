import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export interface TaskMarker {
  from: number;
  to: number;
  checked: boolean;
}

export interface TaskChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * Find the GFM task marker containing or adjacent to a document position.
 * Task markers are the three characters `[ ]`, `[x]`, or `[X]`.
 */
export function findTaskMarker(state: EditorState, pos: number): TaskMarker | null {
  const line = state.doc.lineAt(pos);
  let found: TaskMarker | null = null;

  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (node.name !== 'TaskMarker') return;
      if (pos < node.from || pos > node.to) return;
      const text = state.doc.sliceString(node.from, node.to);
      if (!/^\[[ xX]\]$/.test(text)) return;
      found = {
        from: node.from,
        to: node.to,
        checked: text[1] !== ' ',
      };
    },
  });

  return found;
}

/** Return the minimal transaction change that toggles a task marker. */
export function toggleTaskMarker(state: EditorState, pos: number): TaskChange | null {
  const marker = findTaskMarker(state, pos);
  if (marker === null) return null;
  return {
    from: marker.from + 1,
    to: marker.from + 2,
    insert: marker.checked ? ' ' : 'x',
  };
}
