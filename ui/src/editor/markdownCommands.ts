import { EditorSelection, Text, type ChangeSpec, type EditorState, type SelectionRange, type StateCommand } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { indentLess, indentMore, insertNewlineAndIndent, insertNewlineKeepIndent, isolateHistory } from '@codemirror/commands';
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';
import type { KeyBinding } from '@codemirror/view';
import { parseWikiLinks } from '../../../src/links/wikilink.js';

type Target = Parameters<StateCommand>[0];
type InlineKind = 'StrongEmphasis' | 'Emphasis' | 'Strikethrough' | 'InlineCode';
type RangeEdit = { changes?: ChangeSpec; range: SelectionRange };

function ancestor(state: EditorState, pos: number, names: readonly string[]) {
  const tree = ensureSyntaxTree(state, pos, 50) ?? syntaxTree(state);
  for (let node = tree.resolveInner(pos, pos === state.doc.length ? -1 : 1); node; node = node.parent!) {
    if (names.includes(node.name)) return node;
  }
  return null;
}

function applyRanges(target: Target, edit: (range: SelectionRange) => RangeEdit): boolean {
  if (target.state.readOnly) return false;
  const result = target.state.changeByRange(edit);
  if (result.changes.empty && result.selection.eq(target.state.selection)) return false;
  target.dispatch(target.state.update(result, {
    annotations: isolateHistory.of('full'), userEvent: 'input.markdown', scrollIntoView: true,
  }));
  return true;
}

function mappedRange(state: EditorState, range: SelectionRange, changes: ChangeSpec): SelectionRange {
  const map = state.changes(changes);
  if (range.empty) return EditorSelection.cursor(map.mapPos(range.head, 1));
  const from = map.mapPos(range.from, 1), to = map.mapPos(range.to, -1);
  return range.anchor > range.head ? EditorSelection.range(to, from) : EditorSelection.range(from, to);
}

/** Trim only selection-edge whitespace; never rewrite surrounding Markdown. */
function fragments(state: EditorState, range: SelectionRange) {
  const result: Array<{ from: number; to: number; text: string }> = [];
  let from = range.from;
  for (const text of state.doc.sliceString(range.from, range.to).split('\n')) {
    const leading = text.length - text.trimStart().length;
    const content = text.trim();
    if (content) result.push({ from: from + leading, to: from + leading + content.length, text: content });
    from += text.length + 1;
  }
  return result;
}

function longestTicks(text: string, minimum: number): number {
  let longest = minimum;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}

function wikiRanges(state: EditorState, range: SelectionRange) {
  const from = state.doc.lineAt(range.from).from, to = state.doc.lineAt(range.to).to;
  return parseWikiLinks(state.doc.sliceString(from, to)).map((link) => ({ from: from + link.start, to: from + link.end }));
}

function inline(kind: InlineKind, marker: string): StateCommand {
  return (target) => {
    const removed = new Set<string>();
    return applyRanges(target, (range) => {
      const { state } = target;
      if (wikiRanges(state, range).some((link) => range.empty ? range.head > link.from && range.head < link.to
        : range.to > link.from && range.from < link.to && !(range.from <= link.from && range.to >= link.to))) return { range };
      const literal = ancestor(state, range.from, ['FencedCode', 'CodeBlock', 'InlineCode']);
      if (literal && (literal.name !== 'InlineCode' || (range.from < literal.to && kind !== 'InlineCode'))) return { range };
      if (range.empty && range.from >= marker.length && state.doc.sliceString(range.from - marker.length, range.from) === marker
        && state.doc.sliceString(range.from, range.from + marker.length) === marker) {
        return { changes: { from: range.from - marker.length, to: range.from + marker.length }, range: EditorSelection.cursor(range.from - marker.length) };
      }
      const node = ancestor(state, range.from, [kind]);
      if (node && range.to <= node.to && (!range.empty || (range.from > node.from && range.from < node.to))) {
        const key = `${node.from}:${node.to}`;
        if (removed.has(key)) return { range };
        removed.add(key);
        const opening = node.firstChild!, closing = node.lastChild!;
        let from = opening.to, to = closing.from;
        // CommonMark removes one padding space around a code span, except when
        // its entire content is spaces. Remove that same padding when unwrapping.
        if (kind === 'InlineCode') {
          const content = state.doc.sliceString(from, to);
          if (content.startsWith(' ') && content.endsWith(' ') && content.trim()) { from++; to--; }
        }
        const changes = [{ from: node.from, to: from }, { from: to, to: node.to }];
        return { changes, range: mappedRange(state, range, changes) };
      }
      if (range.empty) {
        return { changes: { from: range.from, insert: marker + marker }, range: EditorSelection.cursor(range.from + marker.length) };
      }
      if (kind === 'InlineCode') {
        const text = state.doc.sliceString(range.from, range.to);
        if (text.includes('\n')) return { range }; // A fenced block is the multiline code action.
        const longest = longestTicks(text, 0);
        const fence = '`'.repeat(longest + 1);
        const padding = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ')) ? ' ' : '';
        const before = fence + padding, after = padding + fence;
        const changes = [{ from: range.from, insert: before }, { from: range.to, insert: after }];
        return { changes, range: EditorSelection.range(range.anchor + before.length, range.head + before.length) };
      }
      const parts = fragments(state, range).filter((part) => !ancestor(state, part.from, ['FencedCode', 'CodeBlock']));
      const nodes = parts.map((part) => ancestor(state, part.from, [kind]));
      const formatted = parts.map((part, index) => nodes[index] !== null && part.to <= nodes[index]!.to);
      const remove = parts.length > 0 && formatted.every(Boolean);
      const changes: ChangeSpec[] = [];
      parts.forEach((part, index) => {
        if (remove) {
          const node = nodes[index]!, key = `${node.from}:${node.to}`;
          if (removed.has(key)) return;
          removed.add(key);
          changes.push({ from: node.from, to: node.firstChild!.to }, { from: node.lastChild!.from, to: node.to });
        } else if (!formatted[index]) {
          changes.push({ from: part.from, insert: marker }, { from: part.to, insert: marker });
        }
      });
      return { changes, range: mappedRange(state, range, changes) };
    });
  };
}

export const toggleBold = inline('StrongEmphasis', '**');
export const toggleItalic = inline('Emphasis', '*');
export const toggleStrikethrough = inline('Strikethrough', '~~');
export const toggleInlineCode = inline('InlineCode', '`');

function selectedLines(state: EditorState) {
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(!range.empty && state.doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to).number;
    for (let n = first; n <= last; n++) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b).map((number) => state.doc.line(number));
}

function applyLines(target: Target, build: (lines: ReturnType<typeof selectedLines>) => ChangeSpec[]): boolean {
  if (target.state.readOnly) return false;
  const lines = selectedLines(target.state);
  if (lines.some((line) => ancestor(target.state, line.from + line.text.search(/\S|$/), ['FencedCode', 'CodeBlock']))) return false;
  const changes = target.state.changes(build(lines));
  if (changes.empty) return false;
  target.dispatch(target.state.update({ changes, selection: target.state.selection.map(changes),
    annotations: isolateHistory.of('full'), userEvent: 'input.markdown', scrollIntoView: true }));
  return true;
}

function prefix(text: string) {
  const container = /^[ \t]*(?:>[ \t]*)*/.exec(text)![0];
  const list = /^(?:[-+*]|\d+[.)])[ \t]+/.exec(text.slice(container.length))?.[0] ?? '';
  const task = list ? /^\[[ xX]\][ \t]+/.exec(text.slice(container.length + list.length))?.[0] ?? '' : '';
  return { container, list, content: container.length + list.length + task.length };
}

export function toggleHeading(level: number): StateCommand {
  return (target) => {
    if (!Number.isInteger(level) || level < 0 || level > 6) return false;
    return applyLines(target, (lines) => {
      const headings = lines.map((line) => /^(#{1,6})[ \t]+/.exec(line.text.slice(prefix(line.text).content))?.[0] ?? '');
      const remove = headings.every((heading) => heading.trim().length === level);
      return lines.flatMap((line, index) => {
        const from = line.from + prefix(line.text).content;
        const heading = headings[index]!;
        const changes = [{ from, to: from + heading.length, insert: remove || level === 0 ? '' : '#'.repeat(level) + ' ' }];
        if ((remove || level === 0) && heading) {
          const closing = /[ \t]+#+[ \t]*$/.exec(line.text.slice(prefix(line.text).content + heading.length));
          if (closing) changes.push({ from: from + heading.length + closing.index, to: line.to, insert: '' });
        }
        return changes;
      });
    });
  };
}

export const toggleBlockquote: StateCommand = (target) => applyLines(target, (lines) => {
  const remove = lines.every((line) => /^[ \t]*>/.test(line.text));
  return lines.flatMap((line) => {
    const indent = /^[ \t]*/.exec(line.text)![0].length;
    if (!remove && line.text[indent] === '>') return [];
    return [{ from: line.from + indent, to: line.from + indent + (remove ? /^>[ \t]?/.exec(line.text.slice(indent))![0].length : 0), insert: remove ? '' : '> ' }];
  });
});

export function toggleList(ordered: boolean): StateCommand {
  return (target) => applyLines(target, (lines) => {
    const remove = lines.every((line) => ordered ? /^\d/.test(prefix(line.text).list) : /^[-+*]/.test(prefix(line.text).list));
    const counters = new Map<string, number>();
    return lines.flatMap((line) => {
      if (lines.length > 1 && !line.text.trim()) { counters.clear(); return []; }
      const { container, list } = prefix(line.text);
      for (const key of counters.keys()) if (key.length > container.length) counters.delete(key);
      const number = counters.get(container) ?? (/^\d/.test(list) ? Number.parseInt(list, 10) : 1);
      counters.set(container, number + 1);
      return [{ from: line.from + container.length, to: line.from + container.length + list.length,
        insert: remove ? '' : ordered ? `${number}. ` : '- ' }];
    });
  });
}

export function insertCodeBlock(language = ''): StateCommand {
  return (target) => {
    if (!/^[\w.+#-]{0,64}$/.test(language)) return false;
    const updated = new Set<number>();
    return applyRanges(target, (range) => {
      const { state } = target;
      const existing = ancestor(state, range.from, ['FencedCode']);
      if (existing && (range.to <= existing.to || !state.doc.sliceString(existing.to, range.to).trim())) {
        const line = state.doc.lineAt(existing.from);
        if (updated.has(line.from)) return { range };
        updated.add(line.from);
        const mark = /^(\s*(?:`{3,}|~{3,}))[^\r\n]*/.exec(line.text);
        if (!mark) return { range };
        const changes = { from: line.from + mark[1]!.length, to: line.to, insert: language };
        return { changes, range: mappedRange(state, range, changes) };
      }
      const text = state.doc.sliceString(range.from, range.to);
      const longest = longestTicks(text, 2);
      const fence = '`'.repeat(longest + 1);
      const before = (range.from > state.doc.lineAt(range.from).from ? '\n' : '') + fence + language + '\n';
      const after = (text.endsWith('\n') ? '' : '\n') + fence + (range.to < state.doc.lineAt(range.to).to ? '\n' : '');
      return { changes: { from: range.from, to: range.to, insert: Text.of((before + text + after).split('\n')) },
        range: range.empty ? EditorSelection.cursor(range.from + before.length)
          : EditorSelection.range(range.anchor + before.length, range.head + before.length) };
    });
  };
}

function escapeLabel(text: string): string {
  return text.replace(/\\.|[\[\]]/g, (part) => part.length === 1 ? `\\${part}` : part);
}

export function insertMarkdownLink(destination = ''): StateCommand {
  return (target) => {
    const updated = new Set<number>();
    return applyRanges(target, (range) => {
      const { state } = target;
      if (wikiRanges(state, range).some((link) => range.empty ? range.from >= link.from && range.from < link.to
        : range.to > link.from && range.from < link.to)) return { range };
      const literal = ancestor(state, range.from, ['InlineCode', 'FencedCode', 'CodeBlock']);
      if (literal && (literal.name !== 'InlineCode' || range.from < literal.to)) return { range };
      const url = destination.trim().replace(/[\s()<>\\]/g, (char) => char === '(' ? '%28' : char === ')' ? '%29' : encodeURIComponent(char));
      const existing = ancestor(state, range.from, ['Link', 'Autolink']);
      if (existing && (range.to <= existing.to || !state.doc.sliceString(existing.to, range.to).trim())) {
        const node = existing.getChild('URL');
        if (!node) return { range };
        if (updated.has(node.from)) return { range };
        updated.add(node.from);
        return { changes: url ? { from: node.from, to: node.to, insert: url } : [],
          range: EditorSelection.range(node.from, node.from + (url || state.doc.sliceString(node.from, node.to)).length) };
      }
      const parts = range.empty ? [{ from: range.from, to: range.to, text: 'link text' }]
        : fragments(state, range).filter((part) => !ancestor(state, part.from, ['FencedCode', 'CodeBlock']));
      const changes: ChangeSpec[] = [];
      const wrapped = parts.map((part) => {
        const link = ancestor(state, part.from, ['Link', 'Autolink']);
        if (link && link.from === part.from && link.to === part.to) {
          const node = link.getChild('URL');
          if (node && url) changes.push({ from: node.from, to: node.to, insert: url });
          return false;
        }
        changes.push({ from: part.from, to: part.to, insert: `[${escapeLabel(part.text)}](${url || 'https://'})` });
        return true;
      });
      if (parts.length === 0) return { range };
      if (parts.length > 1) {
        const map = state.changes(changes), first = parts[0]!, last = parts.at(-1)!;
        const from = map.mapPos(first.from, -1) + (wrapped[0] ? 1 : 0);
        const to = map.mapPos(last.to, 1) - (wrapped.at(-1) ? (url || 'https://').length + 3 : 0);
        return { changes, range: range.anchor > range.head ? EditorSelection.range(to, from) : EditorSelection.range(from, to) };
      }
      if (!wrapped[0]) return { changes, range: mappedRange(state, range, changes) };
      const part = parts[0]!, label = escapeLabel(part.text);
      const from = part.from + (range.empty || url ? 1 : label.length + 3);
      const to = from + (range.empty || url ? label.length : 'https://'.length);
      return { changes, range: EditorSelection.range(range.anchor > range.head ? to : from, range.anchor > range.head ? from : to) };
    });
  };
}

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });
export const markdownEnter: StateCommand = (target) => {
  const { state } = target;
  const unclosedOpening = (range: SelectionRange) => {
    const code = ancestor(state, range.head, ['FencedCode']);
    const line = state.doc.lineAt(range.head);
    if (!range.empty || !code || line.to !== range.head || state.doc.lineAt(code.from).number !== line.number
      || code.getChildren('CodeMark').length !== 1) return null;
    return /^( {0,3})(`{3,}|~{3,})/.exec(line.text);
  };
  if (state.selection.ranges.every(unclosedOpening)) {
    return applyRanges(target, (range) => {
      const mark = unclosedOpening(range)!;
      return { changes: { from: range.from, insert: Text.of(['', mark[1]!, mark[1]! + mark[2]!]) },
        range: EditorSelection.cursor(range.from + 1 + mark[1]!.length) };
    });
  }
  const inCode = state.selection.ranges.every((range) => {
    const code = ancestor(state, range.head, ['FencedCode']);
    return code && state.doc.lineAt(range.head).number > state.doc.lineAt(code.from).number
      && !/^\s*(?:`{3,}|~{3,})\s*$/.test(state.doc.lineAt(range.head).text);
  });
  return inCode ? insertNewlineKeepIndent(target) : continueMarkup(target) || insertNewlineAndIndent(target);
};

function indentContext(state: EditorState): boolean {
  return state.selection.ranges.every((range) => ancestor(state, range.head === state.doc.lineAt(range.head).to && range.head > 0 ? range.head - 1 : range.head, ['ListItem', 'FencedCode', 'CodeBlock'])
    || (!range.empty && state.doc.lineAt(range.from).number !== state.doc.lineAt(range.to).number));
}
export const indentMarkdown: StateCommand = (target) => indentContext(target.state) && indentMore(target);
export const outdentMarkdown: StateCommand = (target) => indentContext(target.state) && indentLess(target);

function formattingKey(key: string, command: StateCommand): KeyBinding {
  return { key, run: (view) => {
    command(view);
    // A formatting no-op must not fall through to another CodeMirror command
    // (notably its default Mod-Shift-k delete-line binding) or a global shortcut.
    return true;
  }, preventDefault: true };
}

export const markdownEditingKeymap: readonly KeyBinding[] = [
  { key: 'Enter', run: markdownEnter },
  { key: 'Backspace', run: deleteMarkupBackward },
  { key: 'Tab', run: indentMarkdown, shift: outdentMarkdown },
  formattingKey('Mod-b', toggleBold),
  formattingKey('Mod-i', toggleItalic),
  formattingKey('Mod-Shift-x', toggleStrikethrough),
  formattingKey('Mod-e', toggleInlineCode),
  formattingKey('Mod-Shift-k', insertMarkdownLink()),
  formattingKey('Mod-Shift-c', insertCodeBlock()),
  ...Array.from({ length: 7 }, (_, level) => formattingKey(`Mod-Alt-${level}`, toggleHeading(level))),
  formattingKey('Mod-Shift-7', toggleList(true)),
  formattingKey('Mod-Shift-8', toggleList(false)),
];
