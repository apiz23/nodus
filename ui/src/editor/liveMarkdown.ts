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
const strikethroughMark = Decoration.mark({ class: 'cm-strikethrough' });
const inlineCodeMark = Decoration.mark({ class: 'cm-inline-code' });
const linkLabelMark = Decoration.mark({ class: 'cm-md-link' });

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
        if (name === 'Strikethrough') {
          ranges.push(strikethroughMark.range(node.from, node.to));
          return;
        }
        if (name === 'InlineCode') {
          ranges.push(inlineCodeMark.range(node.from, node.to));
          return;
        }

        if (name === 'Link') {
          // Inline links parse as Link > LinkMark("[") text LinkMark("]") …;
          // style the visible label span between the brackets.
          const doc = view.state.doc;
          if (doc.sliceString(node.from, node.from + 1) === '[') {
            let labelEnd = -1;
            for (let pos = node.from + 1; pos < node.to; pos += 1) {
              if (doc.sliceString(pos, pos + 1) === ']') {
                labelEnd = pos;
                break;
              }
            }
            if (labelEnd > node.from + 1) {
              ranges.push(linkLabelMark.range(node.from + 1, labelEnd));
            }
          }
        }

        if (name === 'LinkLabel') {
          ranges.push(linkLabelMark.range(node.from, node.to));
        }

        if (name === 'LinkMark') {
          if (!isSelected(view, node.from, node.to)) {
            ranges.push(hiddenMark.range(node.from, node.to));
          }
          return;
        }

        if (name === 'URL') {
          const before =
            node.from > 0 ? view.state.doc.sliceString(node.from - 1, node.from) : '';
          if (before === '(' && !isSelected(view, node.from, node.to)) {
            ranges.push(hiddenMark.range(node.from, node.to));
          }
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
          name === 'StrikethroughMark' ||
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
      '.cm-heading': { fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.015em' },
      '.cm-h1': { fontSize: '1.7em', paddingTop: '0.55em' },
      '.cm-h2': { fontSize: '1.4em', paddingTop: '0.5em' },
      '.cm-h3': { fontSize: '1.2em', paddingTop: '0.45em' },
      '.cm-h4': { fontSize: '1.1em', paddingTop: '0.4em' },
      '.cm-h5': { fontSize: '1em', paddingTop: '0.35em' },
      '.cm-h6': {
        fontSize: '0.9em',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        paddingTop: '0.3em',
      },
      '.cm-strong': { fontWeight: 650 },
      '.cm-emphasis': { fontStyle: 'italic' },
      '.cm-strikethrough': { textDecoration: 'line-through' },
      '.cm-md-link': {
        color: 'var(--success)',
        textDecoration: 'underline',
        textDecorationThickness: '1px',
        textUnderlineOffset: '0.18em',
        textDecorationColor: 'color-mix(in oklab, var(--success) 45%, transparent)',
      },
      '.cm-inline-code': {
        fontFamily: 'var(--font-mono)',
        backgroundColor: 'var(--muted)',
        padding: '0.1em 0.3em',
        borderRadius: '0.3rem',
        fontSize: '0.9em',
      },
      '.cm-list-bullet': {
        display: 'inline-block',
        width: '1.05em',
        textAlign: 'center',
        color: 'var(--success)',
        fontSize: '0.95em',
      },
      '.cm-list-item': { paddingLeft: '0.15rem' },
      '.cm-blockquote': {
        borderLeft: '2px solid var(--border)',
        paddingLeft: '0.9rem',
        color: 'var(--muted-foreground)',
        fontStyle: 'italic',
      },
      '.cm-fenced-code': {
        fontFamily: 'var(--font-mono)',
        backgroundColor: 'var(--muted)',
        fontSize: '0.88em',
        lineHeight: '1.6',
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
