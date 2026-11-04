import { hasBlockingRowIssues } from './database-table';
import type { ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, Plus } from 'lucide-react';
import { isDerivedProperty } from '../../src/database/schema.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Property } from '../../src/database/schema';
import type { UiDatabaseRow } from '../../src/ui-server/dto';
import { groupDatabaseRows, kanbanColumns, monthDays, shiftMonth, todayDate } from './database-view-layout';
import type { CalendarEvent } from '../../src/calendar/events';
import { projectCalendarEvents } from '../../src/calendar/events';
import { calendarDays, monthGrid, shiftDate, undatedReason, weekDates, type CalendarViewMode } from '../../src/calendar/layout';

interface LayoutProps {
  rows: UiDatabaseRow[];
  renderValue?: (row: UiDatabaseRow, property: Property) => ReactNode;
  property: Property;
  visibleProperties: Property[];
  disabled: boolean;
  onOpen: (id: string) => void;
  onEdit: (row: UiDatabaseRow, property: Property) => void;
  formatValue: (property: Property, value: unknown) => string;
}

function NoteCard({ row, property, visibleProperties, disabled, onOpen, onEdit, formatValue, renderValue }: Omit<LayoutProps, 'rows'> & { row: UiDatabaseRow }) {
  return <article aria-label={row.title} className="min-w-0 rounded-md border bg-card p-3">
    <Button data-note-open={row.noteId} variant="link" size="sm" className="h-auto max-w-full justify-start whitespace-normal p-0 text-left" onClick={() => onOpen(row.noteId)}>{row.title}</Button>
    {visibleProperties.length ? <dl className="my-2 flex flex-col gap-1 text-xs">{visibleProperties.map((item) => <div key={item.id} className="min-w-0"><dt className="text-muted-foreground">{item.name}</dt><dd className="break-words">{renderValue ? renderValue(row, item) : formatValue(item, row.values[item.id])}</dd></div>)}</dl> : null}
    {row.issues.length ? <Badge variant="destructive">Needs attention</Badge> : null}
    <Button size="xs" variant="outline" className="mt-2" disabled={disabled || hasBlockingRowIssues(row)} aria-label={`${property.type === 'select' ? 'Move' : 'Change date for'} ${row.title}`} onClick={() => onEdit(row, property)}>{property.type === 'select' ? 'Move card' : 'Change date'}</Button>
  </article>;
}

function CompactCard({ row, property, visibleProperties, disabled, onOpen, onEdit, formatValue, renderValue }: Omit<LayoutProps, 'rows'> & { row: UiDatabaseRow }) {
  const summaryProperties = visibleProperties.filter((item) => item.id !== property.id);
  return <article aria-label={row.title} className="min-w-0 rounded-sm border bg-card px-1.5 py-1">
    <div className="flex items-start gap-1">
      <Button data-note-open={row.noteId} variant="link" size="xs" className="h-auto min-w-0 flex-1 justify-start whitespace-normal break-words p-0 text-left text-[11px] leading-snug" title={row.title} onClick={() => onOpen(row.noteId)}><span className="line-clamp-2">{row.title}</span></Button>
      <Button size="icon-xs" variant="ghost" className="size-5 shrink-0" disabled={disabled || hasBlockingRowIssues(row)} aria-label={`Change date for ${row.title}`} title="Change date" onClick={() => onEdit(row, property)}><CalendarClock className="size-3" /></Button>
    </div>
    {summaryProperties.length ? <dl className="mt-1 flex min-w-0 flex-col gap-0.5 px-0.5 text-[10px]">
      {summaryProperties.map((item) => <div key={item.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-1">
        <dt className="text-muted-foreground">{item.name}</dt>
        <dd className="min-w-0 break-words">{renderValue ? renderValue(row, item) : formatValue(item, row.values[item.id])}</dd>
      </div>)}
    </dl> : null}
  </article>;
}

export function KanbanView(props: LayoutProps) {
  const columns = kanbanColumns(props.rows, props.property);
  return <section aria-label={`Kanban grouped by ${props.property.name}`} className="my-4 flex gap-3 overflow-x-auto pb-3">
    {columns.map((column) => <section key={column.id} aria-label={`${column.name} column`} className="flex w-64 shrink-0 flex-col gap-2 rounded-md bg-muted/40 p-2">
      <h3 className="flex min-w-0 items-center justify-between gap-2 px-1 py-2 text-sm font-medium"><span className="min-w-0 truncate" title={column.name}>{column.name}</span><Badge variant="secondary" className="shrink-0">{column.rows.length}</Badge></h3>
      {column.rows.map((row) => <NoteCard key={row.noteId} {...props} row={row} />)}
      {column.rows.length === 0 ? <p className="px-1 py-3 text-xs text-muted-foreground">No notes</p> : null}
    </section>)}
  </section>;
}

export function ListView(props: Omit<LayoutProps, 'property'> & { groupProperty?: Property }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => props.groupProperty ? groupDatabaseRows(props.rows, props.groupProperty) : [{ id: '__all__', name: '', rows: props.rows }], [props.groupProperty, props.rows]);
  const items = useMemo(() => {
    const result: Array<{ key: string; kind: 'group'; group: (typeof groups)[number] } | { key: string; kind: 'row'; row: UiDatabaseRow; rowIndex: number }> = [];
    let position = 0;
    for (const group of groups) {
      if (props.groupProperty) result.push({ key: `group:${group.id}`, kind: 'group', group });
      if (collapsed.has(group.id)) { position += group.rows.length; continue; }
      for (const row of group.rows) result.push({ key: `row:${row.noteId}`, kind: 'row', row, rowIndex: position++ });
    }
    return result;
  }, [collapsed, groups, props.groupProperty]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) => items[index]?.kind === 'group' ? 40 : Math.min(240, 72 + Math.ceil(props.visibleProperties.length / 3) * 32),
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: 6,
    initialRect: { width: 1024, height: 640 },
  });
  const virtualItems = virtualizer.getVirtualItems();
  return <section aria-label="Database list view" className="my-4">
    <div ref={viewportRef} role="region" aria-label="Database list records" tabIndex={0} className="max-h-[70vh] overflow-auto rounded-md border bg-card">
      <div role="list" aria-label="Database records" className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index]!;
          return <div key={item.key} role={item.kind === 'row' ? 'listitem' : 'presentation'} aria-posinset={item.kind === 'row' ? item.rowIndex + 1 : undefined} aria-setsize={item.kind === 'row' ? props.rows.length : undefined} data-index={virtualItem.index} ref={virtualizer.measureElement} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${virtualItem.start}px)` }}>
            {item.kind === 'group' ? <div role="heading" aria-level={3} className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
              <Button type="button" variant="ghost" size="sm" className="h-auto px-1 py-0 font-medium" aria-expanded={!collapsed.has(item.group.id)} onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(item.group.id)) next.delete(item.group.id); else next.add(item.group.id); return next; })}>{item.group.name}</Button>
              <Badge variant="secondary">{item.group.rows.length}</Badge>
            </div> : <article aria-label={item.row.title} className="flex min-w-0 flex-col gap-2 border-b px-3 py-3 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0 flex-1">
                <Button data-note-open={item.row.noteId} variant="link" size="sm" className="h-auto max-w-full justify-start whitespace-normal break-words p-0 text-left font-medium" title={item.row.title} onClick={() => props.onOpen(item.row.noteId)}>{item.row.title}</Button>
                <div className="truncate text-[10px] text-muted-foreground" title={item.row.path}>{item.row.path}</div>
              </div>
              {props.visibleProperties.length ? <dl className="grid min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {props.visibleProperties.map((property) => {
                  const value = props.renderValue ? props.renderValue(item.row, property) : props.formatValue(property, item.row.values[property.id]);
                  return <div key={property.id} className="flex min-w-0 items-baseline gap-2 text-xs">
                    <dt className="shrink-0 text-muted-foreground">{property.name}</dt>
                    <dd className="min-w-0 truncate" title={typeof value === 'string' ? value : undefined}>{value}</dd>
                    {!isDerivedProperty(property) ? <Button type="button" size="icon-xs" variant="ghost" className="shrink-0" disabled={props.disabled || hasBlockingRowIssues(item.row, property)} aria-label={`Edit ${property.name} for ${item.row.title}`} onClick={() => props.onEdit(item.row, property)}><Pencil /></Button> : null}
                  </div>;
                })}
              </dl> : null}
              {item.row.issues.length ? <Badge variant="destructive" className="shrink-0">Needs attention</Badge> : null}
            </article>}
          </div>;
        })}
      </div>
      {props.rows.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">No records match this view.</p> : null}
    </div>
  </section>;
}

export function CalendarView(props: LayoutProps & { endProperty?: Property; events?: CalendarEvent[]; eventsLoading?: boolean; eventsError?: string | null; onRetryEvents?: () => void; onOpenEvent?: (event: CalendarEvent) => void; onEditCalendarEvent?: (event: CalendarEvent, start: string, end?: string) => Promise<void>; onScheduleTask?: (event: CalendarEvent, date: string) => Promise<void>; onCreate: (date: string) => void }) {
  const today = todayDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [mode, setMode] = useState<CalendarViewMode | 'timeline'>('month');
  const dateButtons = useRef(new Map<string, HTMLButtonElement>());
  const days = mode === 'month' ? monthGrid(month) : mode === 'week' ? weekDates(selectedDate) : [];
  const visibleDates = days.filter((date): date is string => date !== null);
  const timelineDates = monthGrid(month).filter((date): date is string => date !== null);
  const events = props.events ?? projectCalendarEvents({
    databaseSources: [{ databaseId: props.rows[0]?.databaseId ?? 'calendar-view', startDatePropertyId: props.property.id, ...(props.endProperty ? { endDatePropertyId: props.endProperty.id } : {}) }],
    databaseRows: props.rows.map((row) => ({ databaseId: row.databaseId ?? props.rows[0]?.databaseId ?? 'calendar-view', noteId: row.noteId, title: row.title, path: row.path, values: row.values, issues: row.issues })),
  });
  const projections = calendarDays(events, mode === 'timeline' ? timelineDates : mode === 'day' ? [selectedDate] : visibleDates);
  const byDate = new Map(projections.map((day) => [day.date, day]));
  const undated = events.filter((event) => event.dateState !== 'scheduled');
  const selectedEvents = byDate.get(selectedDate)?.events ?? [];
  const openEvent = (event: CalendarEvent) => props.onOpenEvent?.(event);
  const openEditor = (event: CalendarEvent) => { setEditingEvent(event); setEditStart(event.dateRange?.startDate ?? ''); setEditEnd(event.dateRange?.endDate ?? ''); setEditError(null); };
  const saveEvent = async () => {
    if (!editingEvent) return;
    setEditSaving(true); setEditError(null);
    try {
      if (editingEvent.source.kind === 'markdown-task') {
        if (!props.onScheduleTask) throw new Error('Task scheduling is unavailable.');
        await props.onScheduleTask(editingEvent, editStart);
      } else {
        if (!props.onEditCalendarEvent) throw new Error('Calendar date editing is unavailable.');
        await props.onEditCalendarEvent(editingEvent, editStart, props.endProperty ? editEnd : undefined);
      }
      setEditingEvent(null);
    } catch (error) { setEditError(error instanceof Error ? error.message : 'Could not save the date.'); }
    finally { setEditSaving(false); }
  };
  const renderEvent = (event: CalendarEvent) => event.source.kind === 'database-record' ? <article key={event.id} aria-label={event.title} className="min-w-0 rounded-sm border bg-card px-1.5 py-1">
    <Button data-note-open={event.navigation.noteId} variant="link" size="xs" className="h-auto min-w-0 max-w-full justify-start truncate p-0 text-left text-[11px]" onClick={() => openEvent(event)}>{event.title}</Button>
    <Button size="xs" variant="ghost" className="h-5 px-1 text-[10px]" disabled={props.disabled} onClick={() => openEditor(event)}>Edit date</Button>
    {props.visibleProperties.length ? <dl className="mt-1 flex min-w-0 flex-col gap-0.5 text-[10px]">{props.visibleProperties.map((item) => <div key={item.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-1"><dt className="truncate text-muted-foreground">{item.name}</dt><dd className="min-w-0 truncate">{props.renderValue ? props.renderValue(props.rows.find((row) => row.noteId === event.navigation.noteId)!, item) : props.formatValue(item, props.rows.find((row) => row.noteId === event.navigation.noteId)?.values[item.id])}</dd></div>)}</dl> : null}
  </article> : <span key={event.id} className="flex min-w-0 items-center gap-1"><button type="button" className={`min-w-0 flex-1 truncate rounded px-1 text-left text-[11px] ${event.completed ? 'bg-muted text-muted-foreground line-through' : 'bg-primary/10 text-primary'}`} onClick={() => openEvent(event)} aria-label={`Scheduled task: ${event.title}`}>{event.title}</button><Button size="xs" variant="ghost" className="h-5 px-1 text-[10px]" disabled={props.disabled} onClick={() => openEditor(event)}>Schedule</Button></span>;
  const dateLabel = (date: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00.000Z`));
  const monthLabel = mode === 'day' ? dateLabel(selectedDate) : mode === 'week' ? `${dateLabel(visibleDates[0]!)} – ${dateLabel(visibleDates[6]!)}` : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00.000Z`));
  const navigate = (direction: -1 | 1) => {
    if (mode === 'month' || mode === 'timeline') {
      const next = shiftMonth(month, direction); setMonth(next); setSelectedDate(`${next}-01`);
    } else {
      const next = shiftDate(selectedDate, direction * (mode === 'week' ? 7 : 1)); setSelectedDate(next); setMonth(next.slice(0, 7));
    }
  };
  const moveDateFocus = (date: string, offset: number) => {
    const next = shiftDate(date, offset);
    setSelectedDate(next);
    setMonth(next.slice(0, 7));
    requestAnimationFrame(() => dateButtons.current.get(next)?.focus());
  };
  return <section aria-label={`Calendar by ${props.property.name}${props.endProperty ? ` through ${props.endProperty.name}` : ''}`} className="my-4 flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Calendar view" className="flex gap-1">{(['month', 'week', 'day', 'timeline'] as const).map((view) => <Button key={view} size="sm" variant={mode === view ? 'secondary' : 'outline'} aria-pressed={mode === view} onClick={() => { setMode(view); setMonth(selectedDate.slice(0, 7)); }}>{view[0]!.toUpperCase() + view.slice(1)}</Button>)}</div>
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="outline" aria-label={`Previous ${mode}`} onClick={() => navigate(-1)}><ChevronLeft /></Button>
        <h3 className="min-w-32 text-center text-sm font-medium" aria-live="polite">{monthLabel}</h3>
        <Button size="icon-sm" variant="outline" aria-label={`Next ${mode}`} onClick={() => navigate(1)}><ChevronRight /></Button>
      </div>
      <Button size="sm" variant="ghost" onClick={() => { setMonth(today.slice(0, 7)); setSelectedDate(today); }}>Today</Button>
      {mode === 'month' || mode === 'timeline' ? <label className="flex min-w-0 items-center gap-2 text-xs">Month<Input type="month" className="w-40 max-w-full" value={month} onChange={(event) => { const value = event.currentTarget.value; if (monthDays(value).length) { setMonth(value); setSelectedDate(`${value}-01`); } }} /></label> : null}
    </div>
    {mode === 'month' || mode === 'week' ? <div className="rounded-md border">
      <Table className="w-full table-fixed text-xs" aria-label={monthLabel}>
        <TableHeader><TableRow>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <TableHead key={day} scope="col" className="p-2 font-medium whitespace-normal text-muted-foreground">{day}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{Array.from({ length: days.length / 7 }, (_, week) => <TableRow key={week}>{days.slice(week * 7, week * 7 + 7).map((date, index) => <TableCell key={date ?? `blank-${index}`} className="border-t border-r p-1 align-top whitespace-normal last:border-r-0">
          {date === null ? <div className="min-h-28" aria-hidden="true" /> : <div className="flex min-h-28 flex-col gap-1">
            <div className="flex items-center justify-between"><Button ref={(element) => { if (element) dateButtons.current.set(date, element); else dateButtons.current.delete(date); }} size="icon-xs" variant={date === selectedDate ? 'secondary' : 'ghost'} tabIndex={date === selectedDate ? 0 : -1} aria-pressed={date === selectedDate} aria-label={`Select ${dateLabel(date)}`} onKeyDown={(event) => { const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -7 : event.key === 'ArrowDown' ? 7 : 0; if (offset) { event.preventDefault(); moveDateFocus(date, offset); } }} onClick={() => setSelectedDate(date)}><time dateTime={date} aria-current={date === today ? 'date' : undefined} className="font-medium">{Number(date.slice(8))}</time></Button><Button size="icon-xs" variant="ghost" disabled={props.disabled} aria-label={`Create note on ${date}`} onClick={() => props.onCreate(date)}><Plus /></Button></div>
            {(byDate.get(date)?.preview ?? []).map(renderEvent)}
            {(byDate.get(date)?.overflow ?? 0) > 0 ? <Button size="xs" variant="ghost" className="h-5 justify-start px-1 text-[10px]" aria-expanded={expandedDate === date} onClick={() => setExpandedDate(expandedDate === date ? null : date)}>+{byDate.get(date)?.overflow} more</Button> : null}
            {expandedDate === date ? <div className="max-h-32 overflow-auto rounded border bg-popover p-1">{(byDate.get(date)?.events ?? []).slice(byDate.get(date)?.preview.length ?? 0).map(renderEvent)}</div> : null}
          </div>}
        </TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </div> : mode === 'timeline' ? <div role="list" aria-label={`${month} timeline`} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{timelineDates.map((date) => { const day = byDate.get(date); return <article key={date} role="listitem" aria-label={dateLabel(date)} className="min-w-0 rounded border p-2"><Button variant="link" size="sm" className="p-0" onClick={() => setSelectedDate(date)}>{dateLabel(date)}</Button>{day?.preview.map(renderEvent)}{day?.overflow ? <><Button size="xs" variant="ghost" aria-expanded={expandedDate === date} onClick={() => setExpandedDate(expandedDate === date ? null : date)}>+{day.overflow} more</Button>{expandedDate === date ? <div className="max-h-40 overflow-auto rounded border bg-popover p-1">{day.events.slice(day.preview.length).map(renderEvent)}</div> : null}</> : null}</article>; })}</div> : null}
    {props.eventsLoading ? <p role="status" className="text-sm text-muted-foreground">Loading calendar events…</p> : null}
    {props.eventsError ? <div role="alert" className="flex items-center gap-2 text-sm text-destructive"><p>Calendar events could not be loaded: {props.eventsError}</p><Button size="xs" variant="outline" onClick={props.onRetryEvents}>Retry</Button></div> : null}
    <section aria-label={`Agenda for ${dateLabel(selectedDate)}`} className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between"><h3 className="font-medium">{dateLabel(selectedDate)} <span className="text-xs text-muted-foreground">{selectedEvents.length} events</span></h3><Button size="xs" variant="outline" disabled={props.disabled} onClick={() => props.onCreate(selectedDate)}><Plus data-icon="inline-start" /> Add note</Button></div>
      {selectedEvents.length ? selectedEvents.map((event) => <div key={event.id} className="flex min-w-0 items-start gap-2"><Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start whitespace-normal text-left" onClick={() => openEvent(event)}><span className="mr-2 shrink-0 text-muted-foreground">{event.source.kind === 'markdown-task' ? (event.completed ? 'Completed task' : 'Task') : 'Database'}</span><span className={event.completed ? 'line-through opacity-70' : ''}>{event.title}</span></Button><Button size="xs" variant="outline" disabled={props.disabled} onClick={() => openEditor(event)}>{event.source.kind === 'markdown-task' ? 'Schedule' : 'Edit date'}</Button></div>) : <p className="text-sm text-muted-foreground">No events on this day.</p>}
    </section>
    <section aria-label="Undated calendar events" className="flex flex-col gap-2"><h3 className="text-sm font-medium">Undated ({undated.length})</h3>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{undated.map((event) => <div key={event.id} className="flex min-w-0 items-start gap-2 rounded-md border p-2"><Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start whitespace-normal text-left" onClick={() => openEvent(event)}><span>{event.title} — {undatedReason(event)}</span></Button><Button size="xs" variant="outline" disabled={props.disabled} onClick={() => openEditor(event)}>{event.source.kind === 'markdown-task' ? 'Schedule' : 'Edit date'}</Button></div>)}</div>
      {undated.length === 0 ? <p className="text-xs text-muted-foreground">Every event has a valid scheduled date.</p> : null}
    </section>
    <Dialog open={editingEvent !== null} onOpenChange={(open) => { if (!open && !editSaving) setEditingEvent(null); }}><DialogContent><DialogHeader><DialogTitle>{editingEvent?.source.kind === 'markdown-task' ? 'Schedule task' : 'Edit Calendar dates'}</DialogTitle><DialogDescription>{editingEvent?.title}</DialogDescription></DialogHeader><label className="grid gap-1 text-sm">{editingEvent?.source.kind === 'markdown-task' ? 'Scheduled date' : 'Start date'}<Input type="date" value={editStart} onChange={(event) => setEditStart(event.currentTarget.value)} /></label>{editingEvent?.source.kind === 'database-record' && props.endProperty ? <label className="grid gap-1 text-sm">End date (inclusive)<Input type="date" value={editEnd} onChange={(event) => setEditEnd(event.currentTarget.value)} /></label> : null}{editError ? <p role="alert" className="text-sm text-destructive">{editError}</p> : null}<DialogFooter><Button variant="outline" disabled={editSaving} onClick={() => setEditingEvent(null)}>Cancel</Button><Button disabled={editSaving || !editStart} onClick={() => void saveEvent()}>{editSaving ? 'Saving…' : 'Save dates'}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}

export function GalleryView(props: Omit<LayoutProps, 'property'>) {
  return <section aria-label="Database gallery view" className="my-4 min-w-0">
    {props.rows.length === 0 ? <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No records match this view.</p> :
      <div role="list" aria-label="Database gallery records" className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {props.rows.map((row) => <article key={row.noteId} role="listitem" aria-label={row.title} className="min-w-0 overflow-hidden rounded-md border bg-card">
          <div aria-hidden="true" className="flex h-28 items-center justify-center border-b bg-muted/30 text-xs text-muted-foreground">No preview</div>
          <div className="min-w-0 p-3">
            <Button data-note-open={row.noteId} variant="link" size="sm" className="h-auto max-w-full justify-start whitespace-normal p-0 text-left font-medium" onClick={() => props.onOpen(row.noteId)}>{row.title}</Button>
            {props.visibleProperties.length ? <dl className="mt-2 flex min-w-0 flex-col gap-1 text-xs">{props.visibleProperties.map((property) => {
              const value = props.renderValue ? props.renderValue(row, property) : props.formatValue(property, row.values[property.id]);
              return <div key={property.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2"><dt className="truncate text-muted-foreground">{property.name}</dt><dd className="min-w-0 break-words">{value}</dd></div>;
            })}</dl> : null}
            {row.issues.length ? <Badge variant="destructive" className="mt-2">Needs attention</Badge> : null}
          </div>
        </article>)}
      </div>}
  </section>;
}
