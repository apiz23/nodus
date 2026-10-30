import { useCallback, useEffect, useRef, useState } from 'react';
import { Annotation, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorView, keymap } from '@codemirror/view';
import type { LinkableNote } from '../../../src/links/wikilink.js';
import { createEditorState, getDocumentString } from './createEditorState.js';
import { liveMarkdown } from './liveMarkdown.js';
import { editorTheme } from './theme.js';
import { MarkdownToolbar } from './MarkdownToolbar.js';
import { AttachmentBrowser } from './AttachmentBrowser.js';
import { Button } from '@/components/ui/button';
import { api } from '../api.js';
import { attachmentMarkdown, insertAttachmentMarkdown } from './attachmentMarkdown.js';

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
  const bookmarkRef = useRef<number | null>(null);
  const uploadBookmarksRef = useRef(new Set<{ position: number }>());
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState('');

  propsRef.current = props;
  onOpenNoteRef.current = props.onOpenNote;

  const openNote = useCallback((id: string) => {
    onOpenNoteRef.current?.(id);
  }, []);

  const rememberCursor = useCallback((view: EditorView) => {
    bookmarkRef.current = view.state.selection.main.head;
  }, []);

  const insertAtPosition = useCallback((markdown: readonly string[], position: number, focus = true) => {
    const view = viewRef.current;
    if (view === null || markdown.length === 0) return;
    const at = Math.max(0, Math.min(position, view.state.doc.length));
    const result = insertAttachmentMarkdown(getDocumentString(view.state), at, markdown);
    view.dispatch({ changes: { from: result.at, to: result.at, insert: result.inserted }, selection: { anchor: result.cursor }, userEvent: 'input' });
    if (focus) view.focus();
    bookmarkRef.current = result.cursor;
  }, []);

  const insertAtBookmark = useCallback((markdown: readonly string[]) => {
    const view = viewRef.current;
    if (view !== null) insertAtPosition(markdown, bookmarkRef.current ?? view.state.selection.main.head, false);
  }, [insertAtPosition]);

  const uploadImages = useCallback(async (view: EditorView, files: File[], position: number) => {
    const images = files.filter((file) => file.type.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|avif)$/i.test(file.name));
    if (!images.length) return false;
    if (images.length > 10 || images.some((file) => file.size > 10 * 1024 * 1024) || images.reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) {
      setAttachmentStatus('Images are limited to 10 files and 25 MiB total per paste or drop; each file must be 10 MiB or smaller.');
      return true;
    }
    const bookmark = { position };
    uploadBookmarksRef.current.add(bookmark);
    setAttachmentStatus('Uploading image…');
    const markdown: string[] = [];
    const errors: string[] = [];
    try {
      for (const file of images) {
        try {
          const { attachment } = await api.uploadAttachment(file);
          if (viewRef.current !== view) return true;
          markdown.push(attachmentMarkdown(propsRef.current.notePath, attachment));
        } catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : 'upload failed'}`); }
      }
      if (viewRef.current === view && markdown.length) insertAtPosition(markdown, bookmark.position);
      if (viewRef.current === view) setAttachmentStatus(errors.length ? `${markdown.length} uploaded; ${errors.join(' · ')}` : `${markdown.length} image${markdown.length === 1 ? '' : 's'} uploaded and inserted.`);
    } finally { uploadBookmarksRef.current.delete(bookmark); }
    return true;
  }, [insertAtPosition]);

  useEffect(() => {
    if (ref.current === null) return undefined;

    const initial = propsRef.current;
    const onChangeExtension = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        if (bookmarkRef.current !== null) bookmarkRef.current = update.changes.mapPos(bookmarkRef.current, 1);
        for (const bookmark of uploadBookmarksRef.current) bookmark.position = update.changes.mapPos(bookmark.position, 1);
      }
      if (!update.docChanged) return;
      const isRemote = update.transactions.some((tr) => tr.annotation(remoteAnnotation));
      if (isRemote) return;
      const next = getDocumentString(update.state);
      if (next !== propsRef.current.value) {
        propsRef.current.onChange(next);
      }
    });
    const attachmentEvents = EditorView.domEventHandlers({
      paste(event, view) {
        const clipboard = (event as ClipboardEvent).clipboardData;
        if (!clipboard) return false;
        const files = Array.from(clipboard.items).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((file): file is File => file !== null);
        if (!files.some((file) => file.type.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|avif)$/i.test(file.name))) return false;
        event.preventDefault();
        void uploadImages(view, files, view.state.selection.main.head);
        return true;
      },
      dragover(event) {
        if (Array.from((event as DragEvent).dataTransfer?.types ?? []).includes('Files')) { event.preventDefault(); return true; }
        return false;
      },
      drop(event, view) {
        const transfer = (event as DragEvent).dataTransfer;
        const files = transfer ? Array.from(transfer.files) : [];
        if (!files.some((file) => file.type.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|avif)$/i.test(file.name))) return false;
        event.preventDefault();
        const position = view.posAtCoords({ x: (event as DragEvent).clientX, y: (event as DragEvent).clientY }) ?? view.state.selection.main.head;
        void uploadImages(view, files, position);
        return true;
      },
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
          attachmentEvents,
        ],
      }),
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [openNote, uploadImages]);

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
    <div className={props.className}>
      <div className="mb-2 flex items-center gap-2">
      <MarkdownToolbar onCommand={(command) => {
        const view = viewRef.current;
        return view !== null && command(view);
      }} onFocus={() => viewRef.current?.focus()} />
      <Button type="button" variant="ghost" size="xs" onMouseDown={(event) => event.preventDefault()} onClick={() => { if (viewRef.current) rememberCursor(viewRef.current); setAttachmentsOpen(true); }} aria-label="Open attachments">Attachments</Button>
      </div>
      {attachmentStatus && <p role="status" className="mb-2 text-xs text-muted-foreground">{attachmentStatus}</p>}
      <div ref={ref} />
      <AttachmentBrowser open={attachmentsOpen} onOpenChange={(next) => { setAttachmentsOpen(next); if (!next) viewRef.current?.focus(); }} notePath={props.notePath} noteBody={props.value} onInsert={insertAtBookmark} />
    </div>
  );
}
