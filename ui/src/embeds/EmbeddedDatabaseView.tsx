import { useEffect, useMemo, useState } from 'react';
import { Database, RefreshCw, TriangleAlert } from 'lucide-react';
import type { Property } from '../../../src/database/schema';
import type { UiDatabaseRow } from '../../../src/ui-server/dto';
import { api } from '@/api';
import { selectDatabaseRows } from '@/database-table';
import { formatPropertyValue } from '@/property-value-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { findEmbeddedView, type NodusViewSpec } from './nodusView';

const MAX_RENDERED_ROWS = 100;

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; detail: string | null }
  | { status: 'ready'; databaseName: string; viewName: string; properties: Property[]; rows: UiDatabaseRow[]; total: number };

interface Props {
  spec: NodusViewSpec;
  onOpenNote: (id: string) => void;
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

/** Pure read-only table. Exported so the embed surface can be tested without the API. */
export function EmbeddedViewTable({ databaseName, viewName, properties, rows, height, total, onOpenNote }: {
  databaseName: string;
  viewName: string;
  properties: readonly Property[];
  rows: readonly UiDatabaseRow[];
  height: number;
  total: number;
  onOpenNote: (id: string) => void;
}) {
  const shown = rows.slice(0, MAX_RENDERED_ROWS);
  return (
    <section aria-label={`Embedded database view: ${databaseName} / ${viewName}`} data-testid="nodus-view-embed" className="my-5 overflow-hidden rounded-md border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <Database className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium">{databaseName}</span>
        <span className="text-xs text-muted-foreground">/ {viewName}</span>
        <Badge variant="secondary" className="ml-auto tabular-nums">{total} {total === 1 ? 'row' : 'rows'}</Badge>
        <Badge variant="outline">Read-only</Badge>
      </header>
      {rows.length === 0 ? (
        <p className="px-3 py-6 text-sm text-muted-foreground">No rows match this view.</p>
      ) : (
        <div className="overflow-auto" style={{ maxHeight: height }}>
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="min-w-56">Title</TableHead>
                {properties.map((property) => <TableHead key={property.id} className="min-w-28 whitespace-nowrap">{property.name}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <TableRow key={row.noteId}>
                  <TableCell className="max-w-80">
                    <Button variant="link" size="xs" className="h-auto max-w-full justify-start p-0 text-left" onClick={() => onOpenNote(row.noteId)}>
                      <span className="truncate">{row.title}</span>
                    </Button>
                  </TableCell>
                  {properties.map((property) => <TableCell key={property.id} className="max-w-56 truncate text-xs">{formatCell(row, property)}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {total > shown.length ? (
        <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">Showing the first {shown.length} of {total} rows. Open the database to browse them all.</p>
      ) : null}
    </section>
  );
}

export function NodusViewEmbed({ spec, onOpenNote }: Props) {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading' });
    (async () => {
      try {
        const databases = await api.databases();
        if (!active) return;
        const database = databases.databases.find((candidate) => candidate.id === spec.databaseId);
        if (database === undefined) {
          setState({ status: 'error', message: 'Database not found', detail: `No database with id ${spec.databaseId} exists in this vault.` });
          return;
        }
        const [views, rowData] = await Promise.all([
          api.databaseViews(spec.databaseId, undefined, controller.signal),
          api.databaseRows(spec.databaseId, undefined, undefined, controller.signal),
        ]);
        if (!active) return;
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
        setState({ status: 'ready', databaseName: database.name, viewName: saved.view.name, properties: visible, rows, total: rows.length });
      } catch (reason) {
        if (!active || controller.signal.aborted) return;
        setState({ status: 'error', message: 'Embedded view failed to load', detail: messageOf(reason) });
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [spec.databaseId, spec.viewId, reload]);

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
        <Button variant="outline" size="xs" className="mt-2 gap-1.5" onClick={() => setReload((value) => value + 1)}>
          <RefreshCw className="size-3" aria-hidden="true" />Retry
        </Button>
      </div>
    );
  }

  return <EmbeddedViewTable databaseName={state.databaseName} viewName={state.viewName} properties={state.properties} rows={state.rows} height={spec.height} total={state.total} onOpenNote={onOpenNote} />;
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
