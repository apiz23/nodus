import {
  AlertCircle,
  Check,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import type { UiNote } from '../../src/ui-server/dto';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDateTime, shortHash, wordCount } from './format';
import type { SaveState } from './types';

interface EditorProps {
  note: UiNote | null;
  loading: boolean;
  title: string;
  body: string;
  dirty: boolean;
  saveState: SaveState;
  error: string | null;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSave: () => void;
  onReload: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export function Editor({
  note,
  loading,
  title,
  body,
  dirty,
  saveState,
  error,
  onTitleChange,
  onBodyChange,
  onSave,
  onReload,
  onRename,
  onDelete,
}: EditorProps) {
  if (loading) {
    return (
      <section className="flex min-h-0 flex-1 flex-col bg-background" aria-label="Editor" aria-busy="true">
        <div className="flex h-11 items-center gap-3 border-b px-4">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="ml-auto h-7 w-24" />
        </div>
        <div className="mx-auto w-full max-w-3xl space-y-4 px-8 py-10">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="mt-8 h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </section>
    );
  }

  if (note === null) {
    return (
      <section className="flex min-h-0 flex-1 flex-col bg-background" aria-label="Editor">
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <div className="mb-4 grid size-11 place-items-center rounded-xl border bg-muted/40 text-muted-foreground">
            <FileText className="size-5" />
          </div>
          <h1 className="text-base font-semibold tracking-tight">Open a note to begin</h1>
          <p className="mt-1 max-w-[42ch] text-sm leading-relaxed text-muted-foreground">
            Select a note from the list, or create a new Markdown file in this vault.
          </p>
          {error === null ? null : (
            <div
              className="mt-4 flex max-w-md items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-left text-xs text-destructive"
              role="alert"
            >
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto p-0 text-xs text-destructive"
                onClick={onReload}
              >
                Retry
              </Button>
            </div>
          )}
        </div>
      </section>
    );
  }

  const words = wordCount(body);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background" aria-label="Editor">
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[10.5px] text-muted-foreground" title={note.path}>
            {note.path}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className="inline-flex min-w-20 items-center justify-end gap-1 text-[10.5px] text-muted-foreground"
            aria-live="polite"
          >
            {saveState === 'saving' ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Saving…
              </>
            ) : null}
            {saveState === 'saved' && !dirty ? (
              <>
                <Check className="size-3 text-primary" />
                Saved
              </>
            ) : null}
            {saveState === 'error' ? (
              <>
                <AlertCircle className="size-3 text-destructive" />
                Not saved
              </>
            ) : null}
            {dirty && saveState !== 'saving' && saveState !== 'error' ? 'Unsaved' : null}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Note actions"
                title="Note actions"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={onRename}>
                <Pencil />
                Rename path
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onReload}>
                <RefreshCw />
                Reload from disk
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 />
                Delete note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={onSave}
            disabled={!dirty || saveState === 'saving'}
            title="Save note (Ctrl/Cmd+S)"
          >
            {saveState === 'saving' ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
        </div>
      </header>

      {error === null ? null : (
        <div
          className="mx-3 mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive sm:mx-4"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto p-0 text-xs text-destructive"
            onClick={onReload}
          >
            Reload note
          </Button>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl px-6 py-7 sm:px-10 sm:py-9">
          <label className="sr-only" htmlFor="note-title">
            Note title
          </label>
          <input
            id="note-title"
            className="w-full border-0 bg-transparent p-0 text-2xl font-semibold tracking-[-0.025em] outline-none placeholder:text-muted-foreground/60 focus-visible:ring-0 sm:text-[28px]"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Untitled note"
            spellCheck={false}
          />

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground">
            <span>Updated {formatDateTime(note.updatedAt)}</span>
            <span aria-hidden="true">·</span>
            <span>{words === 1 ? '1 word' : `${words} words`}</span>
            <span aria-hidden="true">·</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help font-mono" title={`SHA-256 ${note.contentHash}`}>
                  hash {shortHash(note.contentHash)}
                </span>
              </TooltipTrigger>
              <TooltipContent>Raw Markdown SHA-256 used for external-edit detection.</TooltipContent>
            </Tooltip>
            {note.metadataKeys.length > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>preserved: {note.metadataKeys.join(', ')}</span>
              </>
            ) : null}
          </div>

          {note.tags.length > 0 || note.aliases.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Note metadata">
              {note.tags.map((tag) => (
                <Badge key={`tag-${tag}`} variant="secondary" className="font-normal">
                  #{tag}
                </Badge>
              ))}
              {note.aliases.map((alias) => (
                <Badge key={`alias-${alias}`} variant="outline" className="font-normal">
                  alias: {alias}
                </Badge>
              ))}
            </div>
          ) : null}

          <label className="sr-only" htmlFor="note-body">
            Markdown body
          </label>
          <Textarea
            id="note-body"
            className="mt-6 min-h-[calc(100dvh-20rem)] resize-none field-sizing-fixed border-0 bg-transparent p-0 font-mono text-[13.5px] leading-[1.75] shadow-none focus-visible:border-0 focus-visible:ring-0"
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            placeholder="Start writing in Markdown…"
            spellCheck={false}
          />
        </div>
      </ScrollArea>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-1.5 text-[10.5px] text-muted-foreground sm:px-4">
        <div className="flex items-center gap-3">
          <span>Markdown body</span>
          <span className="hidden sm:inline">Frontmatter preserved on save</span>
        </div>
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto p-0 text-[10.5px] text-muted-foreground hover:text-foreground"
          onClick={onReload}
        >
          <RefreshCw data-icon="inline-start" />
          Reload from disk
        </Button>
      </footer>
    </section>
  );
}
