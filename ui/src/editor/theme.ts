import { EditorView } from '@codemirror/view';

export const editorTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--foreground)',
      backgroundColor: 'transparent',
      fontSize: '16px',
      lineHeight: '1.5',
      fontFamily: 'var(--font-sans)',
      height: '100%',
    },
    '.cm-content': {
      caretColor: 'var(--foreground)',
      padding: 0,
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--foreground)',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: 'var(--foreground)',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'var(--selection)',
    },
    '.cm-selectionBackground': {
      backgroundColor: 'var(--selection)',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-gutters': {
      display: 'none',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'inherit',
      lineHeight: 'inherit',
    },
  },
  { dark: false },
);
