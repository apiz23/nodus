import { useState } from 'react';
import { hasBlockingRowIssues } from './database-table';
import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Property } from '../../src/database/schema';
import type { UiDatabaseRow } from '../../src/ui-server/dto';
import { calendarRows, kanbanColumns, monthDays, shiftMonth, todayDate } from './database-view-layout';

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

export function KanbanView(props: LayoutProps) {
  const columns = kanbanColumns(props.rows, props.property);
  return <section aria-label={`Kanban grouped by ${props.property.name}`} className="my-4 flex gap-3 overflow-x-auto pb-3">
    {columns.map((column) => <section key={column.id} aria-label={`${column.name} column`} className="flex w-64 shrink-0 flex-col gap-2 rounded-md bg-muted/40 p-2">
      <h3 className="flex items-center justify-between px-1 py-2 text-sm font-medium">{column.name}<Badge variant="secondary">{column.rows.length}</Badge></h3>
      {column.rows.map((row) => <NoteCard key={row.noteId} {...props} row={row} />)}
      {column.rows.length === 0 ? <p className="px-1 py-3 text-xs text-muted-foreground">No notes</p> : null}
    </section>)}
  </section>;
}

export function CalendarView(props: LayoutProps & { onCreate: (date: string) => void }) {
  const today = todayDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const days = monthDays(month);
  const { dated, undated } = calendarRows(props.rows, props.property.id);
  const monthLabel = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00.000Z`));
  return <section aria-label={`Calendar by ${props.property.name}`} className="my-4 flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" aria-label="Previous month" onClick={() => setMonth((value) => shiftMonth(value, -1))}>Previous</Button>
      <h3 className="text-sm font-medium" aria-live="polite">{monthLabel}</h3>
      <Button size="sm" variant="outline" aria-label="Next month" onClick={() => setMonth((value) => shiftMonth(value, 1))}>Next</Button>
      <Button size="sm" variant="ghost" onClick={() => setMonth(today.slice(0, 7))}>Today</Button>
      <label className="flex items-center gap-2 text-xs">Month<Input type="month" className="w-40" value={month} onChange={(event) => { const value = event.currentTarget.value; if (monthDays(value).length) setMonth(value); }} /></label>
    </div>
    <div className="rounded-md border">
      <Table className="min-w-[630px] table-fixed text-xs" aria-label={monthLabel}>
        <TableHeader><TableRow>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <TableHead key={day} scope="col" className="p-2 font-medium text-muted-foreground">{day}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{Array.from({ length: days.length / 7 }, (_, week) => <TableRow key={week}>{days.slice(week * 7, week * 7 + 7).map((date, index) => <TableCell key={date ?? `blank-${index}`} className="h-28 border-t border-r p-1 align-top last:border-r-0">
          {date === null ? null : <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between"><time dateTime={date} aria-current={date === today ? 'date' : undefined} className="px-1 font-medium">{Number(date.slice(8))}</time><Button size="icon-xs" variant="ghost" disabled={props.disabled} aria-label={`Create note on ${date}`} onClick={() => props.onCreate(date)}><Plus /></Button></div>
            {(dated.get(date) ?? []).map((row) => <NoteCard key={row.noteId} {...props} row={row} />)}
          </div>}
        </TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </div>
    <section aria-label="Undated notes" className="flex flex-col gap-2"><h3 className="text-sm font-medium">Undated notes ({undated.length})</h3>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{undated.map((row) => <NoteCard key={row.noteId} {...props} row={row} />)}</div>
      {undated.length === 0 ? <p className="text-xs text-muted-foreground">Every matching note has a date.</p> : null}
    </section>
  </section>;
}
