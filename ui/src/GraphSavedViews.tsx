import { useEffect, useState } from 'react';
import { Bookmark, MoreHorizontal, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import type { SavedGraphView, SavedGraphViewConfig } from './graph-saved-views';
import { createSavedGraphView, loadSavedGraphViews, updateSavedGraphView, writeSavedGraphViews } from './graph-saved-views';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const NONE = '__none__';

interface Props {
  vaultKey: string;
  captureConfig: () => SavedGraphViewConfig;
  onApply: (config: SavedGraphViewConfig) => void;
}

type DialogState = { type: 'create' | 'rename'; viewId?: string } | null;

export function GraphSavedViews({ vaultKey, captureConfig, onApply }: Props) {
  const [views, setViews] = useState<SavedGraphView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadSavedGraphViews(window.localStorage, vaultKey);
    setViews(stored);
    setSelectedId(null);
  }, [vaultKey]);

  const selected = views.find((view) => view.id === selectedId) ?? null;

  function persist(next: SavedGraphView[]) {
    try {
      writeSavedGraphViews(window.localStorage, vaultKey, next);
      setViews(next.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)));
      setError(null);
    } catch {
      setError('Saved graph views could not be stored in this browser.');
    }
  }

  function openCreate() {
    setName(`Graph view ${views.length + 1}`);
    setDialog({ type: 'create' });
    setError(null);
  }

  function openRename() {
    if (selected === null) return;
    setName(selected.name);
    setDialog({ type: 'rename', viewId: selected.id });
    setError(null);
  }

  function submitDialog() {
    if (dialog === null) return;
    try {
      if (dialog.type === 'create') {
        const created = createSavedGraphView(name, captureConfig());
        persist([...views, created]);
        setSelectedId(created.id);
      } else {
        const current = views.find((view) => view.id === dialog.viewId);
        if (current === undefined) return;
        const renamed = updateSavedGraphView(current, { name });
        persist(views.map((view) => view.id === renamed.id ? renamed : view));
      }
      setDialog(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The graph view could not be saved.');
    }
  }

  function applyView(id: string) {
    if (id === NONE) { setSelectedId(null); return; }
    const view = views.find((candidate) => candidate.id === id);
    if (view === undefined) return;
    setSelectedId(view.id);
    onApply(view.config);
    setError(null);
  }

  function updateSelected() {
    if (selected === null) return;
    const updated = updateSavedGraphView(selected, { config: captureConfig() });
    persist(views.map((view) => view.id === updated.id ? updated : view));
  }

  function deleteSelected() {
    if (selected === null) return;
    persist(views.filter((view) => view.id !== selected.id));
    setSelectedId(null);
    setDeleteOpen(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Saved graph views">
      <Bookmark className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <Select value={selectedId ?? NONE} onValueChange={applyView}>
        <SelectTrigger className="w-44" aria-label="Saved graph view">
          <SelectValue placeholder="Saved views" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No saved view</SelectItem>
          {views.map((view) => <SelectItem key={view.id} value={view.id}>{view.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={openCreate} aria-label="Save current graph view"><Plus />Save</Button>
      {selected !== null ? (
        <>
          <Button variant="ghost" size="sm" onClick={updateSelected} aria-label="Update selected graph view"><Save />Update</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Saved view actions"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={openRename}><Pencil />Rename</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}><Trash2 />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
      {error ? <span role="alert" className="w-full text-xs text-destructive">{error}</span> : null}

      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.type === 'rename' ? 'Rename graph view' : 'Save graph view'}</DialogTitle>
            <DialogDescription>Saved views store filters, cluster, focus, display settings, and path traversal mode for this vault only.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-sm">Name<Input autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitDialog(); } }} /></label>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={submitDialog}>{dialog?.type === 'rename' ? 'Rename' : 'Save view'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this saved graph view?</AlertDialogTitle>
            <AlertDialogDescription>Only the saved browser view is removed. Notes and links are unchanged.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteSelected}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
