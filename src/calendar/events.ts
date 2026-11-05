import type { ExtractedTask, TaskDateStatus } from '../tasks/extract.js';
import { resolveDateRange, type DateOnly, type DateRange } from '../temporal/date.js';

export type CalendarEventTemporalKind = 'all-day';
export type CalendarEventDateState = 'scheduled' | 'unscheduled' | 'invalid';

export interface DatabaseCalendarSource {
  databaseId: string;
  startDatePropertyId: string;
  endDatePropertyId?: string;
}

export interface CalendarDatabaseRow {
  databaseId: string;
  noteId: string;
  title: string;
  path: string;
  values: Readonly<Record<string, unknown>>;
  issues: readonly { propertyId?: string; code: string }[];
}

export type CalendarEventSource =
  | { kind: 'database-record'; databaseId: string; recordId: string; startDatePropertyId: string; endDatePropertyId?: string }
  | { kind: 'markdown-task'; noteId: string; taskId: string };

export interface CalendarEvent {
  /** Stable projection identity, derived from the source identity. */
  id: string;
  source: CalendarEventSource;
  title: string;
  temporalKind: CalendarEventTemporalKind;
  dateState: CalendarEventDateState;
  /** Resolved inclusive dates; absent when the event is unscheduled or invalid. */
  dateRange?: DateRange;
  /** Completion only applies to Markdown tasks; database records use null. */
  completed: boolean | null;
  /** Navigation always opens the owning note, with task location when applicable. */
  navigation: { noteId: string; notePath: string; line?: number; taskId?: string };
  /** Task dates remain separately available; due date never places the event. */
  dueDate?: DateOnly;
  dueDateStatus?: TaskDateStatus;
  scheduledDate?: DateOnly;
  scheduledDateStatus?: TaskDateStatus;
  issue?: string;
}

export interface CalendarEventProjectionInput {
  databaseRows?: readonly CalendarDatabaseRow[];
  databaseSources?: readonly DatabaseCalendarSource[];
  tasks?: readonly ExtractedTask[];
}

/**
 * Pure projection over already-derived database rows and Markdown tasks.
 * It creates no persisted data and emits one event per source identity. A
 * task's scheduled date is its placement; its due date is separate metadata.
 */
export function projectCalendarEvents(input: CalendarEventProjectionInput): CalendarEvent[] {
  const events = new Map<string, CalendarEvent>();
  const sources = [...(input.databaseSources ?? [])].sort((left, right) =>
    compareText(left.databaseId, right.databaseId) ||
    compareText(left.startDatePropertyId, right.startDatePropertyId) ||
    compareText(left.endDatePropertyId ?? '', right.endDatePropertyId ?? ''),
  );
  const rowsByDatabase = new Map<string, CalendarDatabaseRow[]>();
  for (const row of input.databaseRows ?? []) {
    const rows = rowsByDatabase.get(row.databaseId) ?? [];
    rows.push(row);
    rowsByDatabase.set(row.databaseId, rows);
  }
  for (const source of sources) {
    for (const row of rowsByDatabase.get(source.databaseId) ?? []) {
      const id = databaseEventId(source, row.noteId);
      const start = row.values[source.startDatePropertyId];
      const end = source.endDatePropertyId ? row.values[source.endDatePropertyId] : undefined;
      const startIssue = row.issues.some((issue) => issue.propertyId === source.startDatePropertyId && invalidPropertyIssue(issue.code));
      const endIssue = source.endDatePropertyId !== undefined && row.issues.some((issue) => issue.propertyId === source.endDatePropertyId && invalidPropertyIssue(issue.code));
      const result = startIssue
        ? { status: 'invalid' as const, reason: 'invalid-start' as const }
        : endIssue
          ? { status: 'invalid' as const, reason: 'invalid-end' as const }
          : resolveDateRange(start, end);
      addPreferredEvent(events, {
        id,
        source: {
          kind: 'database-record', databaseId: source.databaseId, recordId: row.noteId,
          startDatePropertyId: source.startDatePropertyId,
          ...(source.endDatePropertyId === undefined ? {} : { endDatePropertyId: source.endDatePropertyId }),
        },
        title: row.title,
        temporalKind: 'all-day',
        dateState: result.status === 'valid' ? 'scheduled' : result.status,
        ...(result.status === 'valid' ? { dateRange: result.range } : {}),
        completed: null,
        navigation: { noteId: row.noteId, notePath: row.path },
        ...(result.status === 'invalid' ? { issue: result.reason } : {}),
      });
    }
  }

  for (const task of input.tasks ?? []) {
    const id = `task:${task.noteId}:${task.id}`;
    const scheduledDateStatus = task.scheduledDateStatus ?? (task.scheduledDate ? 'valid' : 'missing');
    const dueDateStatus = task.dueDateStatus ?? (task.dueDate ? 'valid' : 'missing');
    const result = scheduledDateStatus === 'invalid' || (scheduledDateStatus === 'valid' && !task.scheduledDate)
      ? { status: 'invalid' as const, reason: 'invalid-start' as const }
      : scheduledDateStatus === 'valid'
        ? resolveDateRange(task.scheduledDate)
        : { status: 'unscheduled' as const, reason: 'missing-start' as const };
    addPreferredEvent(events, {
      id,
      source: { kind: 'markdown-task', noteId: task.noteId, taskId: task.id },
      title: task.text || 'Untitled task',
      temporalKind: 'all-day',
      dateState: result.status === 'valid' ? 'scheduled' : result.status,
      ...(result.status === 'valid' ? { dateRange: result.range } : {}),
      completed: task.checked,
      navigation: { noteId: task.noteId, notePath: task.notePath, line: task.line, taskId: task.id },
      ...(dueDateStatus === 'valid' && task.dueDate ? { dueDate: task.dueDate } : {}),
      dueDateStatus,
      ...(scheduledDateStatus === 'valid' && task.scheduledDate ? { scheduledDate: task.scheduledDate } : {}),
      scheduledDateStatus,
      ...(result.status === 'invalid' ? { issue: 'invalid-scheduled-date' } : {}),
    });
  }

  return [...events.values()].sort(compareEvents);
}

function databaseEventId(source: DatabaseCalendarSource, recordId: string): string {
  const identity = [source.databaseId, recordId, source.startDatePropertyId].map((part) => encodeURIComponent(part));
  const end = source.endDatePropertyId === undefined ? '-' : `+${encodeURIComponent(source.endDatePropertyId)}`;
  return `database:${[...identity, end].join(':')}`;
}

function addPreferredEvent(events: Map<string, CalendarEvent>, event: CalendarEvent): void {
  const previous = events.get(event.id);
  if (previous === undefined || JSON.stringify(event) < JSON.stringify(previous)) events.set(event.id, event);
}

function invalidPropertyIssue(code: string): boolean {
  return code === 'TYPE_MISMATCH' || code === 'INVALID_VALUE';
}

function compareEvents(left: CalendarEvent, right: CalendarEvent): number {
  const stateOrder: Record<CalendarEventDateState, number> = { scheduled: 0, unscheduled: 1, invalid: 2 };
  const state = stateOrder[left.dateState] - stateOrder[right.dateState];
  if (state !== 0) return state;
  if (left.dateRange && right.dateRange) {
    const start = compareText(left.dateRange.startDate, right.dateRange.startDate);
    if (start !== 0) return start;
    const end = compareText(left.dateRange.endDate, right.dateRange.endDate);
    if (end !== 0) return end;
  }
  const source = compareText(left.source.kind, right.source.kind);
  if (source !== 0) return source;
  const title = compareText(left.title.normalize('NFC').toLowerCase(), right.title.normalize('NFC').toLowerCase());
  if (title !== 0) return title;
  return compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
