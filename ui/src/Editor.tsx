import {
  AlertCircle,
  Check,
  ChevronRight,
  FileText,
  ImagePlus,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import type { UiNote, UiNoteSummary } from '../../src/ui-server/dto';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDateTime, wordCount } from './format';
import type { SaveState } from './types';
import { CodeMirrorEditor } from './editor/CodeMirrorEditor';
import { PageIconPicker } from './PageIconPicker';

interface EditorProps {
  note: UiNote | null;
  notes: readonly UiNoteSummary[];
  icon: string | null;
  onIconChange: (icon: string | null) => void;
  loading: boolean;
  title: string;
  body: string;
  dirty: boolean;
  saveState: SaveState;
  error: string | null;
  focusMode: boolean;
  onToggleFocus: () => void;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSave: () => void;
  onReload: () => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenNote: (id: string) => void;
}

export function Editor({
  note,
  notes,
  icon,
  onIconChange,
  loading,
  title,
  body,
  dirty,
  saveState,
  error,
  focusMode,
  onToggleFocus,
  onTitleChange,
  onBodyChange,
  onSave,
  onReload,
  onRename,
  onDelete,
  onOpenNote,
}: EditorProps) {
  const [editorMode, setEditorMode] = useState<'source' | 'live'>('live');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

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
          <div className="mb-4 grid size-10 place-items-center rounded-md bg-muted/60 text-muted-foreground">
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
  const pathParts = note.path.split('/').filter(Boolean);
  if (pathParts[0] === 'notes') pathParts.shift();
  const fileName = pathParts.pop() ?? '';
  const folders = pathParts;
  const pageName = title.trim() === '' ? fileName.replace(/\.md$/, '') : title;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background" aria-label="Editor">
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5 sm:px-4">
        <nav
          aria-label="Breadcrumb"
          title={note.path}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[12px] text-muted-foreground"
        >
          <span className="shrink-0">Notes</span>
          {folders.map((segment, index) => (
            <span key={`${index}-${segment}`} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="size-3 shrink-0 opacity-60" />
              <span className="truncate">{segment}</span>
            </span>
          ))}
          <span className="flex min-w-0 items-center gap-1">
            <ChevronRight className="size-3 shrink-0 opacity-60" />
            <span className="truncate text-foreground/75">{pageName}</span>
          </span>
        </nav>
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
                <Check className="size-3 text-muted-foreground" />
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Page information"
                title="Page information"
              >
                <Info />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64 text-[11px]">
              <div className="font-mono">{note.id}</div>
              <div className="mt-1">SHA-256 {note.contentHash}</div>
              {note.metadataKeys.length > 0 ? (
                <div className="mt-1">Preserved: {note.metadataKeys.join(', ')}</div>
              ) : null}
            </TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="inline-flex h-7 px-2 text-[11px]"
            onClick={() => setEditorMode((mode) => (mode === 'source' ? 'live' : 'source'))}
            aria-label={editorMode === 'source' ? 'Switch to live Markdown' : 'Switch to source Markdown'}
          >
            {editorMode === 'source' ? 'Live' : 'Source'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="hidden md:inline-flex"
            onClick={onToggleFocus}
            aria-label={focusMode ? 'Exit focus mode' : 'Enter focus mode'}
            title={focusMode ? 'Exit focus mode' : 'Focus mode'}
          >
            {focusMode ? <Minimize2 /> : <Maximize2 />}
          </Button>
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
            variant={dirty ? 'secondary' : 'ghost'}
            size="sm"
            className={dirty ? 'gap-1.5 text-foreground' : 'gap-1.5 text-muted-foreground'}
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
        <div className="mx-auto w-full max-w-[760px] px-6 py-10 sm:px-10 sm:py-14">
          <div className="mb-2 flex min-h-12 items-center">
            {icon === null ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
                onClick={() => setIconPickerOpen(true)}
                aria-label="Add page icon"
              >
                <ImagePlus className="size-4" />
                Add icon
              </Button>
            ) : (
              <button
                type="button"
                className="grid size-12 place-items-center rounded-md text-4xl leading-none transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80"
                onClick={() => setIconPickerOpen(true)}
                aria-label="Change page icon"
                title="Change page icon"
              >
                <span aria-hidden="true">{icon}</span>
              </button>
            )}
          </div>

          <label className="sr-only" htmlFor="note-title">
            Note title
          </label>
          <input
            id="note-title"
            className="w-full rounded-sm border-0 bg-transparent p-0 text-[32px] leading-[1.2] font-semibold tracking-[-0.02em] outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring sm:text-[40px]"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Untitled page"
            spellCheck={false}
          />

          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            <span>Updated {formatDateTime(note.updatedAt)}</span>
            <span aria-hidden="true">·</span>
            <span>{words === 1 ? '1 word' : `${words} words`}</span>
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
          <CodeMirrorEditor
            key={note.id}
            value={body}
            onChange={onBodyChange}
            mode={editorMode}
            notes={notes}
            onOpenNote={onOpenNote}
            className="mt-7 h-[45vh] w-full rounded-sm [&_.cm-editor]:h-full [&_.cm-editor]:outline-none"
            aria-label="Markdown body"
          />
        </div>
      </ScrollArea>

      <PageIconPicker
        open={iconPickerOpen}
        value={icon}
        onOpenChange={setIconPickerOpen}
        onSelect={onIconChange}
      />
    </section>
  );
}
