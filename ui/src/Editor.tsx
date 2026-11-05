import {
  AlertCircle,
  Check,
  ChevronRight,
  FileText,
  ImagePlus,
  Info,
  ListTree,
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
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { GroupImperativeHandle } from 'react-resizable-panels';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatDateTime, wordCount } from './format';
import type { SaveState } from './types';
import { BacklinksPanel } from './BacklinksPanel';
import { RelationBacklinksPanel } from './RelationBacklinksPanel';
import { RelatedNotesPanel } from './RelatedNotesPanel';
import { PageIconPicker } from './PageIconPicker';
import { SidebarToggle } from './SidebarToggle';
import { TagEditor } from './editor/TagEditor';
import { PropertyEditor } from './editor/PropertyEditor';
import type { NotePropertyValue } from '../../src/properties/catalog';
import { buildOutlineTree, type DocumentHeading, type DocumentOutlineNode } from './editor/documentOutline';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import type { EditorLayout, WorkspacePreferences } from './workspacePreferences';

const CodeMirrorEditor = lazy(() => import('./editor/CodeMirrorEditor').then((module) => ({ default: module.CodeMirrorEditor })));
const MarkdownPreview = lazy(() => import('./editor/MarkdownPreview').then((module) => ({ default: module.MarkdownPreview })));

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
  layout: EditorLayout;
  editorMode: 'live' | 'source';
  splitRatio: number;
  onLayoutChange: (layout: EditorLayout) => void;
  onEditorModeChange: (mode: 'live' | 'source') => void;
  onSplitRatioChange: (ratio: number) => void;
  panels: WorkspacePreferences['panels'];
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
  tagMutationBusy: boolean;
  tagMutationDisabled: boolean;
  tagMutationDisabledReason?: string;
  onAddTag: (tag: string) => Promise<void>;
  onRemoveTag: (tag: string) => Promise<void>;
  vaultIdentity: string;
  propertyMutationBusy: boolean;
  propertyMutationDisabled: boolean;
  propertyMutationDisabledReason?: string;
  onSetPropertyValue: (propertyId: string, value: NotePropertyValue) => Promise<UiNote>;
  onUnsetPropertyValue: (propertyId: string) => Promise<UiNote>;
  onCatalogChanged?: () => void;
  backlinksRevision: number;
  taskNavigation: { line: number; sequence: number } | null;
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
  layout,
  editorMode,
  splitRatio,
  onLayoutChange,
  onEditorModeChange,
  onSplitRatioChange,
  panels,
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
  tagMutationBusy,
  tagMutationDisabled,
  tagMutationDisabledReason,
  onAddTag,
  onRemoveTag,
  vaultIdentity,
  propertyMutationBusy,
  propertyMutationDisabled,
  propertyMutationDisabledReason,
  onSetPropertyValue,
  onUnsetPropertyValue,
  onCatalogChanged,
  backlinksRevision,
  taskNavigation,
}: EditorProps) {
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [headings, setHeadings] = useState<readonly DocumentHeading[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [outlineNavigationRequest, setOutlineNavigationRequest] = useState<{ id: string; sequence: number } | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);
  const [widePreview, setWidePreview] = useState(false);
  const previewGroupRef = useRef<GroupImperativeHandle | null>(null);
  const editorSize = layout === 'preview' ? 0 : layout === 'split' ? splitRatio * 100 : 100;
  const previewSize = 100 - editorSize;

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => setWidePreview(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    previewGroupRef.current?.setLayout({ 'note-editor-panel': editorSize, 'note-preview-panel': previewSize });
  }, [editorSize, previewSize]);

  useEffect(() => {
    if (layout !== 'split') return;
    previewGroupRef.current?.setLayout({ 'note-editor-panel': splitRatio * 100, 'note-preview-panel': (1 - splitRatio) * 100 });
  }, [layout, splitRatio]);

  useEffect(() => {
    setHeadings([]);
    setActiveHeadingId(null);
    setOutlineNavigationRequest(null);
  }, [note?.id]);

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
      <header className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5 sm:px-4">
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
        <div className="hidden sm:block sm:min-w-0 sm:flex-1" aria-hidden="true" />
        <div className="flex w-full min-w-0 flex-nowrap items-center justify-end gap-1.5 sm:w-auto sm:flex-none">
          <span
            className="inline-flex min-w-0 items-center justify-end gap-1 text-[11px] font-medium sm:min-w-20"
            aria-live="polite"
            aria-atomic="true"
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
                className="hidden sm:inline-flex"
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
            className="hidden items-center gap-1 sm:flex"
          >
            {(['live', 'source', 'preview', 'split'] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                size="xs"
                variant="ghost"
                aria-pressed={mode === 'preview' ? layout === 'preview' : mode === 'split' ? layout === 'split' : layout !== 'preview' && editorMode === mode}
                className={cn(
                  'h-7 rounded-[5px] border px-2 text-[11px] font-medium',
                  (mode === 'preview' ? layout === 'preview' : mode === 'split' ? layout === 'split' : layout !== 'preview' && editorMode === mode)
                    ? 'border-border bg-muted text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                onClick={() => {
                  if (mode === 'preview') onLayoutChange('preview');
                  else if (mode === 'split') onLayoutChange('split');
                  else { onEditorModeChange(mode); onLayoutChange(mode); }
                }}
              >
                {mode === 'live' ? 'Live' : mode === 'source' ? 'Source' : mode === 'split' ? 'Split' : 'Preview'}
              </Button>
            ))}
          </div>
          <Select
            value={layout === 'split' || layout === 'preview' ? layout : editorMode}
            onValueChange={(value) => {
              const next = value as EditorLayout;
              if (next === 'live' || next === 'source') onEditorModeChange(next);
              onLayoutChange(next);
            }}
          >
            <SelectTrigger className="h-7 w-[6.5rem] text-[11px] sm:hidden" aria-label="Markdown rendering mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="source">Source</SelectItem>
              <SelectItem value="preview">Preview</SelectItem>
              <SelectItem value="split">Split</SelectItem>
            </SelectContent>
          </Select>
          <Popover open={outlineOpen} onOpenChange={setOutlineOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="gap-1.5" aria-label="Document outline">
                <ListTree data-icon="inline-start" />
                <span className="hidden sm:inline">Outline</span>
                {headings.length ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{headings.length}</Badge> : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" aria-label="Document outline" className="w-[min(22rem,calc(100vw-2rem))] p-0">
              <div className="border-b px-3 py-2">
                <h2 className="text-xs font-semibold">Document outline</h2>
                <p className="text-[11px] text-muted-foreground">Headings in this Markdown note</p>
              </div>
              {headings.length ? (
                <ScrollArea className="max-h-[60vh] px-2 py-1">
                  <nav aria-label="Headings">
                    <OutlineList nodes={buildOutlineTree(headings)} activeId={activeHeadingId} onNavigate={(id) => {
                      setOutlineOpen(false);
                      setActiveHeadingId(id);
                      if (layout === 'preview') document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      else setOutlineNavigationRequest((previous) => ({ id, sequence: (previous?.sequence ?? 0) + 1 }));
                    }} />
                  </nav>
                </ScrollArea>
              ) : (
                <p className="px-3 py-4 text-xs text-muted-foreground" role="status">No headings yet. Start a line with # to add a section.</p>
              )}
            </PopoverContent>
          </Popover>
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

          <h1 className="sr-only">{title || 'Untitled page'}</h1>
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

          <TagEditor
            noteId={note.id}
            tags={note.tags}
            disabled={tagMutationDisabled}
            disabledReason={tagMutationDisabledReason}
            busy={tagMutationBusy || propertyMutationBusy}
            onAdd={onAddTag}
            onRemove={onRemoveTag}
          />
          <PropertyEditor
            note={note}
            vaultIdentity={vaultIdentity}
            disabled={propertyMutationDisabled}
            disabledReason={propertyMutationDisabledReason}
            busy={propertyMutationBusy || tagMutationBusy}
            onSetValue={onSetPropertyValue}
            onUnsetValue={onUnsetPropertyValue}
            onReloadNote={onReload}
            onCatalogChanged={onCatalogChanged}
          />
          {note.aliases.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Note aliases">
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
          <div className="mt-6 w-full">
            <ResizablePanelGroup
              id="note-editor-preview-group"
              groupRef={previewGroupRef}
              orientation={layout === 'split' ? (widePreview ? 'horizontal' : 'vertical') : 'horizontal'}
              defaultLayout={{ 'note-editor-panel': editorSize, 'note-preview-panel': previewSize }}
              disabled={layout !== 'split'}
              className={cn('min-h-[42vh] w-full overflow-hidden', layout === 'split' ? 'h-[min(68vh,52rem)] min-h-[24rem] max-h-[72vh]' : 'h-[min(68vh,52rem)] max-h-[72vh]')}
              onLayoutChanged={(next, meta) => {
                if (!meta.isUserInteraction || layout !== 'split') return;
                const total = (next['note-editor-panel'] ?? 0) + (next['note-preview-panel'] ?? 0);
                if (total > 0) onSplitRatioChange(Math.min(0.65, Math.max(0.35, (next['note-editor-panel'] ?? 50) / total)));
              }}
            >
              <ResizablePanel id="note-editor-panel" collapsible collapsedSize={0} minSize={layout === 'split' ? 35 : 0} defaultSize={editorSize} className="min-h-0 min-w-0 overflow-hidden">
                <div className={cn('w-full', layout === 'split' ? 'h-full min-h-0 overflow-auto' : 'min-h-full overflow-visible')}>
                  <Suspense fallback={<div className="flex min-h-[42vh] items-center justify-center text-xs text-muted-foreground" role="status">Loading Markdown editor…</div>}>
                    <CodeMirrorEditor
                      key={note.id}
                      value={body}
                      onChange={onBodyChange}
                      mode={editorMode}
                      onOutlineChange={(next) => setHeadings((current) => sameHeadingList(current, next) ? current : next)}
                      onActiveHeadingChange={setActiveHeadingId}
                      outlineNavigationRequest={outlineNavigationRequest}
                      taskNavigationRequest={taskNavigation}
                      notes={notes}
                      onOpenNote={onOpenNote}
                      notePath={note.path}
                      className={cn('w-full [&_.cm-editor]:outline-none', layout === 'split' ? 'h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto' : '[&_.cm-editor]:h-auto [&_.cm-scroller]:overflow-visible')}
                      aria-label="Markdown body"
                    />
                  </Suspense>
                </div>
              </ResizablePanel>
              {layout === 'split' ? <ResizableHandle withHandle aria-label="Resize editor and preview" className="data-[orientation=vertical]:h-1 data-[orientation=vertical]:w-full" /> : null}
              <ResizablePanel id="note-preview-panel" collapsible collapsedSize={0} minSize={layout === 'split' ? 35 : 0} defaultSize={previewSize} className="min-h-0 min-w-0 overflow-hidden">
                <div className={cn('h-full min-h-0 w-full overflow-auto', layout === 'split' && !widePreview ? 'border-t' : 'border-l')}>
                  {layout === 'preview' || layout === 'split' ? <Suspense fallback={<div className="flex min-h-[42vh] items-center justify-center text-xs text-muted-foreground" role="status">Loading preview…</div>}><MarkdownPreview value={body} notePath={note.path} notes={notes} onOpenNote={onOpenNote} onActiveHeadingChange={setActiveHeadingId} /></Suspense> : null}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>

          {panels.backlinks ? <BacklinksPanel noteId={note.id} revision={backlinksRevision} onOpenNote={onOpenNote} /> : null}
          {panels.relationBacklinks ? <RelationBacklinksPanel noteId={note.id} revision={backlinksRevision} onOpenNote={onOpenNote} /> : null}
          {panels.relatedNotes ? <RelatedNotesPanel key={`${vaultIdentity}:${note.id}`} noteId={note.id} revision={backlinksRevision} onOpenNote={onOpenNote} /> : null}
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

function sameHeadingList(left: readonly DocumentHeading[], right: readonly DocumentHeading[]): boolean {
  return left.length === right.length && left.every((heading, index) => {
    const next = right[index]!;
    return heading.id === next.id && heading.text === next.text && heading.level === next.level && heading.from === next.from;
  });
}

function OutlineList({ nodes, activeId, onNavigate }: { nodes: readonly DocumentOutlineNode[]; activeId: string | null; onNavigate: (id: string) => void }) {
  return <ol className="flex flex-col gap-0.5 py-1">
    {nodes.map((node) => <li key={node.id}>
      <Button type="button" variant="ghost" size="sm" className={cn('h-auto min-h-7 w-full justify-start gap-2 px-2 py-1 text-left text-xs font-normal', activeId === node.id && 'bg-muted text-foreground font-medium')} aria-current={activeId === node.id ? 'location' : undefined} onClick={() => onNavigate(node.id)}>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">H{node.level}</span>
        <span className="min-w-0 truncate">{node.text || 'Untitled heading'}</span>
      </Button>
      {node.children.length ? <div className="ml-3 border-l pl-1.5"><OutlineList nodes={node.children} activeId={activeId} onNavigate={onNavigate} /></div> : null}
    </li>)}
  </ol>;
}
