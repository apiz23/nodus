import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight, FileText, Folder, FolderOpen, Plus, Search } from 'lucide-react';
import type { UiNoteSummary, UiSearchResult } from '../../src/ui-server/dto';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { PageIcon } from './PageIcon';

const EXPANDED_KEY = 'nodus-page-tree-expanded';

interface FolderNode {
  name: string;
  path: string;
  folders: Map<string, FolderNode>;
  notes: UiNoteSummary[];
}

interface PageTreeProps {
  notes: UiNoteSummary[];
  results: UiSearchResult[];
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

function addNote(root: FolderNode, note: UiNoteSummary): void {
  const relative = note.path.startsWith('notes/') ? note.path.slice('notes/'.length) : note.path;
  const parts = relative.split('/').filter(Boolean);
  const file = parts.pop();
  if (file === undefined) return;

  let current = root;
  let path = '';
  for (const part of parts) {
    path = path === '' ? part : `${path}/${part}`;
    let folder = current.folders.get(part);
    if (folder === undefined) {
      folder = { name: part, path, folders: new Map(), notes: [] };
      current.folders.set(part, folder);
    }
    current = folder;
  }
  current.notes.push(note);
}

function folderPaths(root: FolderNode): string[] {
  const paths: string[] = [];
  for (const folder of root.folders.values()) {
    paths.push(folder.path, ...folderPaths(folder));
  }
  return paths;
}

function countNotes(node: FolderNode): number {
  return (
    node.notes.length +
    [...node.folders.values()].reduce((sum, folder) => sum + countNotes(folder), 0)
  );
}

function readExpanded(): Set<string> | null {
  try {
    const stored = window.localStorage.getItem(EXPANDED_KEY);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) return null;
    return new Set(parsed);
  } catch {
    return null;
  }
}

export function PageTree({
  notes,
  results,
  query,
  selectedId,
  loading,
  searching,
  error,
  onCreate,
  onOpen,
  onClearSearch,
  onRetry,
}: PageTreeProps) {
  const tree = useMemo(() => {
    const root: FolderNode = { name: '', path: '', folders: new Map(), notes: [] };
    for (const note of notes) addNote(root, note);
    return root;
  }, [notes]);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => readExpanded() ?? new Set(),
  );
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || notes.length === 0) return;
    initialized.current = true;
    setExpanded((current) => {
      if (current.size > 0) return current;
      return new Set(folderPaths(tree));
    });
  }, [notes.length, tree]);

  useEffect(() => {
    try {
      window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch {
      // Storage may be unavailable; tree still works for this session.
    }
  }, [expanded]);

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const isSearching = query.trim() !== '';

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'treeitem') return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const index = items.indexOf(target);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
      items[Math.min(Math.max(next, 0), items.length - 1)]?.focus();
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
      return;
    }
    if (event.key === 'ArrowRight') {
      if (target.getAttribute('aria-expanded') === 'false') {
        event.preventDefault();
        target.click();
      }
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (target.getAttribute('aria-expanded') === 'true') {
        target.click();
        return;
      }
      const parent = target.closest('[role="group"]')?.previousElementSibling;
      if (parent instanceof HTMLElement && parent.getAttribute('role') === 'treeitem') parent.focus();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 px-2 pt-1">
        <span className="text-[12px] font-medium text-muted-foreground">Pages</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        {error === null ? null : (
          <div className="mx-1 mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
            <div>{error}</div>
            <button type="button" className="mt-1 underline underline-offset-2" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}

        {loading || (isSearching && searching) ? (
          <div className="space-y-1.5 px-1" aria-label="Loading pages">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        ) : isSearching ? (
          results.length === 0 ? (
            <div className="px-2 py-8 text-center">
              <Search className="mx-auto mb-2 size-4 text-muted-foreground" />
              <p className="text-xs font-medium">No matches</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Try a title, path, or phrase from the note body.
              </p>
              <Button type="button" variant="ghost" size="xs" className="mt-2" onClick={onClearSearch}>
                Clear search
              </Button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {results.map((result) => (
                <SearchResultRow
                  key={result.id}
                  result={result}
                  selected={result.id === selectedId}
                  onOpen={onOpen}
                />
              ))}
            </div>
          )
        ) : notes.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <FileText className="mx-auto mb-2 size-4 text-muted-foreground" />
            <p className="text-xs font-medium">No pages yet</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Create a Markdown page in this local vault.
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onCreate}>
              <Plus data-icon="inline-start" />
              New page
            </Button>
          </div>
        ) : (
          <div role="tree" aria-label="Pages" onKeyDown={handleTreeKeyDown}>
            <TreeLevel
              root={tree}
              depth={0}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={toggle}
              onOpen={onOpen}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TreeLevel({
  root,
  depth,
  expanded,
  selectedId,
  onToggle,
  onOpen,
}: {
  root: FolderNode;
  depth: number;
  expanded: Set<string>;
  selectedId: string | null;
  onToggle: (path: string) => void;
  onOpen: (id: string) => void;
}) {
  const folders = [...root.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  const notes = [...root.notes].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <>
      {folders.map((folder) => {
        const open = expanded.has(folder.path);
        const noteCount = countNotes(folder);
        return (
          <div key={folder.path} role="none">
            <button
              type="button"
              role="treeitem"
              aria-expanded={open}
              aria-level={depth + 1}
              aria-label={`${folder.name}, ${noteCount} ${noteCount === 1 ? 'page' : 'pages'}`}
              className="flex h-7 w-full items-center gap-1.5 rounded-[4px] pr-2 text-left text-[13px] text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80"
              style={{ paddingLeft: `${6 + depth * 16}px` }}
              onClick={() => onToggle(folder.path)}
            >
              <ChevronRight
                className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
              />
              {open ? (
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{folder.name}</span>
            </button>
            {open ? (
              <div role="group">
                <TreeLevel
                  root={folder}
                  depth={depth + 1}
                  expanded={expanded}
                  selectedId={selectedId}
                  onToggle={onToggle}
                  onOpen={onOpen}
                />
              </div>
            ) : null}
          </div>
        );
      })}

      {notes.map((note) => (
        <button
          key={note.id}
          type="button"
          role="treeitem"
          aria-selected={note.id === selectedId}
          aria-level={depth + 1}
          className={cn(
            'flex h-7 w-full items-center gap-1.5 rounded-[4px] pr-2 text-left text-[13px] transition-colors',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80',
            note.id === selectedId
              ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
              : 'text-sidebar-foreground/85',
          )}
          style={{ paddingLeft: `${6 + depth * 16 + 18}px` }}
          onClick={() => onOpen(note.id)}
          title={note.path}
        >
          <PageIcon icon={note.icon} className="size-4 text-[13px]" />
          <span className="truncate">{note.title}</span>
        </button>
      ))}
    </>
  );
}

function SearchResultRow({
  result,
  selected,
  onOpen,
}: {
  result: UiSearchResult;
  selected: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full flex-col rounded-[4px] px-2 py-1.5 text-left transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80',
        selected && 'bg-sidebar-accent text-sidebar-accent-foreground',
      )}
      onClick={() => onOpen(result.id)}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <PageIcon icon={result.icon} className="size-4 text-[13px]" />
        <span className="truncate text-[12.5px] font-medium">{result.title}</span>
      </span>
      <span className="mt-0.5 line-clamp-2 pl-[22px] text-[11px] leading-snug text-muted-foreground">
        {result.snippet}
      </span>
    </button>
  );
}
