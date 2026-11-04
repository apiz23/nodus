import { createHash } from 'node:crypto';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Note } from '../domain/note.js';
import { isDateOnly } from '../temporal/date.js';

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskDateStatus = 'missing' | 'valid' | 'invalid';
export type TaskCounts = { total: number; open: number; completed: number; notesWithTasks: number };

export interface ExtractedTask {
  /** Projection-local identity. It is derived from Markdown and is not persisted. */
  id: string;
  noteId: string;
  noteTitle: string;
  notePath: string;
  noteContentHash: string;
  text: string;
  checked: boolean;
  line: number;
  from: number;
  to: number;
  markerFrom: number;
  markerTo: number;
  depth: number;
  parentId: string | null;
  heading: string | null;
  headingLine: number | null;
  dueDate: string | null;
  /** New temporal metadata is optional on the public shape for Phase 27 DTO compatibility. */
  dueDateStatus?: TaskDateStatus;
  scheduledDate?: string | null;
  scheduledDateStatus?: TaskDateStatus;
  priority: TaskPriority | null;
}

export interface TaskMetadata {
  text: string;
  dueDate: string | null;
  dueDateStatus: TaskDateStatus;
  scheduledDate: string | null;
  scheduledDateStatus: TaskDateStatus;
  priority: TaskPriority | null;
}

export interface TaskProjection {
  tasks: ExtractedTask[];
  counts: TaskCounts;
  scannedNotes: number;
  truncated: boolean;
}

export interface TaskExtractionOptions {
  maxTasks?: number;
}

type SyntaxNode = ReturnType<typeof markdownLanguage.parser.parse>['topNode'];
type Heading = { from: number; line: number; text: string };
type MutableTask = Omit<ExtractedTask, 'parentId'> & { node: SyntaxNode };
const DEFAULT_MAX_TASKS = 50_000;

/**
 * Extract GFM checklist items with the same Lezer Markdown grammar used by
 * Nodus's editor. Code fences and inline code are excluded by the parser.
 */
export function extractTasksFromBody(
  body: string,
  note: Pick<Note, 'id' | 'title' | 'path'>,
  noteContentHash = '',
): ExtractedTask[] {
  const tree = markdownLanguage.parser.parse(body);
  const headings = collectHeadings(tree.topNode, body);
  const lineStarts = [0];
  for (let index = 0; index < body.length; index++) if (body.charCodeAt(index) === 10) lineStarts.push(index + 1);
  const lineAt = (position: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStarts[middle]! <= position) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
  const byFrom = new Map<number, MutableTask>();
  tree.iterate({
    enter(node) {
      if (node.name !== 'Task') return;
      const marker = directChild(node.node, 'TaskMarker');
      if (!marker) return;
      // The Task node includes continuation paragraphs and stops before a
      // nested list. Mask inline-code nodes before parsing trailing tokens.
      const raw = body.slice(marker.to, node.to);
      const metadata = parseMarkdownTaskMetadata(raw, marker.to, node.node);
      const line = lineAt(node.from);
      const heading = headingBefore(headings, node.from);
      const task: MutableTask = {
        id: createHash('sha256').update(`${note.id}\0${line}\0${metadata.text}`).digest('hex').slice(0, 24),
        noteId: note.id,
        noteTitle: note.title,
        notePath: note.path,
        noteContentHash,
        text: metadata.text,
        checked: body.slice(marker.from, marker.to).toLowerCase() === '[x]',
        line,
        from: node.from,
        to: node.to,
        markerFrom: marker.from,
        markerTo: marker.to,
        depth: listDepth(node.node),
        heading: heading?.text ?? null,
        headingLine: heading?.line ?? null,
        dueDate: metadata.dueDate,
        dueDateStatus: metadata.dueDateStatus,
        scheduledDate: metadata.scheduledDate,
        scheduledDateStatus: metadata.scheduledDateStatus,
        priority: metadata.priority,
        node: node.node,
      };
      byFrom.set(task.from, task);
    },
  });

  const tasks: ExtractedTask[] = [];
  for (const task of [...byFrom.values()].sort((left, right) => left.from - right.from)) {
    let parentId: string | null = null;
    for (let ancestor = task.node.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.name !== 'ListItem') continue;
      const parent = directChild(ancestor, 'Task');
      if (parent && parent.from !== task.from) {
        parentId = byFrom.get(parent.from)?.id ?? null;
        if (parentId !== null) break;
      }
    }
    const { node: _node, ...rest } = task;
    tasks.push({ ...rest, parentId });
  }
  return tasks;
}

export function extractTasksFromNote(note: Note, noteContentHash: string): ExtractedTask[] {
  return extractTasksFromBody(note.body, note, noteContentHash);
}

/** Rebuild a Markdown-derived vault projection; task objects are never stored. */
export function buildTaskProjection(
  notes: readonly Note[],
  hashes: ReadonlyMap<string, string> = new Map(),
  options: TaskExtractionOptions = {},
  previous?: TaskProjection,
): TaskProjection {
  const maxTasks = Math.max(1, options.maxTasks ?? DEFAULT_MAX_TASKS);
  const previousByNote = new Map<string, { key: string; tasks: ExtractedTask[] }>();
  for (const task of previous?.tasks ?? []) {
    const entry = previousByNote.get(task.noteId);
    if (entry === undefined) previousByNote.set(task.noteId, { key: `${task.noteContentHash}\0${task.noteTitle}\0${task.notePath}`, tasks: [task] });
    else entry.tasks.push(task);
  }
  const sortedNotes = [...notes].sort((left, right) => left.path.localeCompare(right.path) || left.id.localeCompare(right.id));
  const tasks: ExtractedTask[] = [];
  let total = 0;
  let open = 0;
  let completed = 0;
  let notesWithTasks = 0;
  for (const note of sortedNotes) {
    const hash = hashes.get(note.id) ?? '';
    const key = `${hash}\0${note.title}\0${note.path}`;
    const reused = previousByNote.get(note.id);
    const canReuse = reused?.key === key && reused.tasks.every((task) =>
      task.dueDateStatus !== undefined && 'scheduledDate' in task && task.scheduledDateStatus !== undefined,
    );
    const extracted = canReuse && reused ? reused.tasks : extractTasksFromBody(note.body, note, hash);
    if (extracted.length === 0) continue;
    notesWithTasks++;
    total += extracted.length;
    for (const task of extracted) task.checked ? completed++ : open++;
    tasks.push(...extracted);
  }
  const truncated = tasks.length > maxTasks;
  return {
    tasks: truncated ? tasks.slice(0, maxTasks) : tasks,
    counts: { total, open, completed, notesWithTasks },
    scannedNotes: notes.length,
    truncated,
  };
}

/** Toggle only the verified checkbox marker; all other Markdown is preserved. */
export function setTaskChecked(body: string, task: Pick<ExtractedTask, 'markerFrom' | 'markerTo' | 'checked'>, checked: boolean): string {
  const marker = body.slice(task.markerFrom, task.markerTo);
  if (marker.length !== 3 || marker[0] !== '[' || marker[2] !== ']' || !/^\[[ xX]\]$/.test(marker)) {
    throw new Error('The task marker no longer matches the source text.');
  }
  if (task.checked === checked) return body;
  const replacement = checked ? 'x' : ' ';
  return `${body.slice(0, task.markerFrom + 1)}${replacement}${body.slice(task.markerFrom + 2)}`;
}

/** Replace or append a task's scheduled token on its own source line only. */
export function setTaskScheduledDate(body: string, task: ExtractedTask, date: string): string {
  if (!isDateOnly(date)) throw new Error('Scheduled date must use YYYY-MM-DD.');
  const current = extractTasksFromBody(body, { id: task.noteId, title: task.noteTitle, path: task.notePath }).find((item) => item.id === task.id);
  if (!current || current.markerFrom !== task.markerFrom || current.checked !== task.checked) throw new Error('The task no longer matches the current Markdown source.');
  if (current.scheduledDateStatus === 'invalid') throw new Error('This task has duplicate or invalid scheduled-date metadata. Repair the Markdown token before scheduling.');
  const lineEnd = body.indexOf('\n', current.markerTo);
  const firstLineEnd = lineEnd < 0 ? body.length : lineEnd;
  const tree = markdownLanguage.parser.parse(body);
  const codeRanges: Array<[number, number]> = [];
  tree.iterate({ enter(node) { if (node.name === 'InlineCode' && node.from < current.to && node.to > current.from) codeRanges.push([node.from, node.to]); } });
  const tokens = [...body.slice(current.from, current.to).matchAll(/\[scheduled:[^\]]*\]/gi)]
    .map((match) => ({ from: current.from + match.index!, to: current.from + match.index! + match[0].length }))
    .filter((token) => !codeRanges.some(([from, to]) => token.from >= from && token.to <= to));
  if (tokens.length > 1 || (current.scheduledDateStatus === 'valid' && tokens.length !== 1)) throw new Error('Scheduled-date metadata is duplicated or malformed.');
  if (tokens.length === 1) return `${body.slice(0, tokens[0]!.from)}[scheduled:${date}]${body.slice(tokens[0]!.to)}`;
  return `${body.slice(0, firstLineEnd)} [scheduled:${date}]${body.slice(firstLineEnd)}`;
}

/** Parse portable trailing task tokens without changing the Markdown source. */
export function parseTaskMetadata(text: string): TaskMetadata {
  let remaining = text;
  const suffixTokens: { token: string; kind: string; value: string }[] = [];
  let dueDate: string | null = null;
  let dueDateStatus: TaskDateStatus = 'missing';
  let scheduledDate: string | null = null;
  let scheduledDateStatus: TaskDateStatus = 'missing';
  let priority: TaskPriority | null = null;

  for (;;) {
    const match = /\s*\[(due|scheduled|priority):([^\]]*)\]\s*$/i.exec(remaining);
    if (!match) break;
    suffixTokens.unshift({ token: match[0].trim(), kind: match[1]!.toLowerCase(), value: match[2]!.trim() });
    remaining = remaining.slice(0, match.index).trimEnd();
  }

  const preserved = new Set<{ token: string; kind: string; value: string }>();
  for (const kind of ['due', 'scheduled', 'priority']) {
    const tokens = suffixTokens.filter((token) => token.kind === kind);
    if (tokens.length === 0) continue;
    if (kind === 'due') {
      if (tokens.length === 1 && isDateOnly(tokens[0]!.value)) { dueDate = tokens[0]!.value; dueDateStatus = 'valid'; }
      else { dueDateStatus = 'invalid'; tokens.forEach((token) => preserved.add(token)); }
    } else if (kind === 'scheduled') {
      if (tokens.length === 1 && isDateOnly(tokens[0]!.value)) { scheduledDate = tokens[0]!.value; scheduledDateStatus = 'valid'; }
      else { scheduledDateStatus = 'invalid'; tokens.forEach((token) => preserved.add(token)); }
    } else if (tokens.every((token) => ['high', 'medium', 'low'].includes(token.value.toLowerCase()))) {
      // Phase 27 consumed duplicate valid priority tokens and the leftmost
      // value won. Keep that legacy resolution while date duplicates are invalid.
      priority = tokens[0]!.value.toLowerCase() as TaskPriority;
    } else {
      tokens.forEach((token) => preserved.add(token));
    }
  }

  return {
    text: [remaining.trim(), ...suffixTokens.filter((token) => preserved.has(token)).map((token) => token.token)].filter(Boolean).join(' '),
    dueDate,
    dueDateStatus,
    scheduledDate,
    scheduledDateStatus,
    priority,
  };
}

function parseMarkdownTaskMetadata(raw: string, rawFrom: number, taskNode: SyntaxNode): TaskMetadata {
  const inlineCode: { from: number; to: number }[] = [];
  taskNode.cursor().iterate((node) => {
    if (node.name === 'InlineCode') inlineCode.push({ from: node.from, to: node.to });
  });
  const ranges = inlineCode.sort((left, right) => left.from - right.from);

  const replacements = new Map<string, string>();
  let masked = '';
  let cursor = rawFrom;
  for (const [index, range] of ranges.entries()) {
    if (range.from < cursor || range.to > rawFrom + raw.length) continue;
    masked += raw.slice(cursor - rawFrom, range.from - rawFrom);
    const placeholder = `\uE000${index}\uE001`;
    masked += placeholder;
    replacements.set(placeholder, raw.slice(range.from - rawFrom, range.to - rawFrom).replace(/\s+/g, ' ').trim());
    cursor = range.to;
  }
  masked += raw.slice(cursor - rawFrom);
  // Continuation paragraphs belong to the task, but metadata belongs to the
  // logical line on which it appears. Parse trailing tokens on each line so
  // a continuation does not hide tokens on the checklist line. Inline code
  // remains opaque through the placeholders above.
  const metadataTokens: string[] = [];
  const contentLines = masked.split(/\r?\n/).map((line) => {
    let content = line;
    const lineTokens: string[] = [];
    for (;;) {
      const match = /\s+\[(due|scheduled|priority):([^\]]*)\]\s*$/i.exec(content);
      if (!match) break;
      lineTokens.unshift(match[0].trim());
      content = content.slice(0, match.index).trimEnd();
    }
    metadataTokens.push(...lineTokens);
    return content;
  });
  const parsed = parseTaskMetadata([...contentLines, ...metadataTokens].join(' ').replace(/\s+/g, ' ').trim());
  let text = parsed.text;
  for (const [placeholder, original] of replacements) text = text.replaceAll(placeholder, original);
  return { ...parsed, text };
}

function directChild(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) if (child.name === name) return child;
  return null;
}

function listDepth(node: SyntaxNode): number {
  let depth = -1;
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) if (ancestor.name === 'ListItem') depth++;
  return Math.max(0, depth);
}

function collectHeadings(root: SyntaxNode, body: string): Heading[] {
  const headings: Heading[] = [];
  root.cursor().iterate((node) => {
    if (!/^(?:ATXHeading|SetextHeading)[1-6]$/.test(node.name)) return;
    const raw = body.slice(node.from, node.to).split('\n', 1)[0] ?? '';
    headings.push({
      from: node.from,
      line: body.slice(0, node.from).split('\n').length,
      text: node.name.startsWith('ATXHeading') ? raw.replace(/^#{1,6}\s*/, '').replace(/\s*#+\s*$/, '').trim() : raw.trim(),
    });
  });
  return headings.sort((left, right) => left.from - right.from);
}

function headingBefore(headings: readonly Heading[], position: number): Heading | undefined {
  let low = 0;
  let high = headings.length - 1;
  let found: Heading | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const heading = headings[middle]!;
    if (heading.from < position) { found = heading; low = middle + 1; }
    else high = middle - 1;
  }
  return found;
}
