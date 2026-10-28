import { useEffect, useRef, useState } from 'react';
import { PanelLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UiDiscoveryResponse } from '../../src/ui-server/dto';
import { api } from './api';

interface Props {
  revision: number;
  onOpenNote: (id: string) => void;
  onCreated: () => Promise<void>;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function DiscoveryView({ revision, onOpenNote, onCreated, sidebarCollapsed, onToggleSidebar }: Props) {
  const [data, setData] = useState<UiDiscoveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const request = useRef(0);
  const mounted = useRef(true);
  const createInFlight = useRef(false);

  async function load(refresh = false) {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.discovery(refresh);
      if (mounted.current && current === request.current) setData(result);
    } catch (error) {
      if (mounted.current && current === request.current) setError(messageOf(error));
    } finally {
      if (mounted.current && current === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; request.current++; };
  }, [revision]);

  async function create(target: string) {
    if (createInFlight.current) return;
    createInFlight.current = true;
    setCreating(true);
    setError(null);
    try {
      const { note } = await api.createLinkTarget(target);
      if (!mounted.current) return;
      await onCreated();
      if (mounted.current) onOpenNote(note.id);
    } catch (error) {
      if (mounted.current) { setError(messageOf(error)); await load(true); setError(messageOf(error)); }
    } finally {
      createInFlight.current = false;
      if (mounted.current) setCreating(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        {sidebarCollapsed ? <Button variant="ghost" size="icon-sm" aria-label="Expand sidebar" onClick={onToggleSidebar}><PanelLeft /></Button> : null}
        <h1 className="flex-1 text-sm font-medium">Knowledge discovery</h1>
        <Button variant="ghost" size="sm" onClick={() => void load(true)} disabled={loading || creating}><RefreshCw data-icon="inline-start" />Refresh from disk</Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-8" aria-busy={loading}>
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          <p className="text-sm text-muted-foreground">Follow unfinished ideas and rediscover notes outside your current trail. Results reflect saved Markdown; refresh to include external edits.</p>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {loading ? <p role="status" className="text-sm text-muted-foreground">Loading discovery…</p> : data ? <>
            <section aria-labelledby="unresolved-heading" className="flex flex-col gap-3">
              <h2 id="unresolved-heading" className="text-base font-semibold">Unresolved links ({data.unresolved.length})</h2>
              <p className="text-sm text-muted-foreground">Create the intended destination without changing the original link. Missing ID targets create a “Recovered note” with that ID.</p>
              {data.unresolved.length === 0 ? <p className="text-sm text-muted-foreground">All wiki-link targets exist.</p> : <ul className="flex flex-col divide-y">
                {data.unresolved.map((link) => <li key={`${link.sourceId}:${link.start}`} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="break-words font-medium">{link.raw}</span>
                    <Button variant="link" size="sm" className="h-auto justify-start self-start p-0" onClick={() => onOpenNote(link.sourceId)}>{link.sourceTitle}</Button>
                    <span className="break-all text-xs text-muted-foreground">{link.sourcePath} · line {link.line}</span>
                    <p className="break-words text-sm text-muted-foreground">{link.snippet}</p>
                  </div>
                  <Button variant="outline" size="sm" disabled={creating} onClick={() => void create(link.target)}>Create target<span className="sr-only"> {link.target}</span></Button>
                </li>)}
              </ul>}
            </section>
            {data.ambiguous.length > 0 ? <section aria-labelledby="ambiguous-heading" className="flex flex-col gap-3">
              <h2 id="ambiguous-heading" className="text-base font-semibold">Ambiguous links ({data.ambiguous.length})</h2>
              <p className="text-sm text-muted-foreground">Multiple notes match. Open the source and use an ID-pinned link to choose a destination.</p>
              <ul className="flex flex-col gap-2">{data.ambiguous.map((link) => <li key={`${link.sourceId}:${link.start}`}>
                <Button variant="link" className="h-auto max-w-full whitespace-normal text-left" onClick={() => onOpenNote(link.sourceId)}>{link.raw} in {link.sourceTitle} · {link.sourcePath}:{link.line}</Button>
              </li>)}</ul>
            </section> : null}
            <section aria-labelledby="orphans-heading" className="flex flex-col gap-3">
              <h2 id="orphans-heading" className="text-base font-semibold">Orphan notes ({data.orphans.length})</h2>
              <p className="text-sm text-muted-foreground">No other note has a confirmed wiki link to these notes. Self-links and ambiguous mentions do not count. These notes are valid; this is a way to discover and connect them.</p>
              {data.orphans.length === 0 ? <p className="text-sm text-muted-foreground">Every note has an incoming link.</p> : <ul className="flex flex-col divide-y">{data.orphans.map((note) => <li key={note.id} className="flex flex-col items-start gap-1 py-2">
                <Button variant="link" className="h-auto max-w-full whitespace-normal text-left" onClick={() => onOpenNote(note.id)}>{note.title}</Button>
                <span className="break-all px-2.5 text-xs text-muted-foreground">{note.path}</span>
              </li>)}</ul>}
            </section>
          </> : null}
        </div>
      </div>
    </div>
  );
}
function messageOf(error: unknown) { return error instanceof Error ? error.message : 'Could not load discovery.'; }
