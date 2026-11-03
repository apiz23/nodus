import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import {
  buildTaskProjection,
  extractTasksFromBody,
  parseTaskMetadata,
  setTaskChecked,
} from '../src/tasks/extract.js';

const NOW = '2026-11-03T09:00:00Z';
const NOTE = createNote({ id: '11111111-1111-4111-8111-111111111111', title: 'Tasks note', path: 'notes/tasks.md', body: '- [ ] Note task\n', now: NOW });

function extract(body: string) {
  return extractTasksFromBody(body, NOTE, 'a'.repeat(64));
}

describe('Markdown task extraction', () => {
  it('extracts incomplete and completed GFM tasks with source positions', () => {
    const body = '- [ ] Open task\n- [x] Done task\n- [X] Also done\n';
    const tasks = extract(body);
    expect(tasks.map((task) => [task.text, task.checked, task.line])).toEqual([
      ['Open task', false, 1],
      ['Done task', true, 2],
      ['Also done', true, 3],
    ]);
    expect(tasks[0]).toMatchObject({ from: 2, markerFrom: 2, markerTo: 5, depth: 0, parentId: null });
    expect(body.slice(tasks[1]!.markerFrom, tasks[1]!.markerTo)).toBe('[x]');
  });

  it('preserves nested parent and child relationships across list types', () => {
    const tasks = extract('- [ ] Parent\n  1. [x] Child\n     - [ ] Grandchild\n');
    expect(tasks.map((task) => [task.text, task.depth, task.parentId])).toEqual([
      ['Parent', 0, null],
      ['Child', 1, tasks[0]!.id],
      ['Grandchild', 2, tasks[1]!.id],
    ]);
  });

  it('extracts tasks from blockquotes while ignoring fenced and inline code', () => {
    const body = [
      '> - [ ] Quoted task',
      '',
      '`[ ] inline code`',
      '',
      '```',
      '- [ ] fenced task',
      '```',
      '',
      '- [ ] Real task',
    ].join('\n');
    expect(extract(body).map((task) => task.text)).toEqual(['Quoted task', 'Real task']);
  });

  it('tracks the nearest preceding heading and handles empty labels', () => {
    const body = '# First\n\n- [ ] One\n\n## Second\n\n- [ ] \n- [x] Three\n';
    const tasks = extract(body);
    expect(tasks.map((task) => [task.text, task.heading, task.headingLine])).toEqual([
      ['One', 'First', 1],
      ['', 'Second', 5],
      ['Three', 'Second', 5],
    ]);
  });

  it('parses portable trailing due date and priority metadata', () => {
    expect(parseTaskMetadata('Ship report [due:2026-11-10] [priority:high]')).toEqual({ text: 'Ship report', dueDate: '2026-11-10', priority: 'high' });
    expect(parseTaskMetadata('Review [priority:LOW] [due:2026-11-11]')).toEqual({ text: 'Review', dueDate: '2026-11-11', priority: 'low' });
    expect(parseTaskMetadata('Mention [due:2026-11-10] in prose only')).toEqual({ text: 'Mention [due:2026-11-10] in prose only', dueDate: null, priority: null });
  });

  it('leaves invalid metadata in the task text without breaking extraction', () => {
    const task = extract('- [ ] Broken date [due:2026-02-30] [priority:urgent]\n')[0]!;
    expect(task.text).toBe('Broken date [due:2026-02-30] [priority:urgent]');
    expect(task.dueDate).toBeNull();
    expect(task.priority).toBeNull();
  });

  it('returns deterministic IDs ordered by source position', () => {
    const first = extract('- [ ] Same\n- [ ] Same\n');
    const second = extract('- [ ] Same\n- [ ] Same\n');
    expect(first.map((task) => task.id)).toEqual(second.map((task) => task.id));
    expect(first[0]!.id).not.toBe(first[1]!.id);
    expect(first.map((task) => task.line)).toEqual([1, 2]);
  });

  it('handles malformed Markdown without throwing', () => {
    expect(() => extract('```\n- [ ] unclosed fence\n')).not.toThrow();
    expect(() => extract('- [ ] [] [[unclosed\n')).not.toThrow();
    expect(extract('- [ ] [] [[unclosed\n')[0]!.text).toBe('[] [[unclosed');
  });

  it('changes only the selected marker', () => {
    const body = '# Title\n\n- [ ] First\n- [ ] Second\n';
    const [first] = extract(body);
    const next = setTaskChecked(body, first!, true);
    expect(next).toBe('# Title\n\n- [x] First\n- [ ] Second\n');
    expect(setTaskChecked(next, { ...first!, checked: true }, false)).toBe(body);
  });

  it('builds a bounded, counted projection and reuses unchanged note extractions', () => {
    const other = createNote({ id: '22222222-2222-4222-8222-222222222222', title: 'Other', path: 'notes/other.md', body: '- [x] Other task\n', now: NOW });
    const first = buildTaskProjection([NOTE, other], new Map([[NOTE.id, 'a'.repeat(64)], [other.id, 'b'.repeat(64)]]));
    expect(first.counts).toEqual({ total: 2, open: 1, completed: 1, notesWithTasks: 2 });
    expect(first.tasks.map((task) => task.notePath)).toEqual(['notes/other.md', 'notes/tasks.md']);
    const reused = buildTaskProjection([NOTE, other], new Map([[NOTE.id, 'a'.repeat(64)], [other.id, 'b'.repeat(64)]]), {}, first);
    expect(reused.tasks).toEqual(first.tasks);
    const limited = buildTaskProjection([NOTE, other], new Map(), { maxTasks: 1 });
    expect(limited.truncated).toBe(true);
    expect(limited.tasks).toHaveLength(1);
    expect(limited.counts.total).toBe(2);
  });
});
