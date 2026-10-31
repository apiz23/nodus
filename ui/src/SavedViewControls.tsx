import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { diagnoseDatabaseView, serializeDatabaseView, type DatabaseView, type DatabaseViewType } from '../../src/database/database-view';
import type { UiDatabase, UiDatabaseView } from '../../src/ui-server/dto';
import { ApiError, api } from './api';

import { defaultView, type ViewConfiguration } from './database-view-layout';
const NO_VIEW = '__unsaved__';


export function SavedViewControls({ database, vaultKey, configuration, onApply, onReady, busy, hasNoteDraft }: {
  database: UiDatabase;
  vaultKey: string;
  configuration: ViewConfiguration;
  onApply: (view: DatabaseView | null) => void;
  onReady: () => void;
  busy: boolean;
  hasNoteDraft: boolean;
}) {
  const [views, setViews] = useState<UiDatabaseView[]>([]);
  const [active, setActive] = useState<UiDatabaseView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [dialog, setDialog] = useState<'create' | 'rename' | 'duplicate' | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<DatabaseViewType>('table');
  const [confirm, setConfirm] = useState<'delete' | 'reload' | 'reset' | { switchTo: string } | null>(null);
  const alive = useRef(true);
  const loadGeneration = useRef(0);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const confirmationTrigger = useRef<HTMLElement | null>(null);
  const selectorRef = useRef<HTMLButtonElement | null>(null);
  const applyRef = useRef(onApply);
  applyRef.current = onApply;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const preferenceKey = JSON.stringify(['nodus.savedView', vaultKey, database.id]);
  const disabled = busy || saving || loading;
  const writeDisabled = disabled || hasNoteDraft;
  const normalized = (view: ViewConfiguration) => JSON.stringify({ type: view.type ?? 'table', settings: view.settings ?? {}, sort: view.sort, sorts: view.sorts, filters: view.filters, visiblePropertyIds: view.visiblePropertyIds });
  const dirty = normalized(active?.view ?? defaultView(database)) !== normalized(configuration);

  function apply(saved: UiDatabaseView | null) {
    setActive(saved); setStale(false); setError(null); setNotice(null);
    applyRef.current(saved?.view ?? null);
    try { localStorage.setItem(preferenceKey, saved?.view.id ?? ''); } catch { /* Preference storage is optional. */ }
  }

  async function load() {
    const generation = ++loadGeneration.current;
    const current = () => alive.current && generation === loadGeneration.current;
    setLoading(true); setError(null);
    try {
      const result = await api.databaseViews(database.id);
      if (!current()) return;
      setViews(result.views);
      let preferred: string | null = null;
      try { preferred = localStorage.getItem(preferenceKey); } catch { /* Optional preference. */ }
      apply(preferred === '' ? null : result.views.find((item) => item.view.id === preferred) ?? result.views[0] ?? null);
    } catch (cause) { if (current()) setError(message(cause)); }
    finally { if (current()) { setLoading(false); readyRef.current(); } }
  }

  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; loadGeneration.current += 1; };
  }, []); // The parent keys this component by vault and database identity.

  function switchTo(id: string) {
    const saved = views.find((item) => item.view.id === id) ?? null;
    apply(saved);
  }

  async function write(mode: 'save' | 'create' | 'rename' | 'duplicate') {
    if (writeDisabled || stale) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      let result: { view: UiDatabaseView };
      if (mode === 'duplicate') {
        if (!active) return;
        result = await api.duplicateDatabaseView(database.id, active.view.id, crypto.randomUUID(), name.trim(), active.contentHash);
      } else {
        const draft: DatabaseView = {
          id: active?.view.id ?? crypto.randomUUID(), databaseId: database.id,
          name: mode === 'save' ? active?.view.name ?? '' : name.trim(),
          ...(mode === 'create' ? defaultView(database, type) : configuration),
        };
        if (mode === 'create') draft.id = crypto.randomUUID();
        serializeDatabaseView(draft);
        const issues = diagnoseDatabaseView(draft, database);
        if (issues.length) throw new Error(issues.map((issue) => issue.message).join(' '));
        result = mode === 'create' ? await api.createDatabaseView(draft) : await api.replaceDatabaseView(draft, active?.contentHash ?? '');
      }
      if (!alive.current) return;
      setViews((previous) => [...previous.filter((item) => item.view.id !== result.view.view.id), result.view]);
      apply(result.view); setDialog(null); setNotice('View saved to this vault.');
    } catch (cause) {
      if (!alive.current) return;
      setError(message(cause));
      if (cause instanceof ApiError && cause.code === 'STALE_WRITE') setStale(true);
    } finally { if (alive.current) setSaving(false); }
  }

  async function confirmAction() {
    const action = confirm;
    setConfirm(null);
    if (typeof action === 'object' && action !== null) { switchTo(action.switchTo); return; }
    if (action === 'reset') {
      onApply({ ...(active?.view ?? { id: '', databaseId: database.id, name: '' }), ...defaultView(database, configuration.type ?? 'table') });
      return;
    }
    if (!active || disabled) return;
    setSaving(true); setError(null);
    try {
      if (action === 'reload') {
        const result = await api.databaseView(database.id, active.view.id);
        if (alive.current) {
          setViews((previous) => previous.map((item) => item.view.id === result.view.view.id ? result.view : item));
          apply(result.view);
        }
      } else if (action === 'delete') {
        await api.deleteDatabaseView(database.id, active.view.id, active.contentHash);
        if (alive.current) { setViews((previous) => previous.filter((item) => item.view.id !== active.view.id)); apply(null); setNotice('View deleted. Notes were kept.'); }
      }
    } catch (cause) { if (alive.current) { setError(message(cause)); if (cause instanceof ApiError && cause.code === 'STALE_WRITE') setStale(true); } }
    finally { if (alive.current) setSaving(false); }
  }

  function openDialog(mode: 'create' | 'rename' | 'duplicate') {
    dialogTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setName(mode === 'create' ? 'New view' : mode === 'duplicate' ? `${active?.view.name ?? 'View'} copy` : active?.view.name ?? '');
    setType('table'); setError(null); setDialog(mode);
  }

  function askConfirmation(action: NonNullable<typeof confirm>) {
    confirmationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirm(action);
  }

  return <section aria-label="Saved database views" className="my-3 flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
        <label className="shrink-0 text-xs" htmlFor={`saved-view-${database.id}`}>View</label>
        <Select
          value={active?.view.id ?? NO_VIEW}
          disabled={disabled}
          onValueChange={(value) => {
            const id = value === NO_VIEW ? '' : value;
            if (dirty || hasNoteDraft) askConfirmation({ switchTo: id }); else switchTo(id);
          }}
        >
          <SelectTrigger ref={selectorRef} id={`saved-view-${database.id}`} className="min-w-0 flex-1 sm:w-56 sm:flex-none" aria-label="View" title={active?.view.name ?? "Unsaved table"}>
            <SelectValue placeholder="Unsaved table" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_VIEW}>Unsaved table</SelectItem>
            {views.map((item) => (
              <SelectItem key={item.view.id} value={item.view.id}>
                {item.view.name} · {item.view.type ?? 'table'} · {item.view.id.slice(0, 8)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button size="sm" variant="outline" disabled={writeDisabled} onClick={() => openDialog('create')}>New view</Button>
      {active ? <>
        <Button size="sm" disabled={writeDisabled || stale || !dirty} onClick={() => void write('save')}>{saving ? 'Saving…' : 'Save view'}</Button>
      </> : null}
    </div>
    {active ? <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <Button size="sm" variant="ghost" disabled={writeDisabled || stale} onClick={() => openDialog('rename')}>Rename view</Button>
      <Button size="sm" variant="ghost" disabled={writeDisabled || stale} onClick={() => openDialog('duplicate')}>Duplicate view</Button>
      <Button size="sm" variant="ghost" disabled={writeDisabled || stale} onClick={() => askConfirmation('delete')}>Delete view</Button>
      <Button size="sm" variant="ghost" disabled={writeDisabled} onClick={() => askConfirmation('reload')}>Reload saved view</Button>
      <Button size="sm" variant="ghost" disabled={writeDisabled} onClick={() => askConfirmation('reset')}>Reset view settings</Button>
    </div> : null}
    {loading ? <p role="status" className="text-xs text-muted-foreground">Loading saved views…</p> : null}
    {dirty ? <p role="status" className="text-xs text-muted-foreground">View settings have unsaved changes.</p> : null}
    {notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
    {error ? <div role="alert" className="text-xs text-destructive">{error}{stale ? ' Your settings are still here. Reload the saved view before making another write.' : ''}{loading === false && active === null ? <Button variant="link" size="sm" onClick={() => void load()}>Retry loading views</Button> : null}</div> : null}
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open && !saving) setDialog(null); }}>
      <DialogContent showCloseButton={!saving} onCloseAutoFocus={(event) => { event.preventDefault(); if (dialogTrigger.current?.isConnected) dialogTrigger.current.focus(); else selectorRef.current?.focus(); }} onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{dialog === 'create' ? 'Create saved view' : dialog === 'rename' ? 'Rename saved view' : 'Duplicate saved view'}</DialogTitle>
          <DialogDescription>{dialog === 'duplicate' ? 'Copies the last saved settings into a new file. Unsaved settings are not copied.' : 'View configuration is stored as portable JSON. Note contents are not changed.'}</DialogDescription></DialogHeader>
        <label className="flex flex-col gap-1 text-xs">View name<Input autoFocus value={name} disabled={saving} onChange={(event) => setName(event.currentTarget.value)} /></label>
        {dialog === 'create' ? <div className="flex flex-col gap-1 text-xs">
          <span>View type</span>
          <Select value={type} disabled={saving} onValueChange={(value) => setType(value as DatabaseViewType)}>
            <SelectTrigger className="w-full" aria-label="View type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="table">Table</SelectItem>
              <SelectItem value="list">List</SelectItem>
              <SelectItem value="kanban" disabled={!database.properties.some((property) => property.type === 'select')}>Kanban (Select property)</SelectItem>
              <SelectItem value="calendar" disabled={!database.properties.some((property) => property.type === 'date')}>Calendar (Date property)</SelectItem>
            </SelectContent>
          </Select>
        </div> : null}
        {dialog === 'rename' && dirty ? <p className="text-xs text-muted-foreground">Renaming also saves your current view settings.</p> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setDialog(null)}>Cancel</Button><Button disabled={saving || stale || !name.trim()} onClick={() => { if (dialog) void write(dialog); }}>{saving ? 'Saving…' : dialog === 'create' ? 'Create view' : dialog === 'rename' ? 'Rename and save' : 'Create duplicate'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}><AlertDialogContent onCloseAutoFocus={(event) => { event.preventDefault(); if (confirmationTrigger.current?.isConnected) confirmationTrigger.current.focus(); else selectorRef.current?.focus(); }}>
      <AlertDialogHeader><AlertDialogTitle>{confirm === 'delete' ? 'Delete this saved view?' : 'Replace current view settings?'}</AlertDialogTitle><AlertDialogDescription>{confirm === 'delete' ? 'Only the saved-view file is removed. Notes and schemas are kept.' : 'Current view settings and any property-edit draft will be discarded. Stored note values are kept.'}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void confirmAction()}>{confirm === 'delete' ? 'Delete view' : 'Continue'}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </section>;
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : 'The saved-view operation failed.'; }
