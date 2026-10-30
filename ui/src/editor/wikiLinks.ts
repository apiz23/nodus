import { EditorSelection, type EditorState, type Range } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { createLinkResolver, type LinkableNote } from '../../../src/links/wikilink.js';
import {
  collectWikiLinksInRanges,
  wikiLinkLabel,
  type WikiLinkInfo,
} from './wikiLinkData.js';

function intersectsSelection(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.to > from && range.from < to);
}

function labelFor(link: WikiLinkInfo, notes: readonly LinkableNote[]): string {
  return wikiLinkLabel(link, notes);
}

class WikiLinkWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly link: WikiLinkInfo,
    readonly notes: readonly LinkableNote[],
    readonly onOpenNote: (id: string) => void,
  ) {
    super();
  }

  eq(other: WikiLinkWidget): boolean {
    return (
      other.from === this.from &&
      other.link.target === this.link.target &&
      other.link.display === this.link.display &&
      other.link.status === this.link.status &&
      other.link.noteId === this.link.noteId &&
      other.link.candidateIds?.join(',') === this.link.candidateIds?.join(',')
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const link = document.createElement('span');
    let touchTapPending = false;
    let touchStart: { x: number; y: number } | null = null;
    let moved = false;
    link.className = `cm-wikilink cm-wikilink-${this.link.status}`;
    link.textContent = this.link.display;
    link.title = labelFor(this.link, this.notes);
    link.setAttribute('aria-label', link.title);

    if (this.link.status === 'resolved') {
      link.setAttribute('role', 'link');
      link.tabIndex = 0;
      const open = () => {
        if (this.link.noteId !== undefined) this.onOpenNote(this.link.noteId);
      };
      link.addEventListener('pointerdown', (event) => {
        touchTapPending = event.pointerType === 'touch';
        touchStart = touchTapPending ? { x: event.clientX, y: event.clientY } : null;
        moved = false;
      });
      link.addEventListener('pointermove', (event) => {
        if (!touchTapPending || touchStart === null) return;
        if (Math.abs(event.clientX - touchStart.x) > 8 || Math.abs(event.clientY - touchStart.y) > 8) moved = true;
      });
      link.addEventListener('pointercancel', () => {
        touchTapPending = false;
        touchStart = null;
        moved = false;
      });
      link.addEventListener('click', (event) => {
        if (!touchTapPending) return;
        event.preventDefault();
        event.stopPropagation();
        if (!moved) open();
        touchTapPending = false;
        touchStart = null;
        moved = false;
      });
      link.addEventListener('mousedown', (event) => {
        if (!event.metaKey && !event.ctrlKey) return;
        event.preventDefault();
        open();
      });
      link.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      });
    }

    link.addEventListener('mousedown', (event) => {
      if (this.link.status === 'resolved' && (event.metaKey || event.ctrlKey)) return;
      if (this.link.status === 'resolved' && touchTapPending) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      view.focus();
      view.dispatch({ selection: EditorSelection.cursor(this.from) });
    });

    return link;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildWikiLinkDecorations(
  view: EditorView,
  notes: readonly LinkableNote[],
  onOpenNote: (id: string) => void,
  resolve: ReturnType<typeof createLinkResolver>,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];

  for (const link of collectWikiLinksInRanges(view.state, notes, view.visibleRanges, resolve)) {
    if (intersectsSelection(view.state, link.from, link.to)) continue;
    ranges.push(
      Decoration.replace({
        widget: new WikiLinkWidget(link.from, link, notes, onOpenNote),
      }).range(link.from, link.to),
    );
  }

  return Decoration.set(ranges, true);
}

class WikiLinkPlugin {
  decorations: DecorationSet = Decoration.none;
  private readonly resolve: ReturnType<typeof createLinkResolver>;

  constructor(
    readonly view: EditorView,
    readonly notes: readonly LinkableNote[],
    readonly onOpenNote: (id: string) => void,
  ) {
    this.resolve = createLinkResolver(notes);
    this.decorations = buildWikiLinkDecorations(view, notes, onOpenNote, this.resolve);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = buildWikiLinkDecorations(
        update.view,
        this.notes,
        this.onOpenNote,
        this.resolve,
      );
    }
  }
}

export function wikiLinks(
  notes: readonly LinkableNote[],
  onOpenNote: (id: string) => void,
): Extension {
  return [
    ViewPlugin.define(
      (view) => new WikiLinkPlugin(view, notes, onOpenNote),
      { decorations: (value) => value.decorations },
    ),
    EditorView.baseTheme({
      '.cm-wikilink': {
        color: 'var(--success)',
        textDecoration: 'underline',
        textDecorationThickness: '1px',
        textUnderlineOffset: '0.18em',
        textDecorationColor: 'color-mix(in oklab, var(--success) 45%, transparent)',
        cursor: 'pointer',
      },
      '.cm-wikilink-unresolved': {
        color: 'var(--muted-foreground)',
        textDecorationStyle: 'dashed',
      },
      '.cm-wikilink-ambiguous': {
        color: 'var(--muted-foreground)',
        textDecorationStyle: 'dotted',
      },
      '.cm-wikilink:focus-visible': {
        outline: '2px solid var(--ring)',
        outlineOffset: '2px',
        borderRadius: '2px',
      },
    }),
  ];
}
