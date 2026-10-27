import { EditorView } from '@codemirror/view';

export const editorTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--foreground)',
      backgroundColor: 'transparent',
      fontSize: '17px',
      lineHeight: '1.7',
      fontFamily: 'var(--font-sans)',
      height: 'auto',
    },
    '.cm-content': {
      caretColor: 'var(--success)',
      padding: 0,
      fontFamily: 'inherit',
      minHeight: '42vh',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--success)',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: 'var(--success)',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '&.cm-focused .cm-content': {
      outline: 'none',
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
      overflow: 'visible',
      fontFamily: 'inherit',
      lineHeight: 'inherit',
    },
    '.cm-placeholder': {
      color: 'var(--muted-foreground)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--popover)',
      color: 'var(--popover-foreground)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(20, 18, 14, 0.12)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent)',
      color: 'var(--accent-foreground)',
    },
  },
  { dark: false },
);
