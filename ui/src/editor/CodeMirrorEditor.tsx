import { useCallback, useEffect, useRef } from 'react';
import { Annotation, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorView, keymap } from '@codemirror/view';
import type { LinkableNote } from '../../../src/links/wikilink.js';
import { createEditorState, getDocumentString } from './createEditorState.js';
import { liveMarkdown } from './liveMarkdown.js';
import { editorTheme } from './theme.js';

const remoteAnnotation = Annotation.define<boolean>();
const liveCompartment = new Compartment();

export interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  mode?: 'source' | 'live';
  notes?: readonly LinkableNote[];
  onOpenNote?: (id: string) => void;
  notePath: string;
  className?: string;
  'aria-label'?: string;
}

export function CodeMirrorEditor(props: CodeMirrorEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  const onOpenNoteRef = useRef(props.onOpenNote);

  propsRef.current = props;
  onOpenNoteRef.current = props.onOpenNote;

  const openNote = useCallback((id: string) => {
    onOpenNoteRef.current?.(id);
  }, []);

  useEffect(() => {
    if (ref.current === null) return undefined;

    const initial = propsRef.current;
    const onChangeExtension = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const isRemote = update.transactions.some((tr) => tr.annotation(remoteAnnotation));
      if (isRemote) return;
      const next = getDocumentString(update.state);
      if (next !== propsRef.current.value) {
        propsRef.current.onChange(next);
      }
    });

    const live = initial.mode === 'live';
    const view = new EditorView({
      parent: ref.current,
      state: createEditorState({
        doc: initial.value,
        extensions: [
          editorTheme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': initial['aria-label'] ?? 'Markdown body',
            'aria-multiline': 'true',
          }),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          liveCompartment.of(
            live ? liveMarkdown({ notes: initial.notes, onOpenNote: openNote }) : [],
          ),
          onChangeExtension,
        ],
      }),
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [openNote]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const current = getDocumentString(view.state);
    if (current === props.value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: props.value },
      annotations: [remoteAnnotation.of(true)],
    });
  }, [props.value]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    view.dispatch({
      effects: liveCompartment.reconfigure(
        props.mode === 'live'
          ? liveMarkdown({ notes: props.notes, onOpenNote: openNote })
          : [],
      ),
    });
  }, [openNote, props.mode, props.notes]);

  return (
    <div
      ref={ref}
      className={props.className}
    />
  );
}
