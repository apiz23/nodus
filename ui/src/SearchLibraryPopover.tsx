import { useEffect, useState } from 'react';
import { Bookmark, Clock3, Play, Save, Trash2, X } from 'lucide-react';
import type { NoteFilter, NoteFilterLogic } from '../../src/search/note-filters.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { clearSearchHistory, readSearchPreferences, removeSearchDefinition, removeSearchHistory, saveSearchDefinition, type SearchDefinition, type SearchHistoryEntry } from './searchPersistence';

interface Props { vaultKey: string; query: string; filters: readonly NoteFilter[]; logic: NoteFilterLogic; searching: boolean; error: string | null; onRestore(query: string, filters: NoteFilter[], logic: NoteFilterLogic): void }
function storage() { try { return window.localStorage; } catch { return null; } }

export function SearchLibraryPopover({ vaultKey, query, filters, logic, searching, error, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [saved, setSaved] = useState<SearchDefinition[]>([]);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [loadedVault, setLoadedVault] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const reload = () => { const target = storage(); if (!target) { setSaved([]); setHistory([]); setLoadedVault(vaultKey); return; } const values = readSearchPreferences(target, vaultKey); setSaved(values.saved); setHistory(values.history); setLoadedVault(vaultKey); };
  useEffect(() => { reload(); }, [open, vaultKey]);
  const save = () => {
    if (searching || error) { setNotice('Wait for the current search to finish successfully before saving it.'); return; }
    if (!query.trim() && filters.length === 0) { setNotice('Enter a query or add a filter before saving.'); return; }
    const target = storage(); if (!target) { setNotice('Browser storage is unavailable.'); return; }
    const definition = saveSearchDefinition(target, vaultKey, name, query, filters, logic);
    if (!definition) { setNotice('Enter a unique name for this search.'); return; }
    setName(''); setNotice('Search saved.'); reload();
  };
  const rename = (definition: SearchDefinition) => {
    const target = storage(); if (!target) return;
    const updated = saveSearchDefinition(target, vaultKey, renameValue, definition.query, definition.filters, definition.logic, definition.id);
    if (!updated) { setNotice('That name is empty or already used.'); return; }
    setRenameId(null); setNotice('Saved search renamed.'); reload();
  };
  const restore = (entry: Pick<SearchDefinition, 'query' | 'filters' | 'logic'>) => { onRestore(entry.query, entry.filters, entry.logic); setOpen(false); };
  const removeDefinition = (id: string) => { const target = storage(); if (target && removeSearchDefinition(target, vaultKey, id)) { setNotice('Saved search deleted.'); reload(); } else setNotice('Could not update browser storage.'); };
  const removeHistory = (index: number) => { const target = storage(); if (target && removeSearchHistory(target, vaultKey, index)) { setNotice('Recent search removed.'); reload(); } else setNotice('Could not update browser storage.'); };
  const clearHistory = () => { const target = storage(); if (target && clearSearchHistory(target, vaultKey)) { setNotice('Recent search history cleared.'); reload(); } else setNotice('Could not update browser storage.'); };

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="Saved searches and search history"><Bookmark /></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-[min(390px,calc(100vw-24px))] space-y-3">
      <section aria-labelledby="saved-searches-heading" className="space-y-2">
        <div id="saved-searches-heading" className="flex items-center gap-2 text-sm font-medium"><Bookmark className="size-4" />Saved searches</div>
        <div className="flex gap-2"><Input aria-label="Saved search name" placeholder="Name this search" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } }} /><Button size="sm" onClick={save} disabled={!name.trim() || (!query.trim() && filters.length === 0) || searching || !!error}><Save />Save</Button></div>
        {loadedVault !== vaultKey || saved.length === 0 ? <p className="text-xs text-muted-foreground">Saved searches are stored in this browser for this vault.</p> : <ul className="max-h-40 space-y-1 overflow-y-auto">
          {saved.map((item) => <li key={item.id} className="rounded-md border p-2">
            {renameId === item.id ? <div className="flex gap-1"><Input aria-label={`Rename ${item.name}`} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') rename(item); if (event.key === 'Escape') setRenameId(null); }} /><Button size="icon-sm" aria-label="Save name" onClick={() => rename(item)}><Save /></Button><Button size="icon-sm" variant="ghost" aria-label="Cancel rename" onClick={() => setRenameId(null)}><X /></Button></div> : <>
              <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{item.name}</span><div className="flex shrink-0 gap-1"><Button size="icon-sm" variant="ghost" aria-label={`Run ${item.name}`} onClick={() => restore(item)}><Play /></Button><Button size="icon-sm" variant="ghost" aria-label={`Rename ${item.name}`} onClick={() => { setRenameId(item.id); setRenameValue(item.name); }}><span className="text-xs">Rename</span></Button><Button size="icon-sm" variant="ghost" aria-label={`Update ${item.name} with current search`} disabled={searching || !!error} onClick={() => { const target = storage(); const updated = target && saveSearchDefinition(target, vaultKey, item.name, query, filters, logic, item.id); if (updated) { setNotice('Saved search updated.'); reload(); } else setNotice('Could not update saved search.'); }}><Save /></Button><Button size="icon-sm" variant="ghost" aria-label={`Delete ${item.name}`} onClick={() => removeDefinition(item.id)}><Trash2 /></Button></div></div>
              <p className="truncate text-xs text-muted-foreground">{item.query || 'Filters only'}{item.filters.length ? ` · ${item.filters.length} filter(s)` : ''}</p>
            </>}
          </li>)}
        </ul>}
      </section>
      <section aria-labelledby="search-history-heading" className="space-y-2 border-t pt-3">
        <div className="flex items-center justify-between"><div id="search-history-heading" className="flex items-center gap-2 text-sm font-medium"><Clock3 className="size-4" />Recent searches</div>{history.length ? <Button variant="ghost" size="xs" onClick={() => setConfirmClear(true)}>Clear</Button> : null}</div>
        {confirmClear ? <div role="group" aria-label="Confirm clear search history" className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 p-2 text-xs"><span>Clear all recent searches?</span><Button size="xs" variant="outline" onClick={() => setConfirmClear(false)}>Cancel</Button><Button size="xs" variant="destructive" onClick={() => { clearHistory(); setConfirmClear(false); }}>Clear history</Button></div> : null}
        {loadedVault !== vaultKey || history.length === 0 ? <p className="text-xs text-muted-foreground">Completed searches appear here.</p> : <ul className="max-h-40 space-y-1 overflow-y-auto">{history.map((item, index) => <li key={`${item.searchedAt}-${index}`} className="flex items-center gap-1"><Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start truncate text-left" onClick={() => restore(item)}>{item.query || `Filters only (${item.filters.length})`}</Button><Button variant="ghost" size="icon-xs" aria-label={`Remove recent search ${item.query}`} onClick={() => removeHistory(index)}><X /></Button></li>)}</ul>}
      </section>
      {notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
    </PopoverContent>
  </Popover>;
}
