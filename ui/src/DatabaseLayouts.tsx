import { hasBlockingRowIssues } from './database-table';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Property } from '../../src/database/schema';
import type { UiDatabaseRow } from '../../src/ui-server/dto';
import { calendarRows, groupDatabaseRows, kanbanColumns, monthDays, shiftMonth, todayDate } from './database-view-layout';

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
  const groups = props.groupProperty ? groupDatabaseRows(props.rows, props.groupProperty) : [{ id: '__all__', name: '', rows: props.rows }];
  return <section aria-label="Database list view" className="my-4 divide-y rounded-md border bg-card">
    {groups.map((group) => <section key={group.id} aria-label={group.name ? `${group.name} group` : undefined}>
      {props.groupProperty ? <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Button type="button" variant="ghost" size="sm" className="h-auto px-1 py-0 font-medium" aria-expanded={!collapsed.has(group.id)} onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}>{group.name}</Button>
        <Badge variant="secondary">{group.rows.length}</Badge>
      </div> : null}
      {!collapsed.has(group.id) ? group.rows.map((row) => <article key={row.noteId} aria-label={row.title} className="flex min-w-0 flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <Button data-note-open={row.noteId} variant="link" size="sm" className="h-auto max-w-full justify-start whitespace-normal break-words p-0 text-left font-medium" title={row.title} onClick={() => props.onOpen(row.noteId)}>{row.title}</Button>
        <div className="truncate text-[10px] text-muted-foreground" title={row.path}>{row.path}</div>
      </div>
      {props.visibleProperties.length ? <dl className="grid min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {props.visibleProperties.map((property) => <div key={property.id} className="flex min-w-0 items-baseline gap-2 text-xs">
          <dt className="shrink-0 text-muted-foreground">{property.name}</dt>
          <dd className="min-w-0 truncate" title={props.formatValue(property, row.values[property.id])}>{props.renderValue ? props.renderValue(row, property) : props.formatValue(property, row.values[property.id])}</dd>
          <Button type="button" size="icon-xs" variant="ghost" className="shrink-0" disabled={props.disabled || hasBlockingRowIssues(row, property)} aria-label={`Edit ${property.name} for ${row.title}`} onClick={() => props.onEdit(row, property)}><Pencil /></Button>
        </div>)}
      </dl> : null}
      {row.issues.length ? <Badge variant="destructive" className="shrink-0">Needs attention</Badge> : null}
      </article>) : null}
    </section>)}
    {props.rows.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">No records match this view.</p> : null}
  </section>;
}

export function CalendarView(props: LayoutProps & { onCreate: (date: string) => void }) {
  const today = todayDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const days = monthDays(month);
  const { dated, undated } = calendarRows(props.rows, props.property.id);
  const monthLabel = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00.000Z`));
  const datedGroups = [...dated.entries()].sort(([left], [right]) => left.localeCompare(right));
  const dateLabel = (date: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00.000Z`));
  return <section aria-label={`Calendar by ${props.property.name}`} className="my-4 flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="outline" aria-label="Previous month" onClick={() => setMonth((value) => shiftMonth(value, -1))}><ChevronLeft /></Button>
        <h3 className="min-w-32 text-center text-sm font-medium" aria-live="polite">{monthLabel}</h3>
        <Button size="icon-sm" variant="outline" aria-label="Next month" onClick={() => setMonth((value) => shiftMonth(value, 1))}><ChevronRight /></Button>
      </div>
      <Button size="sm" variant="ghost" onClick={() => setMonth(today.slice(0, 7))}>Today</Button>
      <label className="flex min-w-0 items-center gap-2 text-xs">Month<Input type="month" className="w-40 max-w-full" value={month} onChange={(event) => { const value = event.currentTarget.value; if (monthDays(value).length) setMonth(value); }} /></label>
    </div>
    <div className="hidden rounded-md border lg:block">
      <Table className="w-full table-fixed text-xs" aria-label={monthLabel}>
        <TableHeader><TableRow>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <TableHead key={day} scope="col" className="p-2 font-medium whitespace-normal text-muted-foreground">{day}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{Array.from({ length: days.length / 7 }, (_, week) => <TableRow key={week}>{days.slice(week * 7, week * 7 + 7).map((date, index) => <TableCell key={date ?? `blank-${index}`} className="border-t border-r p-1 align-top whitespace-normal last:border-r-0">
          {date === null ? <div className="min-h-28" aria-hidden="true" /> : <div className="flex min-h-28 flex-col gap-1">
            <div className="flex items-center justify-between"><time dateTime={date} aria-current={date === today ? 'date' : undefined} className="px-1 font-medium">{Number(date.slice(8))}</time><Button size="icon-xs" variant="ghost" disabled={props.disabled} aria-label={`Create note on ${date}`} onClick={() => props.onCreate(date)}><Plus /></Button></div>
            {(dated.get(date) ?? []).map((row) => <CompactCard key={row.noteId} {...props} row={row} />)}
          </div>}
        </TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </div>
    <div role="region" className="flex flex-col gap-4 lg:hidden" aria-label={`${monthLabel} agenda`}>
      {datedGroups.length === 0 ? <p className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">No dated notes this month.</p> : datedGroups.map(([date, rows]) => <section key={date} className="flex flex-col gap-2" aria-label={dateLabel(date)}>
        <div className="flex items-center justify-between gap-2 border-b pb-1.5">
          <h4 className="text-xs font-medium">{dateLabel(date)}<span className="ml-2 font-normal text-muted-foreground">{rows.length} {rows.length === 1 ? 'note' : 'notes'}</span></h4>
          <Button size="xs" variant="ghost" disabled={props.disabled} aria-label={`Create note on ${date}`} onClick={() => props.onCreate(date)}><Plus data-icon="inline-start" /> Add</Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">{rows.map((row) => <CompactCard key={row.noteId} {...props} row={row} />)}</div>
      </section>)}
    </div>
    <section aria-label="Undated notes" className="flex flex-col gap-2"><h3 className="text-sm font-medium">Undated notes ({undated.length})</h3>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{undated.map((row) => <NoteCard key={row.noteId} {...props} row={row} />)}</div>
      {undated.length === 0 ? <p className="text-xs text-muted-foreground">Every matching note has a date.</p> : null}
    </section>
  </section>;
}
