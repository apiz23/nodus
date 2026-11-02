import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';

type SyntaxTree = ReturnType<typeof syntaxTree>;

export interface DocumentHeading {
  id: string;
  level: number;
  text: string;
  from: number;
  line: number;
}

export interface DocumentOutlineNode extends DocumentHeading {
  children: DocumentOutlineNode[];
}

export interface DocumentOutlineCallbacks {
  onOutlineChange?: (headings: readonly DocumentHeading[]) => void;
  onActiveHeadingChange?: (id: string | null) => void;
}

export function headingText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => label ?? target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\](?:\[[^\]]*\])?/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/\\([\\`*_{}\[\]()#+.!<>|])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function headingSlug(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/[\s]+/g, '-');
}

export function uniqueHeadingId(text: string, used: Map<string, number>): string {
  const base = headingSlug(text);
  const key = base || 'section';
  let count = used.get(`base:${key}`) ?? 0;
  let id = count ? `${key}-${count + 1}` : key;
  while (used.has(`id:${id}`)) {
    count += 1;
    id = `${key}-${count + 1}`;
  }
  used.set(`base:${key}`, count + 1);
  used.set(`id:${id}`, 1);
  return id;
}

export function extractDocumentOutline(state: EditorState, tree: SyntaxTree = syntaxTree(state)): DocumentHeading[] {
  const used = new Map<string, number>();
  const headings: DocumentHeading[] = [];
  tree.iterate({
    enter(node) {
      const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (!match) return;
      const level = Number(match[1]);
      const children: Array<{ name: string; from: number; to: number }> = [];
      for (let child = node.node.firstChild; child; child = child.nextSibling) children.push(child);
      const mark = children.find((child) => child.name === 'HeaderMark');
      let from = node.name.startsWith('ATX') ? mark?.to ?? node.from : node.from;
      let to = node.name.startsWith('ATX') ? node.to : mark?.from ?? node.to;
      const source = state.doc.sliceString(from, to);
      if (node.name.startsWith('ATX')) to -= /[ \t]+#+[ \t]*$/.exec(source)?.[0].length ?? 0;
      while (from < to && /[ \t]/.test(state.doc.sliceString(from, from + 1))) from += 1;
      while (to > from && /[ \t\r\n]/.test(state.doc.sliceString(to - 1, to))) to -= 1;
      const text = headingText(state.doc.sliceString(from, to));
      headings.push({ id: uniqueHeadingId(text, used), level, text, from: node.from, line: state.doc.lineAt(node.from).number });
    },
  });
  return headings;
}

export function buildOutlineTree(headings: readonly DocumentHeading[]): DocumentOutlineNode[] {
  const roots: DocumentOutlineNode[] = [];
  const parents: DocumentOutlineNode[] = [];
  for (const heading of headings) {
    const node: DocumentOutlineNode = { ...heading, children: [] };
    while (parents.length && parents.at(-1)!.level >= node.level) parents.pop();
    const parent = parents.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
    parents.push(node);
  }
  return roots;
}

export function activeHeadingAt(headings: readonly DocumentHeading[], position: number): string | null {
  let low = 0;
  let high = headings.length - 1;
  let active: string | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const heading = headings[middle]!;
    if (heading.from <= position) {
      active = heading.id;
      low = middle + 1;
    } else high = middle - 1;
  }
  return active;
}

export function outlineForNavigation(state: EditorState, id: string): DocumentHeading | undefined {
  const tree = ensureSyntaxTree(state, state.doc.length, 30) ?? syntaxTree(state);
  return extractDocumentOutline(state, tree).find((heading) => heading.id === id);
}

export function documentOutline(
  callbacks: () => DocumentOutlineCallbacks,
): Extension {
  return ViewPlugin.fromClass(class {
    private headings: DocumentHeading[] = [];
    private activeId: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private generation = 0;
    private destroyed = false;

    constructor(private readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) this.schedule();
      else if (update.selectionSet && this.timer === null) this.reportActive(update.state.selection.main.head);
    }

    destroy(): void {
      this.destroyed = true;
      this.generation += 1;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    }

    private schedule(): void {
      this.generation += 1;
      const generation = this.generation;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.parse(generation), 120);
    }

    private parse(generation: number): void {
      this.timer = null;
      if (this.destroyed || generation !== this.generation) return;
      const state = this.view.state;
      const tree = ensureSyntaxTree(state, state.doc.length, 25);
      if (generation !== this.generation || this.destroyed) return;
      if (tree === null || tree.length < state.doc.length) {
        this.timer = setTimeout(() => this.parse(generation), 20);
        return;
      }
      const next = extractDocumentOutline(state, tree);
      if (!sameHeadings(this.headings, next)) {
        this.headings = next;
        callbacks().onOutlineChange?.(next);
      }
      this.reportActive(state.selection.main.head);
    }

    private reportActive(position: number): void {
      const active = activeHeadingAt(this.headings, position);
      if (active === this.activeId) return;
      this.activeId = active;
      callbacks().onActiveHeadingChange?.(active);
    }
  });
}

function sameHeadings(left: readonly DocumentHeading[], right: readonly DocumentHeading[]): boolean {
  return left.length === right.length && left.every((heading, index) => {
    const next = right[index]!;
    return heading.id === next.id && heading.level === next.level && heading.text === next.text && heading.from === next.from;
  });
}
