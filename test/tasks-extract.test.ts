import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildTaskProjection, extractTasksFromBody, parseTaskMetadata, setTaskChecked, setTaskScheduledDate, type ExtractedTask } from '../src/tasks/extract.js';

const NOTE = { id: '11111111-1111-4111-8111-111111111111', title: 'Planning', path: 'notes/planning.md' };
const HASH = 'a'.repeat(64);

describe('Markdown task extraction and temporal metadata', () => {
  it('schedules a current task while preserving due date, completion, nesting, and continuation text', () => {
    const body = '- [x] Parent [due:2026-12-20]\n\n  continuation\n  - [ ] child\n';
    const task = extractTasksFromBody(body, NOTE, HASH)[0]!;
    const next = setTaskScheduledDate(body, task, '2026-12-18');
    expect(next).toContain('- [x] Parent [due:2026-12-20] [scheduled:2026-12-18]');
    expect(next).toContain('continuation\n  - [ ] child');
    const updated = extractTasksFromBody(next, NOTE, HASH)[0]!;
    expect(updated.id).toBe(task.id);
    expect(updated.checked).toBe(true);
    expect(updated.dueDate).toBe('2026-12-20');
    expect(updated.scheduledDate).toBe('2026-12-18');
  });

  it('reschedules once and safely rejects duplicated or invalid schedule metadata', () => {
    const body = '- [ ] Task [scheduled:2026-12-01] [due:2026-12-25]';
    const task = extractTasksFromBody(body, NOTE, HASH)[0]!;
    expect(setTaskScheduledDate(body, task, '2026-12-03')).toContain('[scheduled:2026-12-03]');
    const duplicate = '- [ ] Task [scheduled:2026-12-01] [scheduled:2026-12-02]';
    expect(() => setTaskScheduledDate(duplicate, extractTasksFromBody(duplicate, NOTE, HASH)[0]!, '2026-12-04')).toThrow(/duplicate or invalid/);
    expect(() => setTaskScheduledDate(body, task, '2026-02-30')).toThrow(/YYYY-MM-DD/);
  });
  it('reads and reschedules tokens on continuation lines without moving them into parent/child content', () => {
    const body = '- [ ] Parent\n  continuation [due:2026-12-20] [scheduled:2026-12-18]\n  - [ ] Child [scheduled:2026-12-19]\n';
    const [parent, child] = extractTasksFromBody(body, NOTE, HASH);
    expect(parent).toMatchObject({ dueDate: '2026-12-20', scheduledDate: '2026-12-18' });
    const next = setTaskScheduledDate(body, parent!, '2026-12-22');
    expect(next).toContain('continuation [due:2026-12-20] [scheduled:2026-12-22]');
    expect(next).toContain('  - [ ] Child [scheduled:2026-12-19]');
    expect(extractTasksFromBody(next, NOTE, HASH)[0]?.id).toBe(parent?.id);
    expect(child?.parentId).toBe(parent?.id);
  });
  it('retains the existing due token semantics and parses scheduled independently', () => {
    expect(parseTaskMetadata('Ship report [due:2026-11-10] [priority:high]')).toMatchObject({
      text: 'Ship report', dueDate: '2026-11-10', dueDateStatus: 'valid', priority: 'high',
    });
    expect(parseTaskMetadata('Review [priority:LOW] [due:2026-11-11] [scheduled:2026-11-09]')).toMatchObject({
      text: 'Review', dueDate: '2026-11-11', dueDateStatus: 'valid', scheduledDate: '2026-11-09', scheduledDateStatus: 'valid', priority: 'low',
    });
    expect(parseTaskMetadata('Priority [priority:high] [priority:low]')).toMatchObject({ text: 'Priority', priority: 'high' });
  });

  it('leaves invalid date metadata visible and marks it invalid', () => {
    expect(parseTaskMetadata('Task [due:2026-02-30] [scheduled:tomorrow]')).toEqual({
      text: 'Task [due:2026-02-30] [scheduled:tomorrow]',
      dueDate: null,
      dueDateStatus: 'invalid',
      scheduledDate: null,
      scheduledDateStatus: 'invalid',
      priority: null,
    });
  });

  it('keeps all duplicate scheduled and due tokens visible and marks each date kind invalid', () => {
    expect(parseTaskMetadata('Task [scheduled:2026-11-04] [scheduled:2026-11-05]')).toMatchObject({
      text: 'Task [scheduled:2026-11-04] [scheduled:2026-11-05]',
      scheduledDate: null,
      scheduledDateStatus: 'invalid',
    });
    expect(parseTaskMetadata('Task [due:2026-11-04] [due:2026-11-05]')).toMatchObject({
      text: 'Task [due:2026-11-04] [due:2026-11-05]', dueDate: null, dueDateStatus: 'invalid',
    });
  });

  it('extracts completed and scheduled tasks while ignoring code examples', () => {
    const body = [
      '# Work',
      '- [ ] Plan [scheduled:2026-11-04] [due:2026-11-06]',
      '  - [X] Completed child [scheduled:2028-02-29]',
      '',
      '`- [ ] inline code task`',
      '```md',
      '- [ ] fenced task [scheduled:2026-11-04]',
      '```',
      '> - [ ] Quoted task [due:2026-11-05]',
    ].join('\n');
    const tasks = extractTasksFromBody(body, NOTE, HASH);
    expect(tasks.map((task) => [task.text, task.checked, task.scheduledDate, task.dueDate])).toEqual([
      ['Plan', false, '2026-11-04', '2026-11-06'],
      ['Completed child', true, '2028-02-29', null],
      ['Quoted task', false, null, '2026-11-05'],
    ]);
    expect(tasks[0]).toMatchObject({ heading: 'Work', depth: 0, parentId: null, noteContentHash: HASH });
    expect(tasks[1]).toMatchObject({ depth: 1, parentId: tasks[0]!.id });
  });

  it('ignores date tokens inside inline and fenced code while preserving task source text', () => {
    const body = [
      '- [ ] Inline `[scheduled:2026-11-04]` and `[due:2026-11-05]`',
      '- [ ] Code then real token `[scheduled:2026-11-04]` [scheduled:2026-11-06]',
      '```md',
      '- [ ] Fenced task [scheduled:2026-11-07]',
      '```',
    ].join('\n');
    const tasks = extractTasksFromBody(body, NOTE, HASH);
    expect(tasks.map((task) => [task.text, task.scheduledDate, task.dueDate])).toEqual([
      ['Inline `[scheduled:2026-11-04]` and `[due:2026-11-05]`', null, null],
      ['Code then real token `[scheduled:2026-11-04]`', '2026-11-06', null],
    ]);
    expect(body).toContain('[scheduled:2026-11-04]` [scheduled:2026-11-06]');
  });

  it('keeps continuation paragraphs on the parent and excludes nested task content', () => {
    const body = [
      '- [ ] Parent first paragraph',
      '  continuation paragraph [due:2026-11-08]',
      '',
      '  - [ ] Child task',
      '    child continuation [scheduled:2026-11-09]',
    ].join('\n');
    const tasks = extractTasksFromBody(body, NOTE, HASH);
    expect(tasks.map((task) => [task.text, task.parentId, task.dueDate, task.scheduledDate])).toEqual([
      ['Parent first paragraph continuation paragraph', null, '2026-11-08', null],
      ['Child task child continuation', tasks[0]!.id, null, '2026-11-09'],
    ]);
  });

  it('preserves nested task ancestry across ordered and unordered list types', () => {
    const tasks = extractTasksFromBody('- [ ] Parent\n  1. [x] Child\n     - [ ] Grandchild\n', NOTE, HASH);
    expect(tasks.map((task) => [task.text, task.depth, task.parentId])).toEqual([
      ['Parent', 0, null],
      ['Child', 1, tasks[0]!.id],
      ['Grandchild', 2, tasks[1]!.id],
    ]);
  });

  it('retains heading context, empty task labels, and tolerant malformed-Markdown extraction', () => {
    expect(extractTasksFromBody('# First\n\n- [ ] One\n\n## Second\n\n- [ ] \n- [x] Three\n', NOTE, HASH).map((task) => [task.text, task.heading, task.headingLine])).toEqual([
      ['One', 'First', 1], ['', 'Second', 5], ['Three', 'Second', 5],
    ]);
    expect(() => extractTasksFromBody('```\n- [ ] unclosed fence\n', NOTE, HASH)).not.toThrow();
    expect(extractTasksFromBody('- [ ] [] [[unclosed\n', NOTE, HASH)[0]?.text).toBe('[] [[unclosed');
  });

  it('keeps duplicate task text distinct and IDs deterministic', () => {
    const body = '- [ ] Same\n- [ ] Same\n';
    const first = extractTasksFromBody(body, NOTE, HASH);
    const second = extractTasksFromBody(body, NOTE, HASH);
    expect(first.map((task) => task.id)).toEqual(second.map((task) => task.id));
    expect(first[0]!.id).not.toBe(first[1]!.id);
  });

  it('retains Phase 27 projection and safe marker-toggle contracts', () => {
    const note = createNote({ id: NOTE.id, title: NOTE.title, path: NOTE.path, body: '- [ ] Task [scheduled:2026-11-04]\n', now: '2026-11-03T09:00:00Z' });
    const hashes = new Map([[note.id, HASH]]);
    const first = buildTaskProjection([note], hashes);
    expect(first).toMatchObject({ counts: { total: 1, open: 1, completed: 0, notesWithTasks: 1 }, scannedNotes: 1, truncated: false });
    expect(first.tasks[0]).toMatchObject({ dueDate: null, scheduledDate: '2026-11-04' });
    expect(buildTaskProjection([note], hashes, {}, first).tasks).toEqual(first.tasks);
    const limited = buildTaskProjection([note], hashes, { maxTasks: 1 }, first);
    expect(limited).toMatchObject({ counts: { total: 1, open: 1 }, scannedNotes: 1, truncated: false });
    const legacyTask: ExtractedTask = { ...first.tasks[0]! };
    delete legacyTask.dueDateStatus;
    delete legacyTask.scheduledDate;
    delete legacyTask.scheduledDateStatus;
    const upgraded = buildTaskProjection([note], hashes, {}, { ...first, tasks: [legacyTask] });
    expect(upgraded.tasks[0]).toMatchObject({ scheduledDate: '2026-11-04', scheduledDateStatus: 'valid', dueDateStatus: 'missing' });
    const task = first.tasks[0]!;
    expect(setTaskChecked(note.body, task, true)).toBe('- [x] Task [scheduled:2026-11-04]\n');
    expect(() => setTaskChecked('changed source', task, true)).toThrow('The task marker no longer matches the source text.');
  });

  it('bounds projected tasks while preserving complete counts', () => {
    const first = createNote({ id: NOTE.id, title: NOTE.title, path: NOTE.path, body: '- [ ] One\n- [x] Two\n', now: '2026-11-03T09:00:00Z' });
    const projection = buildTaskProjection([first], new Map(), { maxTasks: 1 });
    expect(projection).toMatchObject({ tasks: [{ text: 'One' }], counts: { total: 2, open: 1, completed: 1, notesWithTasks: 1 }, scannedNotes: 1, truncated: true });
  });
});
