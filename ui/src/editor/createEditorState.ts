import { EditorState, type Extension } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

export type LineSeparator = '\n' | '\r\n';

export function detectLineSeparator(text: string): LineSeparator {
  const hasCrLf = text.includes('\r\n');
  const hasBareLf = /(^|[^\r])\n/.test(text);
  if (hasCrLf && !hasBareLf) return '\r\n';
  return '\n';
}

export interface CreateEditorStateOptions {
  doc: string;
  extensions?: readonly Extension[];
}

export function createEditorState(options: CreateEditorStateOptions): EditorState {
  return EditorState.create({
    doc: options.doc,
    extensions: [
      markdown({ base: markdownLanguage }),
      EditorState.lineSeparator.of(detectLineSeparator(options.doc)),
      ...(options.extensions ?? []),
    ],
  });
}

export function getDocumentString(state: EditorState): string {
  return state.doc.sliceString(0, state.doc.length, state.lineBreak);
}
