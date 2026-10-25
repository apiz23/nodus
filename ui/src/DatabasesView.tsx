import { AlertCircle, ChevronRight, Database } from 'lucide-react';
import type { UiDatabase } from '../../src/ui-server/dto';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

interface DatabasesViewProps {
  databases: UiDatabase[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

export function DatabasesView({
  databases,
  loading,
  error,
  selectedId,
  onSelect,
  onRetry,
}: DatabasesViewProps) {
  const selected = databases.find((database) => database.id === selectedId) ?? databases[0] ?? null;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Databases">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Databases</h1>
            <Badge variant="outline" className="text-[10px]">
              Read-only
            </Badge>
          </div>
          <p className="mt-1 max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
            Schema definitions from this vault. Records, views, relations, and query execution are
            not implemented.
          </p>
        </div>
      </header>

      {error === null ? null : (
        <div
          className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive sm:mx-6"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto p-0 text-xs text-destructive"
            onClick={onRetry}
          >
            Retry
          </Button>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-5 sm:px-6">
          {loading ? (
            <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <Skeleton className="h-52 rounded-lg" />
              <Skeleton className="h-80 rounded-lg" />
            </div>
          ) : databases.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
              <div className="mb-4 grid size-10 place-items-center rounded-md bg-muted/60 text-muted-foreground">
                <Database className="size-5" />
              </div>
              <h2 className="text-sm font-semibold">No database definitions</h2>
              <p className="mt-1 max-w-[48ch] text-xs leading-relaxed text-muted-foreground">
                Nodus stores database schemas as JSON files under <code>databases/</code>. This
                vault has none yet.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
              <aside className="overflow-hidden" aria-label="Database definitions">
                <div className="border-b px-2 py-2 text-[11px] font-medium text-muted-foreground">
                  {databases.length} {databases.length === 1 ? 'definition' : 'definitions'}
                </div>
                <div className="flex gap-1 overflow-x-auto py-1 lg:block lg:space-y-0.5 lg:overflow-visible">
                  {databases.map((database) => (
                    <button
                      key={database.id}
                      type="button"
                      className={cn(
                        'flex min-w-[190px] items-center gap-2 rounded-[4px] border border-transparent px-2 py-1.5 text-left transition-colors lg:w-full lg:min-w-0',
                        'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80',
                        database.id === selected?.id && 'bg-muted/70',
                      )}
                      onClick={() => onSelect(database.id)}
                      aria-current={database.id === selected?.id ? 'true' : undefined}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-[4px] bg-muted text-muted-foreground">
                        <Database className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{database.name}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {database.properties.length}{' '}
                          {database.properties.length === 1 ? 'property' : 'properties'}
                        </span>
                      </span>
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </aside>

              {selected === null ? null : (
                <article className="min-w-0 overflow-hidden">
                  <header className="flex items-start justify-between gap-3 border-b px-1 py-4">
                    <div className="min-w-0">
                      <div className="mb-1 truncate font-mono text-[10px] text-muted-foreground">
                        {selected.path}
                      </div>
                      <h2 className="truncate text-lg font-semibold tracking-tight">
                        {selected.name}
                      </h2>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      Schema
                    </Badge>
                  </header>

                  <div className="mx-1 mt-4 flex gap-2.5 rounded-md bg-muted/60 px-3 py-2.5 text-muted-foreground">
                    <Database className="mt-0.5 size-3.5 shrink-0" />
                    <p className="text-[11.5px] leading-relaxed">
                      This is a definition only. Nodus does not have database rows, table views,
                      filters, relations, formulas, or query execution yet.
                    </p>
                  </div>

                  <div className="mx-1 my-4 overflow-hidden rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Property</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Options</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.properties.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                              No properties defined.
                            </TableCell>
                          </TableRow>
                        ) : (
                          selected.properties.map((property) => (
                            <TableRow key={property.id}>
                              <TableCell className="font-medium">{property.name}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  {property.type}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {property.options === undefined || property.options.length === 0
                                  ? '—'
                                  : property.options.map((option) => option.name).join(', ')}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </article>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
