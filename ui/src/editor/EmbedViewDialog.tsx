import { useEffect, useMemo, useReducer, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { serializeNodusViewDirective } from '@/embeds/nodusView';
import {
  embedPickerReducer,
  INITIAL_EMBED_PICKER_STATE,
  pickerCanInsert,
  pickerDatabasesPlaceholder,
  pickerHint,
  pickerViewPlaceholder,
} from './embedPickerState';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (body: string) => boolean;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Insertion surface for `nodus-view` embeds. It only writes a fenced block into
 * the note; the database and view stay external.
 */
export function EmbedViewDialog({ open, onOpenChange, onInsert }: Props) {
  const [state, dispatch] = useReducer(embedPickerReducer, INITIAL_EMBED_PICKER_STATE);
  const [attempt, setAttempt] = useState(0);
  const [insertError, setInsertError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    dispatch({ type: 'reset' });
    setInsertError(null);
    let active = true;
    dispatch({ type: 'databases-loading' });
    api.databases()
      .then((result) => {
        if (!active) return;
        dispatch({ type: 'databases-loaded', databases: result.databases.map((database) => ({ id: database.id, name: database.name })) });
      })
      .catch((reason) => { if (active) dispatch({ type: 'databases-failed', message: messageOf(reason) }); });
    return () => { active = false; };
  }, [open, attempt]);

  useEffect(() => {
    if (!open || state.databaseId === '') return;
    let active = true;
    dispatch({ type: 'views-loading' });
    api.databaseViews(state.databaseId)
      .then((result) => {
        if (!active) return;
        dispatch({ type: 'views-loaded', views: result.views.map((entry) => ({ id: entry.view.id, name: entry.view.name })) });
      })
      .catch((reason) => { if (active) dispatch({ type: 'views-failed', message: messageOf(reason) }); });
    return () => { active = false; };
  }, [open, state.databaseId, attempt]);

  const directive = useMemo(() => {
    if (!pickerCanInsert(state)) return '';
    return serializeNodusViewDirective({ databaseId: state.databaseId, viewId: state.viewId, height: 320 });
  }, [state]);

  const hint = insertError ?? pickerHint(state);
  const loading = state.databaseStatus === 'loading' || state.viewStatus === 'loading';
  const isError = insertError !== null || state.databaseStatus === 'error' || state.viewStatus === 'error';

  function insert(): void {
    if (directive === '') return;
    if (onInsert(directive)) onOpenChange(false);
    else setInsertError('This position is inside a code block or table. Move the cursor and try again.');
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
          {hint === null ? null : <p role={isError ? 'alert' : undefined} className={`rounded-md border px-2 py-1.5 text-xs ${isError ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'bg-muted/40 text-muted-foreground'}`}>{hint}</p>}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Database</span>
            <Select
              value={state.databaseId}
              onValueChange={(value) => { setInsertError(null); dispatch({ type: 'select-database', databaseId: value }); }}
              disabled={loading || state.databases.length === 0}
            >
              <SelectTrigger aria-label="Database to embed"><SelectValue placeholder={pickerDatabasesPlaceholder(state)} /></SelectTrigger>
              <SelectContent>
                {state.databases.map((database) => <SelectItem key={database.id} value={database.id}>{database.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Saved view</span>
            <Select
              value={state.viewId}
              onValueChange={(value) => { setInsertError(null); dispatch({ type: 'select-view', viewId: value }); }}
              disabled={state.viewStatus !== 'ready' || state.views.length === 0}
            >
              <SelectTrigger aria-label="Saved view to embed"><SelectValue placeholder={pickerViewPlaceholder(state)} /></SelectTrigger>
              <SelectContent>
                {state.views.map((view) => <SelectItem key={view.id} value={view.id}>{view.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {state.databaseStatus === 'error' || state.viewStatus === 'error' ? (
            <Button type="button" variant="outline" size="xs" className="self-start" onClick={() => setAttempt((value) => value + 1)}>
              <RefreshCw className="size-3" aria-hidden="true" />Retry
            </Button>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Will insert</span>
            <pre className="overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px]">{directive === '' ? '```nodus-view\n…\n```' : `\`\`\`nodus-view\n${directive}\n\`\`\``}</pre>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={insert} disabled={directive === ''}>{loading ? <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" /> : null}Insert view</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
