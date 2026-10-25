import { syntaxTree } from '@codemirror/language';
import type { Extension, Range } from '@codemirror/state';
import type { LinkableNote } from '../../../src/links/wikilink.js';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { taskList } from './taskList.js';
import { wikiLinks } from './wikiLinks.js';

const headingClass = new Map<string, string>([
  ['ATXHeading1', 'cm-heading cm-h1'],
  ['ATXHeading2', 'cm-heading cm-h2'],
  ['ATXHeading3', 'cm-heading cm-h3'],
  ['ATXHeading4', 'cm-heading cm-h4'],
  ['ATXHeading5', 'cm-heading cm-h5'],
  ['ATXHeading6', 'cm-heading cm-h6'],
]);

const hiddenMark = Decoration.mark({ class: 'cm-hidden' });
const strongMark = Decoration.mark({ class: 'cm-strong' });
const emphasisMark = Decoration.mark({ class: 'cm-emphasis' });
const inlineCodeMark = Decoration.mark({ class: 'cm-inline-code' });

class BulletWidget extends WidgetType {
  eq(other: BulletWidget): boolean {
    return other instanceof BulletWidget;
  }

  toDOM(): HTMLElement {
    const bullet = document.createElement('span');
    bullet.className = 'cm-list-bullet';
    bullet.textContent = '•';
    return bullet;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function isSelected(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some((range) => range.to > from && range.from < to);
}

function addLineClass(
  ranges: Range<Decoration>[],
  seen: Map<number, string>,
  lineFrom: number,
  className: string,
): void {
  const previous = seen.get(lineFrom);
  if (previous === className || previous?.includes(className) === true) return;
  seen.set(lineFrom, previous === undefined ? className : `${previous} ${className}`);
  ranges.push(Decoration.line({ class: className }).range(lineFrom));
}

function addBlockLines(
  view: EditorView,
  ranges: Range<Decoration>[],
  seen: Map<number, string>,
  from: number,
  to: number,
  className: string,
): void {
  const first = view.state.doc.lineAt(from).number;
  const last = view.state.doc.lineAt(to).number;
  for (let number = first; number <= last; number += 1) {
    addLineClass(ranges, seen, view.state.doc.line(number).from, className);
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const lineClasses = new Map<number, string>();

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;

        if (name === 'StrongEmphasis') {
          ranges.push(strongMark.range(node.from, node.to));
          return;
        }
        if (name === 'Emphasis') {
          ranges.push(emphasisMark.range(node.from, node.to));
          return;
        }
        if (name === 'InlineCode') {
          ranges.push(inlineCodeMark.range(node.from, node.to));
          return;
        }

        const headingClassName = headingClass.get(name);
        if (headingClassName !== undefined) {
          addLineClass(
            ranges,
            lineClasses,
            view.state.doc.lineAt(node.from).from,
            headingClassName,
          );
          return;
        }

        if (name === 'BulletList' || name === 'OrderedList') {
          addBlockLines(view, ranges, lineClasses, node.from, node.to, 'cm-list-item');
          return;
        }

        if (name === 'Blockquote') {
          addBlockLines(view, ranges, lineClasses, node.from, node.to, 'cm-blockquote');
          return;
        }

        if (name === 'FencedCode') {
          addBlockLines(view, ranges, lineClasses, node.from, node.to, 'cm-fenced-code');
          return;
        }

        if (name === 'Table' || name === 'TableHeader' || name === 'TableRow') {
          addBlockLines(view, ranges, lineClasses, node.from, node.to, 'cm-table-line');
          return;
        }

        if (name === 'ListMark') {
          if (isSelected(view, node.from, node.to)) return;
          const text = view.state.doc.sliceString(node.from, node.to);
          if (/^[-*+]$/.test(text)) {
            ranges.push(
              Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to),
            );
          }
          return;
        }

        if (
          name === 'HeaderMark' ||
          name === 'EmphasisMark' ||
          name === 'QuoteMark' ||
          name === 'CodeMark'
        ) {
          if (!isSelected(view, node.from, node.to)) {
            ranges.push(hiddenMark.range(node.from, node.to));
          }
        }
      },
    });
  }

  return Decoration.set(ranges, true);
}

class LiveMarkdownPlugin {
  decorations: DecorationSet = Decoration.none;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

export interface LiveMarkdownOptions {
  notes?: readonly LinkableNote[];
  onOpenNote?: (id: string) => void;
}

export function liveMarkdown(options: LiveMarkdownOptions = {}): Extension {
  const extensions: Extension[] = [
    ViewPlugin.fromClass(LiveMarkdownPlugin, {
      decorations: (value) => value.decorations,
    }),
    taskList(),
    EditorView.baseTheme({
      '.cm-hidden': { display: 'none' },
      '.cm-heading': { fontWeight: 600, lineHeight: 1.25 },
      '.cm-h1': { fontSize: '1.8em' },
      '.cm-h2': { fontSize: '1.5em' },
      '.cm-h3': { fontSize: '1.25em' },
      '.cm-h4': { fontSize: '1.1em' },
      '.cm-h5': { fontSize: '1em' },
      '.cm-h6': { fontSize: '0.9em', textTransform: 'uppercase' },
      '.cm-strong': { fontWeight: 700 },
      '.cm-emphasis': { fontStyle: 'italic' },
      '.cm-inline-code': {
        fontFamily: 'var(--font-mono)',
        backgroundColor: 'var(--muted)',
        padding: '0.1em 0.25em',
        borderRadius: '0.25rem',
      },
      '.cm-list-bullet': {
        display: 'inline-block',
        width: '1.2em',
        color: 'var(--muted-foreground)',
      },
      '.cm-list-item': { paddingLeft: '0.25rem' },
      '.cm-blockquote': {
        borderLeft: '3px solid var(--border)',
        paddingLeft: '0.75rem',
        color: 'var(--muted-foreground)',
      },
      '.cm-fenced-code': {
        fontFamily: 'var(--font-mono)',
        backgroundColor: 'var(--muted)',
        fontSize: '0.9em',
      },
      '.cm-table-line': {
        fontFamily: 'var(--font-mono)',
        fontSize: '0.9em',
        backgroundColor: 'color-mix(in oklab, var(--muted) 55%, transparent)',
      },
    }),
  ];

  if (options.notes !== undefined) {
    extensions.push(wikiLinks(options.notes, options.onOpenNote ?? (() => {})));
  }

  return extensions;
}
