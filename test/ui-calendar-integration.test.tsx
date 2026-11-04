import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { projectCalendarEvents } from '../src/calendar/events.js';
import { extractTasksFromBody } from '../src/tasks/extract.js';
import { CalendarView } from '../ui/src/DatabaseLayouts.js';
import { todayDate } from '../ui/src/database-view-layout.js';

const date = { id: 'date', name: 'Start', type: 'date' as const };
const dateToday = todayDate();

describe('Calendar month integration', () => {
  it('renders database records and scheduled completed tasks together, and keeps due dates separate', () => {
    const task = extractTasksFromBody(`- [x] Release ${`[scheduled:${dateToday}]`} [due:2099-12-31]`, { id: 'note-task', title: 'Tasks', path: 'tasks.md' }, 'hash')[0]!;
    const events = projectCalendarEvents({
      databaseSources: [{ databaseId: 'db', startDatePropertyId: 'start', endDatePropertyId: 'end' }],
      databaseRows: [{ databaseId: 'db', noteId: 'record', title: 'Database milestone', path: 'milestone.md', values: { start: dateToday, end: dateToday }, issues: [] }],
      tasks: [task],
    });
    expect(events).toHaveLength(2);
    expect(events.find((event) => event.source.kind === 'markdown-task')?.dueDate).toBe('2099-12-31');
    const markup = renderToStaticMarkup(createElement(CalendarView, {
      rows: [], property: date, visibleProperties: [], disabled: false, onOpen: () => undefined,
      onEdit: () => undefined, formatValue: () => '', onCreate: () => undefined, events,
      onOpenEvent: (event) => event.navigation.noteId,
    }));
    expect(markup).toContain('Release');
    expect(markup).toContain('Database milestone');
    expect(markup).toContain('Agenda for');
    expect(markup).toContain('line-through');
    expect(markup).toContain('Undated (0)');
    expect(markup).toContain('Edit date');
    expect(markup).toContain('Schedule');
    expect(markup).toContain('Select');
  });

  it('shows missing, invalid and reversed events accessibly and renders loading and error states', () => {
    const events = projectCalendarEvents({
      databaseSources: [{ databaseId: 'db', startDatePropertyId: 'start', endDatePropertyId: 'end' }],
      databaseRows: [
        { databaseId: 'db', noteId: 'missing', title: 'No date', path: 'a.md', values: {}, issues: [] },
        { databaseId: 'db', noteId: 'invalid', title: 'Bad date', path: 'b.md', values: { start: '2026-02-30' }, issues: [] },
        { databaseId: 'db', noteId: 'reversed', title: 'Backwards', path: 'c.md', values: { start: '2026-03-02', end: '2026-03-01' }, issues: [] },
      ],
    });
    const markup = renderToStaticMarkup(createElement(CalendarView, {
      rows: [], property: date, visibleProperties: [], disabled: false, onOpen: () => undefined,
      onEdit: () => undefined, formatValue: () => '', onCreate: () => undefined, events,
      eventsLoading: true, eventsError: 'offline', onOpenEvent: () => undefined,
    }));
    expect(markup).toContain('No date');
    expect(markup).toContain('Missing start date');
    expect(markup).toContain('Invalid start date');
    expect(markup).toContain('End date is before start date');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('No events on this day.');
    expect(markup).toContain('Edit date');
  });
});
