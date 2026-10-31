import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { RefreshCw } from 'lucide-react';
import type { UiRelationBacklink } from '../../src/ui-server/dto';
import { api, ApiError } from './api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface RelationBacklinksPanelProps {
  noteId: string;
  revision: number;
  onOpenNote: (id: string) => void;
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; backlinks: UiRelationBacklink[] };

/** Incoming links are derived from database relation values and stay separate from wiki mentions. */
export function RelationBacklinksPanel({ noteId, revision, onOpenNote }: RelationBacklinksPanelProps) {
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<PanelState>({ phase: 'loading' });
  const viewportRef = useRef<HTMLDivElement>(null);
  const backlinks = state.phase === 'ready' ? state.backlinks : [];
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: backlinks.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 88,
    getItemKey: (index) => `${backlinks[index]?.sourceId ?? index}:${backlinks[index]?.propertyId ?? ''}`,
    overscan: 5,
    initialRect: { width: 720, height: 288 },
  });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading' });
    api.relationBacklinks(noteId, refresh > 0).then((result) => {
      if (!cancelled) setState({ phase: 'ready', backlinks: result.backlinks });
    }).catch((error: unknown) => {
      if (!cancelled) setState({
        phase: 'error',
        message: error instanceof ApiError ? error.message : 'Could not load incoming database relations.',
      });
    });
    return () => { cancelled = true; };
  }, [noteId, revision, refresh]);

  return (
    <section className="mt-6 min-w-0 max-w-full border-t pt-4" aria-label="Incoming database relations" aria-busy={state.phase === 'loading'}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="text-[12px] font-medium text-muted-foreground">Database relations pointing here</h2>
        <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={() => setRefresh((value) => value + 1)} aria-label="Refresh incoming database relations">
          <RefreshCw />Refresh
        </Button>
      </div>

      {state.phase === 'loading' ? (
        <div className="mt-3 space-y-2" role="status" aria-label="Loading incoming database relations">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      ) : state.phase === 'error' ? (
        <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-muted-foreground" role="alert">
          <span className="min-w-0 flex-1">{state.message}</span>
          <Button type="button" variant="ghost" size="xs" onClick={() => setRefresh((value) => value + 1)}><RefreshCw />Retry</Button>
        </div>
      ) : state.backlinks.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No database records link to this note.</p>
      ) : (
        <div ref={viewportRef} role="region" aria-label="Incoming database relation records" tabIndex={0} className="mt-3 max-h-72 min-w-0 overflow-y-auto">
          <ul role="list" className="relative min-w-0" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const backlink = state.backlinks[item.index]!;
              return <li
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                role="listitem"
                aria-posinset={item.index + 1}
                aria-setsize={state.backlinks.length}
                className="absolute left-0 top-0 w-full pb-1.5"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenNote(backlink.sourceId)}
                className="flex h-auto w-full min-w-0 max-w-full flex-col items-start justify-start gap-1 overflow-hidden whitespace-normal rounded-md px-2.5 py-2 text-left font-normal hover:bg-muted/60"
                aria-label={`Open ${backlink.sourceTitle} in ${backlink.sourceDatabaseName}, linked through ${backlink.propertyName}${backlink.status === 'incompatible' ? ', target is incompatible' : ''}`}
              >
                <span className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{backlink.sourceTitle}</span>
                  <Badge variant="secondary" className="shrink-0 font-normal">{backlink.sourceDatabaseName}</Badge>
                  {backlink.status === 'incompatible' ? <Badge variant="outline" className="shrink-0 text-destructive">Incompatible target</Badge> : null}
                </span>
                <span className="block w-full truncate text-xs text-muted-foreground" title={backlink.sourcePath}>{backlink.sourcePath}</span>
                <span className="flex w-full min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  <span className="truncate">{backlink.propertyName}</span>
                  {backlink.reciprocalPropertyName ? <span className="truncate">· reciprocal: {backlink.reciprocalPropertyName}</span> : <span>· incoming relation</span>}
                </span>
                </Button>
              </li>;
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
