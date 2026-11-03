import type { UiTask } from '../../src/ui-server/dto.js';

export type TaskStatusFilter = 'all' | 'open' | 'completed';
export type TaskSort = 'document' | 'note' | 'status' | 'due';
export type TaskGroupBy = 'none' | 'note' | 'folder' | 'status' | 'due';
export type TaskDueBucket = 'overdue' | 'today' | 'upcoming' | 'none';
export const VAULT_ROOT_FILTER = '__vault_root__';

export interface TaskViewOptions {
  status: TaskStatusFilter;
  query: string;
  folder: string;
  sort: TaskSort;
  group: TaskGroupBy;
  today?: string;
}

export interface TaskGroup {
  key: string;
  label: string;
  tasks: UiTask[];
}

export function filterTasks(tasks: readonly UiTask[], options: Pick<TaskViewOptions, 'status' | 'query' | 'folder'>): UiTask[] {
  const query = options.query.normalize('NFC').trim().toLowerCase();
  return tasks.filter((task) => {
    if (options.status === 'open' && task.checked) return false;
    if (options.status === 'completed' && !task.checked) return false;
    if (options.folder !== '' && folderOf(task.notePath) !== (options.folder === VAULT_ROOT_FILTER ? '' : options.folder)) return false;
    if (query === '') return true;
    return [task.text, task.noteTitle, task.heading ?? '', task.dueDate ?? '', task.priority ?? '']
      .some((value) => value.normalize('NFC').toLowerCase().includes(query));
  });
}

export function sortTasks(tasks: readonly UiTask[], sort: TaskSort): UiTask[] {
  const result = [...tasks];
  result.sort((left, right) => {
    if (sort === 'document') return compareDocument(left, right);
    if (sort === 'note') return left.noteTitle.localeCompare(right.noteTitle) || compareDocument(left, right);
    if (sort === 'status') return Number(left.checked) - Number(right.checked) || compareDocument(left, right);
    return compareDue(left, right) || Number(left.checked) - Number(right.checked) || compareDocument(left, right);
  });
  return result;
}

export function groupTasks(tasks: readonly UiTask[], group: TaskGroupBy, today = localToday()): TaskGroup[] {
  if (group === 'none') return [{ key: 'all', label: 'All tasks', tasks: [...tasks] }];
  const groups = new Map<string, TaskGroup>();
  const add = (key: string, label: string, task: UiTask) => {
    const existing = groups.get(key) ?? { key, label, tasks: [] };
    existing.tasks.push(task);
    groups.set(key, existing);
  };
  for (const task of tasks) {
    if (group === 'note') add(task.noteId, task.noteTitle, task);
    else if (group === 'folder') add(folderOf(task.notePath) || VAULT_ROOT_FILTER, folderOf(task.notePath) || 'Vault root', task);
    else if (group === 'status') add(task.checked ? 'completed' : 'open', task.checked ? 'Completed' : 'Open', task);
    else {
      const bucket = dueBucket(task, today);
      add(bucket, dueLabel(bucket), task);
    }
  }
  if (group === 'status') return ['open', 'completed'].flatMap((key) => groups.get(key) ? [groups.get(key)!] : []);
  if (group === 'due') return ['overdue', 'today', 'upcoming', 'none'].flatMap((key) => groups.get(key) ? [groups.get(key)!] : []);
  return [...groups.values()];
}

export function folderOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

export function dueBucket(task: Pick<UiTask, 'dueDate'>, today = localToday()): TaskDueBucket {
  if (task.dueDate === null) return 'none';
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  return 'upcoming';
}

export function dueLabel(bucket: TaskDueBucket): string {
  return bucket === 'overdue' ? 'Overdue' : bucket === 'today' ? 'Due today' : bucket === 'upcoming' ? 'Upcoming' : 'No due date';
}

export function localToday(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function compareDocument(left: UiTask, right: UiTask): number {
  return left.notePath.localeCompare(right.notePath) || left.line - right.line || left.id.localeCompare(right.id);
}

function compareDue(left: UiTask, right: UiTask): number {
  if (left.dueDate === null && right.dueDate === null) return 0;
  if (left.dueDate === null) return 1;
  if (right.dueDate === null) return -1;
  return left.dueDate.localeCompare(right.dueDate);
}
