import { describe, expect, it } from 'vitest';
import type { UiDatabaseRow } from '../src/ui-server/dto.js';
import type { ExtractedTask } from '../src/tasks/extract.js';
import { projectCalendarEvents } from '../src/calendar/events.js';

const DB = '22222222-2222-4222-8222-222222222222';
const START = '33333333-3333-4333-8333-333333333333';
const END = '44444444-4444-4444-8444-444444444444';
const NOTE = '11111111-1111-4111-8111-111111111111';

function row(noteId: string, title: string, values: Record<string, unknown>, issues: UiDatabaseRow['issues'] = []): UiDatabaseRow {
  return { noteId, title, path: `${title}.md`, databaseId: DB, values, issues, contentHash: 'a'.repeat(64), updatedAt: '' } as UiDatabaseRow;
}

function task(overrides: Partial<ExtractedTask> = {}): ExtractedTask {
  return {
    id: 'task-a', noteId: NOTE, noteTitle: 'Planning', notePath: 'Planning.md', noteContentHash: 'a'.repeat(64),
    text: 'Write report', checked: false, line: 3, from: 0, to: 20, markerFrom: 2, markerTo: 5,
    depth: 0, parentId: null, heading: null, headingLine: null, dueDate: null, dueDateStatus: 'missing',
    scheduledDate: null, scheduledDateStatus: 'missing', priority: null,
    ...overrides,
  };
}

describe('shared calendar event projection', () => {
  it('projects database rows with an inclusive range and single-day fallback', () => {
    const events = projectCalendarEvents({
      databaseSources: [{ databaseId: DB, startDatePropertyId: START, endDatePropertyId: END }],
      databaseRows: [
        row('record-range', 'Range', { [START]: '2026-11-04', [END]: '2026-11-06' }),
        row('record-single', 'Single', { [START]: '2026-11-07' }),
      ],
    });
    expect(events.map((event) => event.dateRange)).toEqual([
      { startDate: '2026-11-04', endDate: '2026-11-06' },
      { startDate: '2026-11-07', endDate: '2026-11-07' },
    ]);
    expect(events[0]).toMatchObject({
      source: { kind: 'database-record', databaseId: DB, recordId: 'record-range', startDatePropertyId: START, endDatePropertyId: END },
      completed: null, navigation: { noteId: 'record-range' },
    });
  });

  it('distinguishes unscheduled records from invalid dates and invalid ranges', () => {
    const events = projectCalendarEvents({
      databaseSources: [{ databaseId: DB, startDatePropertyId: START, endDatePropertyId: END }],
      databaseRows: [
        row('missing', 'Missing', {}),
        row('bad-start', 'Bad start', { [START]: '2026-02-30' }, [{ noteId: 'bad-start', path: 'Bad start.md', databaseId: DB, propertyId: START, code: 'INVALID_VALUE', message: 'bad date' }]),
        row('bad-end', 'Bad range', { [START]: '2026-11-08', [END]: '2026-11-07' }),
      ],
    });
    expect(events.map((event) => [event.id, event.dateState])).toEqual([
      [`database:${DB}:missing:${START}:+${END}`, 'unscheduled'],
      [`database:${DB}:bad-end:${START}:+${END}`, 'invalid'],
      [`database:${DB}:bad-start:${START}:+${END}`, 'invalid'],
    ]);
    expect(events.every((event) => event.dateRange === undefined)).toBe(true);
  });

  it('projects scheduled and due task dates separately and keeps completed tasks', () => {
    const scheduled = task({ scheduledDate: '2026-11-04', scheduledDateStatus: 'valid', dueDate: '2026-11-06', dueDateStatus: 'valid', checked: true });
    const events = projectCalendarEvents({ tasks: [scheduled] });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: `task:${NOTE}:task-a`, dateState: 'scheduled', dateRange: { startDate: '2026-11-04', endDate: '2026-11-04' },
      scheduledDate: '2026-11-04', dueDate: '2026-11-06', completed: true,
      navigation: { noteId: NOTE, taskId: 'task-a', line: 3 },
    });
  });

  it('keeps due-only tasks unscheduled, reports invalid scheduling, and emits duplicate sources once', () => {
    const dueOnly = task({ dueDate: '2026-11-06', dueDateStatus: 'valid' });
    const invalid = task({ id: 'task-b', scheduledDateStatus: 'invalid' });
    const events = projectCalendarEvents({ tasks: [dueOnly, invalid, dueOnly] });
    expect(events).toHaveLength(2);
    expect(events.find((event) => event.source.kind === 'markdown-task' && event.source.taskId === 'task-a')).toMatchObject({ dateState: 'unscheduled', dueDate: '2026-11-06' });
    expect(events.find((event) => event.source.kind === 'markdown-task' && event.source.taskId === 'task-b')).toMatchObject({ dateState: 'invalid', issue: 'invalid-scheduled-date' });
  });

  it('orders events deterministically regardless of input order', () => {
    const rows = [row('z', 'Zulu', { [START]: '2026-11-04' }), row('a', 'Alpha', { [START]: '2026-11-04' })];
    const config = [{ databaseId: DB, startDatePropertyId: START }];
    const first = projectCalendarEvents({ databaseSources: config, databaseRows: rows }).map((event) => event.id);
    const second = projectCalendarEvents({ databaseSources: config, databaseRows: [...rows].reverse() }).map((event) => event.id);
    expect(first).toEqual([`database:${DB}:a:${START}:-`, `database:${DB}:z:${START}:-`]);
    expect(second).toEqual(first);
  });

  it('keeps separate events for distinct date-property configurations', () => {
    const SECOND_START = '55555555-5555-4555-8555-555555555555';
    const sources = [
      { databaseId: DB, startDatePropertyId: SECOND_START },
      { databaseId: DB, startDatePropertyId: START, endDatePropertyId: END },
    ];
    const rows = [row('record', 'Planning', { [START]: '2026-11-04', [END]: '2026-11-05', [SECOND_START]: '2026-11-08' })];
    const first = projectCalendarEvents({ databaseSources: sources, databaseRows: rows });
    const second = projectCalendarEvents({ databaseSources: [...sources].reverse(), databaseRows: rows });
    expect(first).toHaveLength(2);
    expect(first.map((event) => event.id)).toEqual(second.map((event) => event.id));
    expect(first.map((event) => event.dateRange)).toEqual(second.map((event) => event.dateRange));
    expect(first.map((event) => event.source.kind === 'database-record' && event.source.startDatePropertyId)).toEqual([START, SECOND_START]);
  });

  it('chooses conflicting duplicate task identities deterministically', () => {
    const firstTask = task({ text: 'Alpha', scheduledDate: '2026-11-04', scheduledDateStatus: 'valid' });
    const conflictingTask = task({ text: 'Zulu', scheduledDate: '2026-11-05', scheduledDateStatus: 'valid' });
    const first = projectCalendarEvents({ tasks: [firstTask, conflictingTask] });
    const second = projectCalendarEvents({ tasks: [conflictingTask, firstTask] });
    expect(first).toHaveLength(1);
    expect(first).toEqual(second);
  });

  it('projects frozen source rows and tasks without mutating them', () => {
    const sourceRow = Object.freeze({ ...row('immutable', 'Immutable', { [START]: '2026-11-04' }), values: Object.freeze({ [START]: '2026-11-04' }), issues: Object.freeze([]) });
    const sourceTask = Object.freeze(task({ scheduledDate: '2026-11-05', scheduledDateStatus: 'valid' }));
    const rows = Object.freeze([sourceRow]);
    const tasks = Object.freeze([sourceTask]);
    expect(() => projectCalendarEvents({ databaseSources: [{ databaseId: DB, startDatePropertyId: START }], databaseRows: rows, tasks })).not.toThrow();
    expect(sourceRow.values).toEqual({ [START]: '2026-11-04' });
    expect(sourceTask.scheduledDate).toBe('2026-11-05');
  });
});
