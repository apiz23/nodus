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
import type { LinkableNote } from '../../../src/links/wikilink.js';
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
): DecorationSet {
  const ranges: Range<Decoration>[] = [];

  for (const link of collectWikiLinksInRanges(view.state, notes, view.visibleRanges)) {
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

  constructor(
    readonly view: EditorView,
    readonly notes: readonly LinkableNote[],
    readonly onOpenNote: (id: string) => void,
  ) {
    this.decorations = buildWikiLinkDecorations(view, notes, onOpenNote);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = buildWikiLinkDecorations(
        update.view,
        this.notes,
        this.onOpenNote,
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
