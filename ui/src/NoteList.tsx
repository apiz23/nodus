import { AlertCircle, FileText, Plus, Search } from 'lucide-react';
import type { UiNoteSummary, UiSearchResult } from '../../src/ui-server/dto';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDate } from './format';

type NoteListItem = UiNoteSummary | UiSearchResult;

interface NoteListProps {
  items: NoteListItem[];
  query: string;
  selectedId: string | null;
  loading: boolean;
  searching: boolean;
  error: string | null;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onClearSearch: () => void;
  onRetry: () => void;
}

function hasSnippet(item: NoteListItem): item is UiSearchResult {
  return 'snippet' in item;
}

export function NoteList({
  items,
  query,
  selectedId,
  loading,
  searching,
  error,
  onCreate,
  onOpen,
  onClearSearch,
  onRetry,
}: NoteListProps) {
  const isSearching = query.trim() !== '';

  return (
    <section
      className="flex max-h-[38vh] min-h-0 flex-col border-b bg-muted/30 lg:max-h-none lg:border-r lg:border-b-0"
      aria-label={isSearching ? 'Search results' : 'Notes'}
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-semibold tracking-tight">
              {isSearching ? 'Search' : 'All notes'}
            </h1>
            {!isSearching && items.length > 0 ? (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {items.length}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
            {searching
              ? 'Searching titles and Markdown…'
              : isSearching
                ? `${items.length} ${items.length === 1 ? 'result' : 'results'} for “${query.trim()}”`
                : 'Your local Markdown workspace'}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onCreate}
          aria-label="Create note"
          title="Create note"
        >
          <Plus />
        </Button>
      </header>

      {error === null ? null : (
        <div
          className="mx-3 mb-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto shrink-0 p-0 text-xs text-destructive"
            onClick={onRetry}
          >
            Retry
          </Button>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-3">
          {loading || searching ? (
            <div className="flex gap-2 overflow-hidden px-1 lg:flex-col" aria-label="Loading notes">
              {Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  className="min-w-[190px] space-y-2 rounded-md border border-transparent p-2 lg:min-w-0"
                >
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-2.5 w-4/5" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center px-4 text-center">
              <div className="mb-3 grid size-10 place-items-center rounded-lg border bg-background text-muted-foreground">
                {isSearching ? <Search className="size-4.5" /> : <FileText className="size-4.5" />}
              </div>
              <h2 className="text-sm font-semibold">
                {isSearching ? 'No matches' : 'No notes yet'}
              </h2>
              <p className="mt-1 mb-3 max-w-[36ch] text-xs leading-relaxed text-muted-foreground">
                {isSearching
                  ? 'Try a shorter word, a title, or a phrase from the note body.'
                  : 'Create a Markdown note. It will be written directly to your local vault.'}
              </p>
              {isSearching ? (
                <Button type="button" variant="outline" size="sm" onClick={onClearSearch}>
                  Clear search
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={onCreate}>
                  <Plus data-icon="inline-start" />
                  Create first note
                </Button>
              )}
            </div>
          ) : (
            <ul className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
              {items.map((item) => (
                <li key={item.id} className="min-w-[190px] max-w-[230px] lg:min-w-0 lg:max-w-none">
                  <button
                    type="button"
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors',
                      'hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      item.id === selectedId && 'border-border bg-background shadow-xs',
                    )}
                    aria-current={item.id === selectedId ? 'true' : undefined}
                    onClick={() => onOpen(item.id)}
                  >
                    <span className="truncate text-[12.5px] font-medium tracking-tight">
                      {item.title}
                    </span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {item.path}
                    </span>
                    {hasSnippet(item) ? (
                      <span className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">
                        {item.snippet}
                      </span>
                    ) : null}
                    <span className="mt-0.5 text-[10px] text-muted-foreground/70">
                      {formatDate(item.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
