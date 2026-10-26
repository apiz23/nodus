import { useEffect, useState } from 'react';
import { Link2, RefreshCw } from 'lucide-react';
import type { UiBacklink } from '../../src/ui-server/dto';
import { api, ApiError } from './api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface BacklinksPanelProps {
  /** Stable ID of the note whose backlinks are shown. */
  noteId: string;
  /** Incremented after each save so results refresh post-mutation. */
  revision: number;
  onOpenNote: (id: string) => void;
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; backlinks: UiBacklink[] };

/**
 * Compact linked-mentions section below the editor body. Lists notes that
 * link to the active note via wiki links, using stable IDs from the server.
 * Ambiguous mentions are labeled, never presented as confirmed backlinks.
 */
export function BacklinksPanel({ noteId, revision, onOpenNote }: BacklinksPanelProps) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading' });
    api
      .backlinks(noteId)
      .then((result) => {
        if (!cancelled) setState({ phase: 'ready', backlinks: result.backlinks });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            phase: 'error',
            message:
              error instanceof ApiError
                ? error.message
                : 'Could not load backlinks. The local vault may be unavailable.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, revision]);

  if (state.phase === 'loading') {
    return (
      <section className="mt-10 border-t pt-5" aria-label="Linked mentions" aria-busy="true">
        <BacklinksHeading count={null} />
        <div className="mt-3 space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      </section>
    );
  }

  if (state.phase === 'error') {
    return (
      <section className="mt-10 border-t pt-5" aria-label="Linked mentions">
        <BacklinksHeading count={null} />
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">{state.message}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setState({ phase: 'loading' });
            }}
          >
            <RefreshCw />
            Retry
          </Button>
        </div>
      </section>
    );
  }

  const confirmed = state.backlinks.filter((backlink) => !backlink.ambiguous).length;
  const ambiguous = state.backlinks.length - confirmed;

  return (
    <section className="mt-10 border-t pt-5" aria-label="Linked mentions">
      <BacklinksHeading count={confirmed} ambiguous={ambiguous} />
      {state.backlinks.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No notes link here yet. Add a wiki link like{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
            [[Note title]]
          </code>{' '}
          from another page.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {state.backlinks.map((backlink) => (
            <li key={backlink.sourceId}>
              <button
                type="button"
                onClick={() => onOpenNote(backlink.sourceId)}
                className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Open ${backlink.sourceTitle}${backlink.ambiguous ? ' (ambiguous mention)' : ''}`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-[13px] font-medium">
                    {backlink.sourceTitle}
                  </span>
                  {backlink.count > 1 ? (
                    <Badge variant="secondary" className="font-normal">
                      {backlink.count} links
                    </Badge>
                  ) : null}
                  {backlink.ambiguous ? (
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      ambiguous mention
                    </Badge>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {backlink.snippet}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BacklinksHeading({
  count,
  ambiguous = 0,
}: {
  count: number | null;
  /** Ambiguous mentions are counted separately and never called backlinks. */
  ambiguous?: number;
}) {
  const label =
    count === null
      ? 'Linked mentions'
      : count === 1
        ? '1 backlink'
        : `${count} backlinks`;
  return (
    <h2 className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
      <Link2 className="size-3.5" aria-hidden="true" />
      {label}
      {count !== null && ambiguous > 0 ? (
        <span className="font-normal">
          · {ambiguous} ambiguous {ambiguous === 1 ? 'mention' : 'mentions'}
        </span>
      ) : null}
    </h2>
  );
}
