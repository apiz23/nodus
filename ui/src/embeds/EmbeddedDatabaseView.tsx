import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Database, RefreshCw, TriangleAlert } from 'lucide-react';
import type { DatabaseView } from '../../../src/database/database-view';
import type { Property } from '../../../src/database/schema';
import type { UiDatabaseRow } from '../../../src/ui-server/dto';
import { projectCalendarEvents } from '../../../src/calendar/events';
import { selectDatabaseRows } from '@/database-table';
import { formatPropertyValue } from '@/property-value-format';
import { CalendarView, GalleryView, KanbanView, ListView } from '@/DatabaseLayouts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { findEmbeddedView, type NodusViewSpec } from './nodusView';
import { resolveEmbedLayout, type EmbedLayout } from './embedLayout';
import { viewDataService } from './viewDataService';

const VIRTUALIZE_AFTER = 50;
const ROW_HEIGHT = 38;

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; detail: string | null }
  | {
      status: 'ready';
      databaseName: string;
      view: DatabaseView;
      layout: EmbedLayout;
      properties: Property[];
      rows: UiDatabaseRow[];
      total: number;
    };

interface Props {
  spec: NodusViewSpec;
  onOpenNote: (id: string) => void;
  vaultIdentity?: string;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function formatCell(row: UiDatabaseRow, property: Property): string {
  if (property.type === 'relation') {
    const references = row.relations?.[property.id];
    if (references === undefined || references.length === 0) return '—';
    return references.map((reference) => reference.title ?? reference.id).join(', ');
  }
  if (property.type === 'formula' && row.issues.some((issue) => issue.propertyId === property.id && issue.code === 'FORMULA_ERROR')) return 'Formula error';
  return formatPropertyValue(property, row.values[property.id]);
}

/** Read-only table. Small results render whole; large results are virtualised. */
export function EmbeddedViewTable({ properties, rows, height, onOpenNote }: {
  properties: readonly Property[];
  rows: readonly UiDatabaseRow[];
  height: number;
  onOpenNote: (id: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const virtualize = rows.length > VIRTUALIZE_AFTER;
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: rows.length,
    enabled: virtualize,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    initialRect: { width: 1024, height: 320 },
  });
  const virtualItems = virtualize ? virtualizer.getVirtualItems() : [];
  const topPadding = virtualItems[0]?.start ?? 0;
  const bottomPadding = virtualize ? Math.max(0, virtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0)) : 0;
  const visibleRows = virtualize
    ? virtualItems.map((item) => rows[item.index]).filter((row): row is UiDatabaseRow => row !== undefined)
    : rows;
  const columnCount = properties.length + 1;

  return (
    <div ref={viewportRef} className="overflow-auto" style={{ maxHeight: height }} role="region" aria-label="Embedded database rows" tabIndex={0}>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead className="min-w-56">Title</TableHead>
            {properties.map((property) => <TableHead key={property.id} className="min-w-28 whitespace-nowrap">{property.name}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {topPadding > 0 ? <TableRow aria-hidden="true" className="border-0 hover:bg-transparent"><TableCell colSpan={columnCount} className="h-0 border-0 p-0" style={{ height: topPadding }} /></TableRow> : null}
          {visibleRows.map((row) => (
            <TableRow key={row.noteId} className="h-[38px]">
              <TableCell className="max-w-80">
                <Button variant="link" size="xs" className="h-auto max-w-full justify-start p-0 text-left" onClick={() => onOpenNote(row.noteId)}>
                  <span className="truncate">{row.title}</span>
                </Button>
              </TableCell>
              {properties.map((property) => <TableCell key={property.id} className="max-w-56 truncate text-xs">{formatCell(row, property)}</TableCell>)}
            </TableRow>
          ))}
          {bottomPadding > 0 ? <TableRow aria-hidden="true" className="border-0 hover:bg-transparent"><TableCell colSpan={columnCount} className="h-0 border-0 p-0" style={{ height: bottomPadding }} /></TableRow> : null}
        </TableBody>
      </Table>
    </div>
  );
}

export function EmbeddedBody({ layout, rows, properties, height, databaseId, onOpenNote }: {
  layout: EmbedLayout;
  rows: UiDatabaseRow[];
  properties: Property[];
  height: number;
  databaseId: string;
  onOpenNote: (id: string) => void;
}) {
  const common = {
    rows,
    visibleProperties: properties,
    disabled: true,
    onOpen: onOpenNote,
    onEdit: () => undefined,
    formatValue: formatPropertyValue,
    renderValue: (row: UiDatabaseRow, property: Property) => formatCell(row, property),
  };

  switch (layout.kind) {
    case 'table':
      return rows.length === 0
        ? <p className="px-3 py-6 text-sm text-muted-foreground">No rows match this view.</p>
        : <EmbeddedViewTable properties={properties} rows={rows} height={height} onOpenNote={onOpenNote} />;
    case 'gallery':
      return <div className="px-3 pb-3"><GalleryView {...common} /></div>;
    case 'list':
      return <div className="px-3 pb-3"><ListView {...common} groupProperty={layout.groupProperty} /></div>;
    case 'kanban':
      return <div className="px-3 pb-3"><KanbanView {...common} property={layout.groupProperty} /></div>;
    case 'calendar': {
      const events = projectCalendarEvents({
        databaseSources: [{ databaseId, startDatePropertyId: layout.startProperty.id, ...(layout.endProperty === undefined ? {} : { endDatePropertyId: layout.endProperty.id }) }],
        databaseRows: rows.map((row) => ({ databaseId, noteId: row.noteId, title: row.title, path: row.path, values: row.values, issues: row.issues })),
      });
      return (
        <div className="px-3 pb-3">
          <CalendarView
            {...common}
            property={layout.startProperty}
            endProperty={layout.endProperty}
            events={events}
            onOpenEvent={(event) => onOpenNote(event.navigation.noteId)}
            onCreate={() => undefined}
          />
        </div>
      );
    }
    case 'unsupported':
      return (
        <div role="note" data-testid="nodus-view-embed-unsupported" className="mx-3 my-4 rounded-md border border-dashed px-3 py-4 text-sm">
          <p className="font-medium">This saved view cannot be rendered here.</p>
          <p className="mt-1 text-xs text-muted-foreground">{layout.reason}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Requested layout: {layout.requested}. Open the database to use it.</p>
        </div>
      );
    default:
      return null;
  }
}

export function NodusViewEmbed({ spec, onOpenNote, vaultIdentity = '' }: Props) {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => viewDataService.subscribe((databaseId) => {
    if (databaseId === null || databaseId === spec.databaseId) setReload((value) => value + 1);
  }), [spec.databaseId]);

  useEffect(() => {
    let active = true;
    viewDataService.setVaultIdentity(vaultIdentity);
    setState({ status: 'loading' });
    (async () => {
      try {
        const [databases, views, rowData] = await Promise.all([
          viewDataService.databases(),
          viewDataService.views(spec.databaseId),
          viewDataService.rows(spec.databaseId),
        ]);
        if (!active) return;
        const database = databases.find((candidate) => candidate.id === spec.databaseId);
        if (database === undefined) {
          setState({ status: 'error', message: 'Database not found', detail: `No database with id ${spec.databaseId} exists in this vault.` });
          return;
        }
        const saved = findEmbeddedView(views.views, spec.viewId);
        if (saved === null) {
          setState({ status: 'error', message: 'Saved view not found', detail: `Database "${database.name}" has no view with id ${spec.viewId}.` });
          return;
        }
        const sorts = saved.view.sorts !== undefined && saved.view.sorts.length > 0 ? saved.view.sorts : [saved.view.sort];
        const rows = selectDatabaseRows(rowData.rows, database.properties, saved.view.filters, sorts);
        const propertyById = new Map(database.properties.map((property) => [property.id, property]));
        const visible = saved.view.visiblePropertyIds.length > 0
          ? saved.view.visiblePropertyIds.flatMap((id) => propertyById.get(id) ?? [])
          : database.properties;
        setState({
          status: 'ready',
          databaseName: database.name,
          view: saved.view,
          layout: resolveEmbedLayout(saved.view, database.properties),
          properties: visible,
          rows,
          total: rows.length,
        });
      } catch (reason) {
        if (!active) return;
        setState({ status: 'error', message: 'Embedded view failed to load', detail: messageOf(reason) });
      }
    })();
    return () => { active = false; };
  }, [spec.databaseId, spec.viewId, reload, vaultIdentity]);

  const specLabel = useMemo(() => `database ${spec.databaseId.slice(0, 8)}… / view ${spec.viewId.slice(0, 8)}…`, [spec.databaseId, spec.viewId]);

  if (state.status === 'loading') {
    return (
      <div role="status" data-testid="nodus-view-embed-loading" className="my-5 flex items-center gap-2 rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
        <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
        Loading embedded view…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" data-testid="nodus-view-embed-error" className="my-5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-destructive"><TriangleAlert className="size-4" aria-hidden="true" />{state.message}</p>
        {state.detail === null ? null : <p className="mt-1 text-xs text-muted-foreground">{state.detail}</p>}
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">{specLabel}</p>
        <Button variant="outline" size="xs" className="mt-2 gap-1.5" onClick={() => {
          viewDataService.invalidateDatabase(spec.databaseId);
          setReload((value) => value + 1);
        }}>
          <RefreshCw className="size-3" aria-hidden="true" />Retry
        </Button>
      </div>
    );
  }

  return (
    <section aria-label={`Embedded database view: ${state.databaseName} / ${state.view.name}`} data-testid="nodus-view-embed" className="my-5 overflow-hidden rounded-md border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <Database className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium">{state.databaseName}</span>
        <span className="text-xs text-muted-foreground">/ {state.view.name}</span>
        <Badge variant="outline" className="capitalize">{state.layout.kind === 'unsupported' ? state.layout.requested : state.layout.kind}</Badge>
        <Badge variant="secondary" className="ml-auto tabular-nums">{state.total} {state.total === 1 ? 'row' : 'rows'}</Badge>
        <Badge variant="outline">Read-only</Badge>
      </header>
      <EmbeddedBody
        layout={state.layout}
        rows={state.rows}
        properties={state.properties}
        height={spec.height}
        databaseId={spec.databaseId}
        onOpenNote={onOpenNote}
      />
      {state.total > VIRTUALIZE_AFTER && state.layout.kind === 'table' ? (
        <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">Virtualised table: {state.total} rows, rendered on scroll.</p>
      ) : null}
    </section>
  );
}

/** Malformed directive: keep the note readable and show what to fix. */
export function NodusViewEmbedError({ message, source }: { message: string; source: string }) {
  return (
    <div role="alert" data-testid="nodus-view-embed-invalid" className="my-5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-destructive"><TriangleAlert className="size-4" aria-hidden="true" />Invalid nodus-view directive</p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      <pre className="mt-2 overflow-x-auto rounded bg-muted/60 p-2 font-mono text-[11px]">{source.trim() === '' ? '(empty)' : source.trim()}</pre>
      <p className="mt-1 text-[11px] text-muted-foreground">Expected: database: &lt;uuid&gt;, view: &lt;uuid&gt;, optional height: 160–1200.</p>
    </div>
  );
}
