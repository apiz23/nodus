import { createHash } from 'node:crypto';
import { GFM, parser } from '@lezer/markdown';
import type { Note } from '../domain/note.js';

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskCounts = { total: number; open: number; completed: number; notesWithTasks: number };

export interface ExtractedTask {
  /** Derived, projection-local identity. It is not persisted. */
  id: string;
  noteId: string;
  noteTitle: string;
  notePath: string;
  noteContentHash: string;
  /** Human-readable task text with recognized trailing metadata removed. */
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

type SyntaxNode = ReturnType<typeof parser.parse>['topNode'];
type Heading = { from: number; line: number; text: string; level: number };
type MutableTask = Omit<ExtractedTask, 'parentId'> & { node: SyntaxNode };

const taskParser = parser.configure(GFM);
const DEFAULT_MAX_TASKS = 50_000;

/**
 * Extract GFM task-list items from a Markdown body. The parser is the same
 * Lezer grammar used by the editor, so fenced code, inline code, and ordinary
 * bracketed text are not mistaken for tasks.
 */
export function extractTasksFromBody(
  body: string,
  note: Pick<Note, 'id' | 'title' | 'path'>,
  noteContentHash = '',
): ExtractedTask[] {
  const tree = taskParser.parse(body);
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
      const raw = body.slice(marker.to, node.to).replace(/\s+/g, ' ').trim();
      const metadata = parseTaskMetadata(raw);
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
        priority: metadata.priority,
        node: node.node,
      };
      byFrom.set(task.markerFrom, task);
    },
  });

  const tasks: ExtractedTask[] = [];
  for (const task of [...byFrom.values()].sort((left, right) => left.from - right.from)) {
    let parentId: string | null = null;
    for (let ancestor = task.node.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.name !== 'ListItem') continue;
      const direct = directChild(ancestor, 'Task');
      if (direct === null || direct.from === task.from) continue;
      parentId = byFrom.get(direct.from)?.id ?? null;
      if (parentId !== null) break;
    }
    const { node: _node, ...rest } = task;
    tasks.push({ ...rest, parentId });
  }
  return tasks;
}

/** Extract tasks for one note using a caller-supplied raw-content hash. */
export function extractTasksFromNote(note: Note, noteContentHash: string): ExtractedTask[] {
  return extractTasksFromBody(note.body, note, noteContentHash);
}

/**
 * Rebuild the vault-level projection from parsed Markdown. Task objects are
 * never persisted; callers replace the projection after a snapshot refresh.
 */
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
    const extracted = reused?.key === key ? reused.tasks : extractTasksFromBody(note.body, note, hash);
    if (extracted.length === 0) continue;
    notesWithTasks++;
    total += extracted.length;
    for (const task of extracted) {
      if (task.checked) completed++;
      else open++;
    }
    tasks.push(...extracted);
  }
  const limited = tasks.length > maxTasks;
  return {
    tasks: limited ? tasks.slice(0, maxTasks) : tasks,
    counts: { total, open, completed, notesWithTasks },
    scannedNotes: notes.length,
    truncated: limited,
  };
}

/** Toggle only the verified task marker; all other Markdown is preserved. */
export function setTaskChecked(body: string, task: Pick<ExtractedTask, 'markerFrom' | 'markerTo' | 'checked'>, checked: boolean): string {
  const marker = body.slice(task.markerFrom, task.markerTo);
  if (marker.length !== 3 || marker[0] !== '[' || marker[2] !== ']' || !/^\[[ xX]\]$/.test(marker)) {
    throw new Error('The task marker no longer matches the source text.');
  }
  if (task.checked === checked) return body;
  const replacement = checked ? 'x' : ' ';
  return `${body.slice(0, task.markerFrom + 1)}${replacement}${body.slice(task.markerFrom + 2)}`;
}

function directChild(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child;
  }
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
    const match = /^(?:ATXHeading|SetextHeading)([1-6])$/.exec(node.name);
    if (!match) return;
    const line = body.slice(0, node.from).split('\n').length;
    const raw = body.slice(node.from, node.to);
    const firstLine = raw.split('\n', 1)[0] ?? '';
    const text = node.name.startsWith('ATXHeading')
      ? firstLine.replace(/^#{1,6}\s*/, '').replace(/\s*#+\s*$/, '').trim()
      : firstLine.trim();
    headings.push({ from: node.from, line, text, level: Number(match[1]) });
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
    if (heading.from < position) {
      found = heading;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * Recognized trailing metadata: `[due:YYYY-MM-DD]` and
 * `[priority:high|medium|low]`. Tokens remain ordinary visible Markdown.
 */
export function parseTaskMetadata(text: string): { text: string; dueDate: string | null; priority: TaskPriority | null } {
  let remaining = text;
  let dueDate: string | null = null;
  let priority: TaskPriority | null = null;
  for (let pass = 0; pass < 2; pass++) {
    const due = /\s*\[due:(\d{4}-\d{2}-\d{2})\]\s*$/i.exec(remaining);
    if (due && validDate(due[1]!)) {
      dueDate = due[1]!;
      remaining = remaining.slice(0, due.index).trim();
      continue;
    }
    const priorityMatch = /\s*\[priority:(high|medium|low)\]\s*$/i.exec(remaining);
    if (priorityMatch) {
      priority = priorityMatch[1]!.toLowerCase() as TaskPriority;
      remaining = remaining.slice(0, priorityMatch.index).trim();
      continue;
    }
    break;
  }
  return { text: remaining, dueDate, priority };
}

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
