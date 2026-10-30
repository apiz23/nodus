import { EditorState, Prec, type Extension } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { indentUnit } from '@codemirror/language';
import { keymap } from '@codemirror/view';
import { markdownEditingKeymap } from './markdownCommands.js';

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
      EditorState.allowMultipleSelections.of(true),
      markdown({ base: markdownLanguage, addKeymap: false }),
      Prec.high(keymap.of(markdownEditingKeymap)),
      indentUnit.of('    '),
      EditorState.lineSeparator.of(detectLineSeparator(options.doc)),
      ...(options.extensions ?? []),
    ],
  });
}

export function getDocumentString(state: EditorState): string {
  return state.doc.sliceString(0, state.doc.length, state.lineBreak);
}
