import { RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { UiRelatedNote } from '../../src/ui-server/dto';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from './api';

interface Props {
  noteId: string;
  revision: number;
  onOpenNote: (id: string) => void;
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; related: UiRelatedNote[]; issue?: string };

export function RelatedNotesPanel({ noteId, revision, onOpenNote }: Props) {
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<State>({ phase: 'loading' });
  const lastRefresh = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const forceRefresh = refresh !== lastRefresh.current;
    lastRefresh.current = refresh;
    setState({ phase: 'loading' });
    api.relatedNotes(noteId, 6, forceRefresh, controller.signal)
      .then((result) => { if (!cancelled) setState({ phase: 'ready', related: result.related, ...(result.retrievalIssue ? { issue: result.retrievalIssue } : {}) }); })
      .catch((error: unknown) => {
        if (!cancelled) setState({ phase: 'error', message: error instanceof Error ? error.message : 'Could not load related notes.' });
      });
    return () => { cancelled = true; controller.abort(); };
  }, [noteId, revision, refresh]);

  return (
    <section className="mt-10 min-w-0 max-w-full border-t pt-5" aria-label="Related notes">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Sparkles className="size-3.5 text-success" aria-hidden="true" />
          Related notes
          {state.phase === 'ready' && state.related.length > 0 ? <Badge variant="secondary" className="font-normal">{state.related.length}</Badge> : null}
        </h2>
        <Button variant="ghost" size="xs" className="shrink-0" onClick={() => setRefresh((value) => value + 1)} aria-label="Refresh related notes">
          <RefreshCw />Refresh
        </Button>
      </div>

      {state.phase === 'ready' && state.issue ? <p className="mt-2 text-xs text-muted-foreground" role="status">{state.issue}</p> : null}

      {state.phase === 'loading' ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      ) : state.phase === 'error' ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1" role="alert">{state.message}</span>
          <Button variant="ghost" size="xs" onClick={() => setRefresh((value) => value + 1)}><RefreshCw />Retry</Button>
        </div>
      ) : state.related.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No strong text, tag, or link connections found yet. Recommendations use saved notes and refresh after saving.
        </p>
      ) : (
        <ul className="mt-3 min-w-0 space-y-1.5">
          {state.related.map((item) => (
            <li key={item.note.id} className="min-w-0">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenNote(item.note.id)}
                className="flex h-auto w-full min-w-0 max-w-full flex-col items-start justify-start gap-0 overflow-hidden whitespace-normal rounded-md px-2.5 py-2 text-left font-normal hover:bg-muted/60"
                aria-label={`Open related note ${item.note.title}. ${reasonText(item)}`}
              >
                <span className="w-full min-w-0 truncate text-[13px] font-medium">{item.note.title}</span>
                <span className="mt-0.5 w-full min-w-0 break-all text-xs text-muted-foreground">{item.note.path}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {item.reasons.map((reason) => (
                    <Badge key={reason.code} variant="outline" className="font-normal text-[10px] text-muted-foreground">
                      {reasonLabel(reason.code, reason.count, reason.terms)}
                    </Badge>
                  ))}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function reasonText(item: UiRelatedNote): string {
  return item.reasons.map((reason) => reasonLabel(reason.code, reason.count, reason.terms)).join(', ');
}

function reasonLabel(code: UiRelatedNote['reasons'][number]['code'], count: number, terms?: string[]): string {
  switch (code) {
    case 'shared-outgoing': return `${count} shared outgoing ${count === 1 ? 'link' : 'links'}`;
    case 'shared-incoming': return `${count} shared incoming ${count === 1 ? 'link' : 'links'}`;
    case 'common-neighbours': return `${count} common ${count === 1 ? 'neighbour' : 'neighbours'}`;
    case 'similar-title': return 'similar title';
    case 'similar-alias': return 'similar alias';
    case 'same-folder': return 'same folder';
    case 'similar-content': return `Similar text: ${terms?.join(', ') ?? 'shared terms'}`;
    case 'shared-tags': return `Shared tags: ${terms?.join(', ') ?? count}`;
    case 'related-headings': return `Related headings: ${terms?.join(', ') ?? count}`;
  }
}
