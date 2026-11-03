import { describe, expect, it } from 'vitest';
import type { UiTask } from '../src/ui-server/dto.js';
import { filterTasks, folderOf, groupTasks, sortTasks, VAULT_ROOT_FILTER } from '../ui/src/task-view.js';

function task(overrides: Partial<UiTask> & Pick<UiTask, 'id' | 'text' | 'noteId' | 'notePath' | 'line'>): UiTask {
  return {
    noteTitle: 'Notes',
    noteContentHash: 'a'.repeat(64),
    checked: false,
    from: 0,
    to: 0,
    markerFrom: 0,
    markerTo: 3,
    depth: 0,
    parentId: null,
    heading: null,
    headingLine: null,
    dueDate: null,
    priority: null,
    ...overrides,
  };
}

const tasks = [
  task({ id: 'a', text: 'Alpha', noteId: 'note-a', noteTitle: 'Alpha note', notePath: 'work/alpha.md', line: 2 }),
  task({ id: 'b', text: 'Beta', noteId: 'note-b', noteTitle: 'Beta note', notePath: 'home/beta.md', line: 1, checked: true, dueDate: '2026-11-01' }),
  task({ id: 'c', text: 'Gamma', noteId: 'note-a', noteTitle: 'Alpha note', notePath: 'work/alpha.md', line: 5, dueDate: '2026-11-10', priority: 'high' }),
  task({ id: 'd', text: 'Root', noteId: 'note-c', noteTitle: 'Root note', notePath: 'root.md', line: 1 }),
];

describe('task view filtering, sorting, and grouping', () => {
  it('filters by status, search text, note title, heading, and folder', () => {
    expect(filterTasks(tasks, { status: 'open', query: '', folder: '' }).map((item) => item.id)).toEqual(['a', 'c', 'd']);
    expect(filterTasks(tasks, { status: 'completed', query: '', folder: '' }).map((item) => item.id)).toEqual(['b']);
    expect(filterTasks(tasks, { status: 'all', query: 'gamma', folder: '' }).map((item) => item.id)).toEqual(['c']);
    expect(filterTasks(tasks, { status: 'all', query: 'alpha note', folder: 'work' }).map((item) => item.id)).toEqual(['a', 'c']);
    expect(filterTasks(tasks, { status: 'all', query: '', folder: VAULT_ROOT_FILTER }).map((item) => item.id)).toEqual(['d']);
  });

  it('sorts deterministically by document order, note title, status, and due date', () => {
    expect(sortTasks(tasks, 'document').map((item) => item.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortTasks(tasks, 'note').map((item) => item.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(sortTasks(tasks, 'status').map((item) => item.id)).toEqual(['d', 'a', 'c', 'b']);
    expect(sortTasks(tasks, 'due').map((item) => item.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('groups by note, folder, status, and due bucket without duplicating tasks', () => {
    expect(groupTasks(tasks, 'note').map((group) => [group.label, group.tasks.map((item) => item.id)])).toEqual([
      ['Alpha note', ['a', 'c']],
      ['Beta note', ['b']],
      ['Root note', ['d']],
    ]);
    expect(groupTasks(tasks, 'folder').map((group) => group.label)).toEqual(['work', 'home', 'Vault root']);
    expect(groupTasks(tasks, 'status').map((group) => [group.key, group.tasks.map((item) => item.id)])).toEqual([
      ['open', ['a', 'c', 'd']],
      ['completed', ['b']],
    ]);
    expect(groupTasks(tasks, 'due', '2026-11-03').map((group) => [group.key, group.tasks.map((item) => item.id)])).toEqual([
      ['overdue', ['b']],
      ['upcoming', ['c']],
      ['none', ['a', 'd']],
    ]);
    expect(groupTasks(tasks, 'none')[0]!.tasks).toHaveLength(tasks.length);
  });

  it('derives folders without treating a root note as a folder', () => {
    expect(folderOf('work/alpha.md')).toBe('work');
    expect(folderOf('root.md')).toBe('');
  });
});
