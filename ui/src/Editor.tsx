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
  StretchHorizontal,
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
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatDateTime, wordCount } from './format';
import type { SaveState } from './types';
import { CodeMirrorEditor } from './editor/CodeMirrorEditor';
import { BacklinksPanel } from './BacklinksPanel';
import { PageIconPicker } from './PageIconPicker';
import { SidebarToggle } from './SidebarToggle';

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
  fullWidth: boolean;
  onToggleWidth: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleFocus: () => void;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSave: () => void;
  onReload: () => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenNote: (id: string) => void;
  backlinksRevision: number;
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
  fullWidth,
  onToggleWidth,
  sidebarCollapsed,
  onToggleSidebar,
  onToggleFocus,
  onTitleChange,
  onBodyChange,
  onSave,
  onReload,
  onRename,
  onDelete,
  onOpenNote,
  backlinksRevision,
}: EditorProps) {
  const [editorMode, setEditorMode] = useState<'source' | 'live'>('live');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);

  if (loading) {
    return (
      <section className="flex min-h-0 flex-1 flex-col bg-background" aria-label="Editor" aria-busy="true">
        <div className="flex h-11 items-center gap-2 border-b px-3 sm:px-4">
          <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
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
        <header className="flex h-11 shrink-0 items-center border-b px-3 sm:px-4">
          <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        </header>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
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
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        <nav
          aria-label="Breadcrumb"
          title={note.path}
          className="hidden min-w-0 flex-1 items-center gap-1 overflow-hidden text-[12px] text-muted-foreground sm:flex"
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
        <div className="min-w-0 flex-1 sm:hidden" aria-hidden="true" />
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className="inline-flex min-w-0 items-center justify-end gap-1 text-[11px] font-medium sm:min-w-20"
            aria-live="polite"
          >
            {saveState === 'saving' ? (
              <>
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Saving…</span>
              </>
            ) : null}
            {saveState === 'saved' && !dirty ? (
              <>
                <Check className="size-3 text-success" />
                <span className="text-success">Saved</span>
              </>
            ) : null}
            {saveState === 'error' ? (
              <>
                <AlertCircle className="size-3 text-destructive" />
                <span className="text-destructive">Not saved</span>
              </>
            ) : null}
            {dirty && saveState !== 'saving' && saveState !== 'error' ? (
              <span className="text-muted-foreground">Unsaved</span>
            ) : null}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={fullWidth ? 'Use comfortable editor width' : 'Use full editor width'}
                aria-pressed={fullWidth}
                onClick={onToggleWidth}
              >
                <StretchHorizontal />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {fullWidth ? 'Use comfortable width' : 'Use full writing width'}
            </TooltipContent>
          </Tooltip>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Page information"
                title="Page information"
              >
                <Info />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" aria-label="Page information" className="w-72 text-xs">
              <h2 className="text-xs font-semibold">Page information</h2>
              <dl className="mt-2 space-y-2">
                <div>
                  <dt className="text-[11px] text-muted-foreground">Note ID</dt>
                  <dd className="mt-0.5 font-mono text-[10px] break-all">{note.id}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Content hash</dt>
                  <dd className="mt-0.5 font-mono text-[10px] break-all">SHA-256 {note.contentHash}</dd>
                </div>
                {note.metadataKeys.length > 0 ? (
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Preserved metadata</dt>
                    <dd className="mt-0.5 break-words">{note.metadataKeys.join(', ')}</dd>
                  </div>
                ) : null}
              </dl>
            </PopoverContent>
          </Popover>
          <div
            role="group"
            aria-label="Markdown rendering mode"
            className="flex items-center gap-1"
          >
            {(['live', 'source'] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                size="xs"
                variant="ghost"
                aria-pressed={editorMode === mode}
                className={cn(
                  'h-7 rounded-[5px] border px-2 text-[11px] font-medium',
                  editorMode === mode
                    ? 'border-border bg-muted text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setEditorMode(mode)}
              >
                {mode === 'live' ? 'Live' : 'Source'}
              </Button>
            ))}
          </div>
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
            variant="ghost"
            size="sm"
            className={cn(
              'gap-1.5',
              dirty
                ? 'bg-success text-white shadow-sm hover:bg-success/90 hover:text-white focus-visible:border-success/50 focus-visible:ring-success/30'
                : 'text-muted-foreground',
            )}
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
        <div
          className={cn(
            'mx-auto min-w-0 w-full py-12 sm:py-16',
            fullWidth ? 'max-w-none px-5 sm:px-8 lg:px-12' : 'max-w-[43rem] px-6 sm:px-8',
          )}
        >
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
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="size-12 text-4xl leading-none"
                onClick={() => setIconPickerOpen(true)}
                aria-label="Change page icon"
                title="Change page icon"
              >
                <span aria-hidden="true">{icon}</span>
              </Button>
            )}
          </div>

          <label className="sr-only" htmlFor="note-title">
            Note title
          </label>
          <div className="relative min-w-0 w-full">
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-0 block truncate text-[34px] leading-[1.15] font-semibold tracking-[-0.025em] text-foreground sm:text-[40px] md:text-[40px]',
                titleFocused && 'invisible',
              )}
            >
              {title || 'Untitled page'}
            </span>
            <Input
              id="note-title"
              type="text"
              className={cn(
                'h-auto min-h-0 w-full truncate rounded-sm border-0 bg-transparent px-0 py-0 text-[34px] leading-[1.15] font-semibold tracking-[-0.025em] outline-none focus-visible:ring-1 focus-visible:ring-ring/70 sm:text-[40px] md:text-[40px]',
                titleFocused
                  ? 'text-foreground caret-success placeholder:text-muted-foreground'
                  : 'text-transparent caret-transparent placeholder:text-transparent',
              )}
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              onFocus={() => setTitleFocused(true)}
              onBlur={() => setTitleFocused(false)}
              placeholder="Untitled page"
              spellCheck={false}
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
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
            className="mt-6 w-full [&_.cm-editor]:h-auto [&_.cm-editor]:outline-none [&_.cm-scroller]:overflow-visible"
            aria-label="Markdown body"
          />

          <BacklinksPanel
            noteId={note.id}
            revision={backlinksRevision}
            onOpenNote={onOpenNote}
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
