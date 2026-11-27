import { useEffect, useMemo, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { serializeNodusViewDirective } from '@/embeds/nodusView';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (body: string) => boolean;
}

/**
 * Insertion surface for `nodus-view` embeds. It only writes a fenced block into
 * the note; the database and view stay external.
 */
export function EmbedViewDialog({ open, onOpenChange, onInsert }: Props) {
  const [databases, setDatabases] = useState<Array<{ id: string; name: string }>>([]);
  const [databaseId, setDatabaseId] = useState('');
  const [views, setViews] = useState<Array<{ id: string; name: string }>>([]);
  const [viewId, setViewId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    api.databases()
      .then((result) => {
        if (!active) return;
        setDatabases(result.databases.map((database) => ({ id: database.id, name: database.name })));
        setDatabaseId((current) => current !== '' && result.databases.some((database) => database.id === current) ? current : result.databases[0]?.id ?? '');
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open || databaseId === '') { setViews([]); setViewId(''); return; }
    let active = true;
    setLoading(true);
    setError(null);
    api.databaseViews(databaseId)
      .then((result) => {
        if (!active) return;
        setViews(result.views.map((entry) => ({ id: entry.view.id, name: entry.view.name })));
        setViewId((current) => current !== '' && result.views.some((entry) => entry.view.id === current) ? current : result.views[0]?.view.id ?? '');
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, databaseId]);

  const directive = useMemo(() => databaseId === '' || viewId === '' ? '' : serializeNodusViewDirective({ databaseId, viewId, height: 320 }), [databaseId, viewId]);

  function insert(): void {
    if (directive === '') return;
    if (onInsert(directive)) onOpenChange(false);
    else setError('This position is inside a code block or table. Move the cursor and try again.');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Database className="size-4" aria-hidden="true" />Embed a database view</DialogTitle>
          <DialogDescription>
            Inserts a <code className="rounded bg-muted px-1">nodus-view</code> fence. Rows stay in their database; the note only references the saved view.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {error === null ? null : <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">{error}</p>}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Database</span>
            <Select value={databaseId} onValueChange={(value) => { setDatabaseId(value); setViews([]); setViewId(''); setError(null); }} disabled={loading || databases.length === 0}>
              <SelectTrigger aria-label="Database to embed"><SelectValue placeholder={databases.length === 0 ? 'No databases in this vault' : 'Choose a database'} /></SelectTrigger>
              <SelectContent>
                {databases.map((database) => <SelectItem key={database.id} value={database.id}>{database.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Saved view</span>
            <Select value={viewId} onValueChange={setViewId} disabled={loading || views.length === 0}>
              <SelectTrigger aria-label="Saved view to embed"><SelectValue placeholder={views.length === 0 ? 'This database has no saved view' : 'Choose a view'} /></SelectTrigger>
              <SelectContent>
                {views.map((view) => <SelectItem key={view.id} value={view.id}>{view.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {databases.length === 0 && !loading ? <p className="text-xs text-muted-foreground">Create a database and save a view first, then embed it here.</p> : null}
          {databaseId !== '' && views.length === 0 && !loading ? <p className="text-xs text-muted-foreground">Save a view on this database before embedding it.</p> : null}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Will insert</span>
            <pre className="overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px]">{directive === '' ? '```nodus-view\n…\n```' : `\`\`\`nodus-view\n${directive}\n\`\`\``}</pre>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={insert} disabled={directive === '' || loading}>{loading ? <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" /> : null}Insert view</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
