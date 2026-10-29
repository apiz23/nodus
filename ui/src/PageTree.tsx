import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertCircle, ChevronRight, Copy, FilePlus, FileText, Folder, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { UiFolderImpact, UiNoteSummary, UiSearchResult } from '../../src/ui-server/dto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { SearchResultContext } from './SearchResultContext';
import { PageIcon } from './PageIcon';

const EXPANDED_KEY = 'nodus-page-tree-expanded';

interface FolderNode {
  name: string;
  /** Display path in the merged sidebar tree. */
  path: string;
  /** Actual vault-relative path, including the hidden `notes/` root when present. */
  storagePath: string;
  folders: Map<string, FolderNode>;
  notes: UiNoteSummary[];
}

interface PageTreeProps {
  notes: UiNoteSummary[];
  results: UiSearchResult[];
  query: string;
  selectedId: string | null;
  folders: string[];
  folderError: string | null;
  loading: boolean;
  searching: boolean;
  error: string | null;
  onCreate: () => void;
  onCreateInFolder: (folder: string) => void;
  onCreateFolder: (path: string) => Promise<void>;
  onMoveFolder: (fromPath: string, toPath: string) => Promise<boolean>;
  onInspectFolder: (path: string) => Promise<UiFolderImpact>;
  onDeleteFolder: (path: string, token: string) => Promise<string[] | false>;
  onFolderMutation: () => void;
  navigationLocked: boolean;
  onOpen: (id: string) => void;
  onRenameNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
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
      const storagePath = note.path.startsWith('notes/') ? `notes/${path}` : path;
      folder = { name: part, path, storagePath, folders: new Map(), notes: [] };
      current.folders.set(part, folder);
    }
    current = folder;
  }
  current.notes.push(note);
}

function addFolder(root: FolderNode, storagePath: string): void {
  if (storagePath === 'notes') return;
  const displayPath = storagePath.startsWith('notes/') ? storagePath.slice('notes/'.length) : storagePath;
  const parts = displayPath.split('/').filter(Boolean);
  let current = root;
  let display = '';
  let storage = '';
  for (const part of parts) {
    display = display ? `${display}/${part}` : part;
    storage = storagePath.startsWith('notes/') ? `notes/${display}` : display;
    let folder = current.folders.get(part);
    if (folder === undefined) {
      folder = { name: part, path: display, storagePath: storage, folders: new Map(), notes: [] };
      current.folders.set(part, folder);
    }
    current = folder;
  }
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

function folderForNote(node: FolderNode, id: string): string | null {
  if (node.notes.some((note) => note.id === id)) return node.path || null;
  for (const folder of node.folders.values()) {
    const found = folderForNote(folder, id);
    if (found !== null) return found;
  }
  return null;
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
  folders,
  folderError,
  results,
  query,
  selectedId,
  loading,
  searching,
  error,
  onCreate,
  onCreateInFolder,
  onCreateFolder,
  onMoveFolder,
  onInspectFolder,
  onDeleteFolder,
  onFolderMutation,
  navigationLocked,
  onOpen,
  onRenameNote,
  onDeleteNote,
  onClearSearch,
  onRetry,
}: PageTreeProps) {
  const tree = useMemo(() => {
    const root: FolderNode = { name: '', path: '', storagePath: '', folders: new Map(), notes: [] };
    for (const path of folders) addFolder(root, path);
    for (const note of notes) addNote(root, note);
    return root;
  }, [folders, notes]);
  const activeFolderPath = selectedId === null ? null : folderForNote(tree, selectedId);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => readExpanded() ?? new Set(),
  );
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(activeFolderPath);
  const [actionAnnouncement, setActionAnnouncement] = useState('');
  const [folderDialog, setFolderDialog] = useState<{ kind: 'create' | 'rename' | 'move'; folder: FolderNode | null } | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderParent, setFolderParent] = useState('__root__');
  const [folderSubmitError, setFolderSubmitError] = useState<string | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [deleteFolder, setDeleteFolder] = useState<FolderNode | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<UiFolderImpact | null>(null);
  const [deleteFolderError, setDeleteFolderError] = useState<string | null>(null);
  const [deleteFolderBusy, setDeleteFolderBusy] = useState(false);
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
    setSelectedFolderPath(activeFolderPath);
    if (activeFolderPath === null) return;
    const ancestors = activeFolderPath.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'));
    setExpanded((current) => new Set([...current, ...ancestors]));
  }, [activeFolderPath]);

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

  const beginFolderCreate = (parent = '__root__') => {
    setFolderName('');
    setFolderParent(parent);
    setFolderSubmitError(null);
    setFolderDialog({ kind: 'create', folder: null });
  };

  const beginFolderEdit = (kind: 'rename' | 'move', folder: FolderNode) => {
    setFolderName(folder.name);
    const parent = folder.storagePath.includes('/') ? folder.storagePath.slice(0, folder.storagePath.lastIndexOf('/')) : '__root__';
    setFolderParent(parent);
    setFolderSubmitError(null);
    setFolderDialog({ kind, folder });
  };

  const submitFolder = async () => {
    if (folderBusy || navigationLocked || folderDialog === null) return;
    const name = folderName.trim();
    if (!name || name.includes('/') || name.includes('\\')) {
      setFolderSubmitError('Enter a folder name without path separators.');
      return;
    }
    const parent = folderParent === '__root__' ? '' : folderParent;
    const destination = parent ? `${parent}/${name}` : name;
    setFolderBusy(true);
    setFolderSubmitError(null);
    try {
      if (folderDialog.kind === 'create') await onCreateFolder(destination);
      else if (folderDialog.folder !== null && !(await onMoveFolder(folderDialog.folder.storagePath, destination))) return;
      const previousDisplay = folderDialog.folder?.path;
      setFolderDialog(null);
      onFolderMutation();
      const display = destination.startsWith('notes/') ? destination.slice('notes/'.length) : destination;
      const ancestors = display.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'));
      setExpanded((current) => {
        const next = new Set(current);
        if (previousDisplay !== undefined && previousDisplay !== display) {
          for (const path of next) {
            if (path === previousDisplay || path.startsWith(`${previousDisplay}/`)) next.delete(path);
          }
        }
        for (const path of ancestors) next.add(path);
        return next;
      });
      if (folderDialog.kind !== 'create') setSelectedFolderPath(display);
    } catch (error) {
      setFolderSubmitError(error instanceof Error ? error.message : 'Could not update the folder.');
    } finally {
      setFolderBusy(false);
    }
  };

  const beginFolderDelete = async (folder: FolderNode) => {
    setDeleteFolder(folder);
    setDeleteImpact(null);
    setDeleteFolderError(null);
    setDeleteFolderBusy(true);
    try { setDeleteImpact(await onInspectFolder(folder.storagePath)); }
    catch (error) { setDeleteFolderError(error instanceof Error ? error.message : 'Could not inspect this folder.'); }
    finally { setDeleteFolderBusy(false); }
  };

  const confirmFolderDelete = async () => {
    if (deleteFolder === null || deleteImpact === null || deleteFolderBusy || navigationLocked) return;
    setDeleteFolderBusy(true);
    setDeleteFolderError(null);
    try {
      if (await onDeleteFolder(deleteFolder.storagePath, deleteImpact.token) === false) return;
      const deletedPath = deleteFolder.path;
      setDeleteFolder(null);
      setDeleteImpact(null);
      onFolderMutation();
      setExpanded((current) => new Set([...current].filter((path) => path !== deletedPath && !path.startsWith(`${deletedPath}/`))));
      setSelectedFolderPath(deletedPath.includes('/') ? deletedPath.slice(0, deletedPath.lastIndexOf('/')) : null);
    } catch (error) {
      setDeleteFolderError(error instanceof Error ? error.message : 'Could not delete this folder.');
    } finally { setDeleteFolderBusy(false); }
  };

  const isSearching = query.trim() !== '';

  const handleSearchResultsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest<HTMLElement>('[data-search-result="true"]');
    if (row === null) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-search-result="true"]')];
    const index = rows.indexOf(row);
    if (index === -1) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : event.key === 'ArrowDown' ? index + 1 : index - 1;
      rows[Math.min(Math.max(next, 0), rows.length - 1)]?.focus();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.closest('aside')?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      onClearSearch();
    }
  };

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
      const previousFolderRow = target.closest('[role="group"]')?.previousElementSibling;
      const parent = previousFolderRow?.querySelector<HTMLElement>('[role="treeitem"]');
      parent?.focus();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mb-1 flex items-center justify-between gap-1 px-2 pt-1">
        <span className="text-[12px] font-medium text-muted-foreground">Pages</span>
        <div className="flex items-center gap-0.5">
          <Button type="button" variant="ghost" size="xs" className="h-6 px-1.5 text-[11px]" disabled={navigationLocked} onClick={onCreate}>
            <FilePlus data-icon="inline-start" /> New note
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="New folder" title="New folder" disabled={navigationLocked} onClick={() => beginFolderCreate()}>
            <FolderPlus />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        {folderError === null ? null : <div role="alert" className="mx-1 mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">Folders could not be refreshed: {folderError}</div>}
        {error === null ? null : (
          <div role="alert" className="mx-1 mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
            <div>{error}</div>
            <Button type="button" variant="link" size="xs" onClick={onRetry}>{isSearching ? 'Retry search' : 'Retry'}</Button>
          </div>
        )}

        {loading || (isSearching && searching) ? (
          <div className="space-y-1.5 px-1" aria-label="Loading pages">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        ) : isSearching ? (
          error !== null ? null : results.length === 0 ? (
            <div className="px-2 py-8 text-center">
              <Search className="mx-auto mb-2 size-4 text-muted-foreground" />
              <p className="text-xs font-medium">No matches</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Try a title, alias, path, or phrase from the note body.
              </p>
              <Button type="button" variant="ghost" size="xs" className="mt-2" onClick={onClearSearch}>
                Clear search
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5" aria-label="Search results" onKeyDown={handleSearchResultsKeyDown}>
              <p role="status" className="px-2 py-1 text-[11px] text-muted-foreground">{results.length === 50 ? 'Top 50 matches' : `${results.length} ${results.length === 1 ? 'match' : 'matches'}`}</p>
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
        ) : notes.length === 0 && folders.length === 0 ? (
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
              selectedFolderPath={selectedFolderPath}
              onSelectFolder={setSelectedFolderPath}
              onToggle={toggle}
              onOpen={onOpen}
              onCreateInFolder={onCreateInFolder}
              onCreateSubfolder={beginFolderCreate}
              onRenameFolder={(folder) => beginFolderEdit('rename', folder)}
              onMoveFolder={(folder) => beginFolderEdit('move', folder)}
              onDeleteFolder={(folder) => void beginFolderDelete(folder)}
              navigationLocked={navigationLocked || folderBusy || deleteFolderBusy}
              onRenameNote={onRenameNote}
              onDeleteNote={onDeleteNote}
              onActionAnnouncement={setActionAnnouncement}
            />
          </div>
        )}
        <span className="sr-only" aria-live="polite">{actionAnnouncement}</span>
      </div>

      <Dialog open={folderDialog !== null} onOpenChange={(open) => { if (!open && !folderBusy) { setFolderDialog(null); setFolderSubmitError(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{folderDialog?.kind === 'create' ? 'Create folder' : folderDialog?.kind === 'move' ? 'Move folder' : 'Rename folder'}</DialogTitle>
            <DialogDescription>Folders live in your vault. Moving a folder keeps note identities and contents intact.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium" htmlFor="folder-name">Folder name
              <Input id="folder-name" autoFocus value={folderName} disabled={folderBusy || navigationLocked} onChange={(event) => setFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitFolder(); } }} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">Parent folder
              <Select value={folderParent} disabled={folderBusy || navigationLocked} onValueChange={setFolderParent}>
                <SelectTrigger aria-label="Parent folder"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="__root__">Vault root</SelectItem>
                  {folders.filter((path) => folderDialog?.folder === null || folderDialog === null || (path !== folderDialog.folder.storagePath && !path.startsWith(`${folderDialog.folder.storagePath}/`)))
                    .map((path) => <SelectItem key={path} value={path}>{path === 'notes' ? 'Notes (default note folder)' : path}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>
          {folderSubmitError === null ? null : <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"><AlertCircle className="mt-0.5 size-3.5 shrink-0" /><span>{folderSubmitError}</span></div>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={folderBusy} onClick={() => setFolderDialog(null)}>Cancel</Button>
            <Button type="button" disabled={folderBusy || navigationLocked || folderName.trim() === ''} onClick={() => void submitFolder()}>{folderBusy ? 'Saving…' : folderDialog?.kind === 'create' ? 'Create folder' : folderDialog?.kind === 'move' ? 'Move folder' : 'Rename folder'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteFolder !== null} onOpenChange={(open) => { if (!open && !deleteFolderBusy) { setDeleteFolder(null); setDeleteImpact(null); setDeleteFolderError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this folder and its contents?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the folder and everything inside it from the local vault. This cannot be undone from Nodus.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <div className="font-medium break-all">{deleteFolder?.storagePath}</div>
            {deleteFolderBusy && deleteImpact === null ? <p role="status" className="mt-1 text-muted-foreground">Inspecting contents…</p> : deleteImpact ? <p className="mt-1 text-muted-foreground">Contains {deleteImpact.notes} {deleteImpact.notes === 1 ? 'note' : 'notes'}, {deleteImpact.files} other {deleteImpact.files === 1 ? 'file' : 'files'}, and {deleteImpact.folders} nested {deleteImpact.folders === 1 ? 'folder' : 'folders'}.</p> : null}
          </div>
          {deleteFolderError === null ? null : <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"><AlertCircle className="mt-0.5 size-3.5 shrink-0" /><span>{deleteFolderError}</span></div>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteFolderBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleteFolderBusy || deleteImpact === null || navigationLocked} onClick={(event) => { event.preventDefault(); void confirmFolderDelete(); }}>{deleteFolderBusy ? 'Deleting…' : 'Delete folder'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TreeLevel({
  root,
  depth,
  expanded,
  selectedId,
  selectedFolderPath,
  onSelectFolder,
  onToggle,
  onOpen,
  onCreateInFolder,
  onCreateSubfolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  navigationLocked,
  onRenameNote,
  onDeleteNote,
  onActionAnnouncement,
}: {
  root: FolderNode;
  depth: number;
  expanded: Set<string>;
  selectedId: string | null;
  selectedFolderPath: string | null;
  onSelectFolder: (path: string) => void;
  onToggle: (path: string) => void;
  onOpen: (id: string) => void;
  onCreateInFolder: (folder: string) => void;
  onCreateSubfolder: (parent?: string) => void;
  onRenameFolder: (folder: FolderNode) => void;
  onMoveFolder: (folder: FolderNode) => void;
  onDeleteFolder: (folder: FolderNode) => void;
  navigationLocked: boolean;
  onRenameNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onActionAnnouncement: (message: string) => void;
}) {
  const folders = [...root.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  const notes = [...root.notes].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <>
      {folders.map((folder) => {
        const open = expanded.has(folder.path);
        const noteCount = countNotes(folder);
        return (
          <div key={folder.path} role="none" className="group flex min-w-0 items-center rounded-[4px]">
            <Button
              type="button"
              variant="ghost"
              role="treeitem"
              aria-expanded={open}
              aria-current={folder.path === selectedFolderPath ? 'location' : undefined}
              aria-level={depth + 1}
              aria-label={`${folder.name}, ${noteCount} ${noteCount === 1 ? 'page' : 'pages'}`}
              className={cn(
                'h-7 min-w-0 flex-1 justify-start gap-1.5 rounded-[4px] pr-1 text-left text-[13px] font-normal text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                folder.path === selectedFolderPath && 'bg-success/8 font-medium text-sidebar-foreground',
              )}
              style={{ paddingLeft: `${6 + depth * 16}px` }}
              onClick={() => { onSelectFolder(folder.path); onToggle(folder.path); }}
              disabled={navigationLocked}
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
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" className="size-7 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100" aria-label={`Actions for ${folder.name}`} title={`Actions for ${folder.name}`} disabled={navigationLocked} onClick={(event) => event.stopPropagation()}><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-48">
                <DropdownMenuItem onSelect={() => onCreateInFolder(folder.storagePath)}><FilePlus />New note here</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onCreateSubfolder(folder.storagePath)}><FolderPlus />New subfolder</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onRenameFolder(folder)}><Pencil />Rename folder</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onMoveFolder(folder)}><Folder />Move folder</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onDeleteFolder(folder)}><Trash2 />Delete folder</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {open ? (
              <div role="group">
                <TreeLevel
                  root={folder}
                  depth={depth + 1}
                  expanded={expanded}
                  selectedId={selectedId}
                  selectedFolderPath={selectedFolderPath}
                  onSelectFolder={onSelectFolder}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  onCreateInFolder={onCreateInFolder}
                  onCreateSubfolder={onCreateSubfolder}
                  onRenameFolder={onRenameFolder}
                  onMoveFolder={onMoveFolder}
                  onDeleteFolder={onDeleteFolder}
                  navigationLocked={navigationLocked}
                  onRenameNote={onRenameNote}
                  onDeleteNote={onDeleteNote}
                  onActionAnnouncement={onActionAnnouncement}
                />
              </div>
            ) : null}
          </div>
        );
      })}

      {notes.map((note) => (
        <div key={note.id} role="none" className="group flex min-w-0 items-center rounded-[4px]">
          <Button
            type="button"
            variant="ghost"
            role="treeitem"
            aria-selected={note.id === selectedId}
            aria-level={depth + 1}
            className={cn(
              'h-7 min-w-0 flex-1 shrink justify-start gap-1.5 rounded-[4px] pr-1 text-left text-[13px] font-normal',
              'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              note.id === selectedId
                ? 'bg-success/12 font-medium text-sidebar-foreground'
                : 'text-sidebar-foreground/85',
            )}
            style={{ paddingLeft: `${6 + depth * 16 + 18}px` }}
            onClick={() => onOpen(note.id)}
            title={note.path}
          >
            <PageIcon icon={note.icon} className="size-4 shrink-0 text-[13px]" />
            <span className="truncate">{note.title}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                aria-label={`Actions for ${note.title}`}
                title={`Actions for ${note.title}`}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-48">
              <DropdownMenuItem onSelect={() => onRenameNote(note.id)}>
                <Pencil />
                Rename path
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (typeof navigator === 'undefined' || navigator.clipboard?.writeText === undefined) {
                    onActionAnnouncement('Clipboard access is unavailable.');
                    return;
                  }
                  void navigator.clipboard.writeText(note.path).then(
                    () => onActionAnnouncement(`Copied path for ${note.title}.`),
                    () => onActionAnnouncement('Could not copy note path.'),
                  );
                }}
              >
                <Copy />
                Copy relative path
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onDeleteNote(note.id)}>
                <Trash2 />
                Delete note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
    <Button
      variant="ghost"
      type="button"
      data-search-result="true"
      aria-label={`Open ${result.title}`}
      className={cn(
        'h-auto w-full items-stretch flex-col whitespace-normal rounded-[4px] px-2 py-1.5 text-left',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80',
        selected && 'bg-success/12 text-sidebar-foreground',
      )}
      onClick={() => onOpen(result.id)}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <PageIcon icon={result.icon} className="size-4 text-[13px]" />
        <span className="truncate text-[12.5px] font-medium">{result.title}</span>
      </span>
      <span className="block max-w-full truncate pl-[22px] text-[10px] text-muted-foreground">{result.path}</span>
      <span className="mt-0.5 line-clamp-2 pl-[22px] text-[11px] leading-snug text-muted-foreground">
        <SearchResultContext result={result} />
      </span>
    </Button>
  );
}
