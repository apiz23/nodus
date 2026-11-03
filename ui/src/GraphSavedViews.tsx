import { useEffect, useRef, useState } from 'react';
import { Bookmark, Download, MoreHorizontal, Pencil, Plus, Save, Trash2, Upload } from 'lucide-react';
import type { GraphViewImportStrategy, GraphViewReferenceSets, SavedGraphView, SavedGraphViewConfig } from './graph-saved-views';
import { createSavedGraphView, loadSavedGraphViews, mergeImportedGraphViews, parseGraphViewsImport, sanitizeGraphViewReferences, serializeGraphViewsExport, updateSavedGraphView, validateGraphViewReferences, writeSavedGraphViews } from './graph-saved-views';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const NONE = '__none__';

interface Props {
  vaultKey: string;
  references: GraphViewReferenceSets;
  captureConfig: () => SavedGraphViewConfig;
  onApply: (config: SavedGraphViewConfig) => void;
}

type DialogState = { type: 'create' | 'rename'; viewId?: string } | null;

export function GraphSavedViews({ vaultKey, references, captureConfig, onApply }: Props) {
  const [views, setViews] = useState<SavedGraphView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<GraphViewImportStrategy>('rename');
  const [importPreview, setImportPreview] = useState<{ fileName: string; views: SavedGraphView[]; issues: string[]; referenceIssues: Array<{ name: string; issues: string[] }> } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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

  function exportViews() {
    if (views.length === 0) { setError('There are no saved graph views to export.'); return; }
    const blob = new Blob([serializeGraphViewsExport(views)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'nodus-graph-views.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(`Exported ${views.length} ${views.length === 1 ? 'view' : 'views'}.`);
    setError(null);
  }

  async function readImport(file: File) {
    const parsed = parseGraphViewsImport(await file.text());
    const referenceIssues = parsed.views.map((view) => ({ name: view.name, issues: validateGraphViewReferences(view, references) })).filter((item) => item.issues.length > 0);
    setImportPreview({ fileName: file.name, views: parsed.views, issues: parsed.issues, referenceIssues });
    setStrategy('rename');
    setError(null);
    setNotice(null);
  }

  function applyImport() {
    if (importPreview === null) return;
    const sanitized = importPreview.views.map((view) => sanitizeGraphViewReferences(view, references));
    const merged = mergeImportedGraphViews(views, sanitized, strategy);
    persist(merged.views);
    setNotice(`Imported ${merged.added + merged.replaced + merged.renamed} ${merged.added + merged.replaced + merged.renamed === 1 ? 'view' : 'views'} (${merged.added} added, ${merged.replaced} replaced, ${merged.renamed} renamed, ${merged.skipped} skipped).`);
    setImportPreview(null);
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
      <Button variant="ghost" size="sm" onClick={exportViews} aria-label="Export saved graph views"><Download />Export</Button>
      <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()} aria-label="Import saved graph views"><Upload />Import</Button>
      <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" aria-label="Choose graph views JSON file" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file !== undefined) void readImport(file); }} />
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
      {notice ? <span role="status" className="w-full text-xs text-muted-foreground">{notice}</span> : null}

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

      <Dialog open={importPreview !== null} onOpenChange={(open) => { if (!open) setImportPreview(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import graph views</DialogTitle>
            <DialogDescription>{importPreview?.fileName}: {importPreview?.views.length ?? 0} valid {(importPreview?.views.length ?? 0) === 1 ? 'view' : 'views'}. References are checked against this vault before applying.</DialogDescription>
          </DialogHeader>
          {importPreview && importPreview.issues.length > 0 ? <div role="alert" className="border border-destructive/25 bg-destructive/5 p-2 text-xs text-destructive"><p className="font-medium">Some records were ignored</p><ul className="mt-1 list-disc pl-4">{importPreview.issues.slice(0, 6).map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
          {importPreview && importPreview.views.length > 0 ? <ul className="max-h-52 overflow-auto border-y">{importPreview.views.map((view) => <li key={view.id} className="flex items-start justify-between gap-3 border-b px-2 py-1.5 text-xs last:border-b-0"><span className="min-w-0 flex-1 truncate">{view.name}</span><span className="shrink-0 text-muted-foreground">{view.config.renderLimit} nodes</span></li>)}</ul> : null}
          {importPreview && importPreview.referenceIssues.length > 0 ? <div className="text-xs text-muted-foreground"><p className="font-medium text-foreground">References not present in this vault</p><p className="mt-1">Invalid folder, cluster, focus, or selected-note references will be cleared on import.</p><ul className="mt-1 list-disc pl-4">{importPreview.referenceIssues.slice(0, 6).map((item) => <li key={item.name}>{item.name}: {item.issues.join(' ')}</li>)}</ul></div> : null}
          <label className="grid gap-1 text-sm">Conflict strategy
            <Select value={strategy} onValueChange={(value) => setStrategy(value as GraphViewImportStrategy)}>
              <SelectTrigger aria-label="Graph view conflict strategy"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rename">Rename duplicates</SelectItem>
                <SelectItem value="skip">Skip duplicates</SelectItem>
                <SelectItem value="replace">Replace duplicates</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportPreview(null)}>Cancel</Button>
            <Button disabled={!importPreview || importPreview.views.length === 0} onClick={applyImport}>Apply import</Button>
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
