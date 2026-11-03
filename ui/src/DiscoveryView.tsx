import { useEffect, useRef, useState } from 'react';
import { PanelLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UiAmbiguousLink, UiDiscoveryResponse, UiLinkSuggestion, UiUnresolvedLink } from '../../src/ui-server/dto';
import { api } from './api';

interface Props {
  revision: number;
  onOpenNote: (id: string) => void;
  onCreated: () => Promise<void>;
  /** Refresh vault-wide derived state after an explicit link rewrite. */
  onRepaired?: (noteId: string) => Promise<void>;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

type BrokenLink = UiUnresolvedLink | UiAmbiguousLink;

export function DiscoveryView({ revision, onOpenNote, onCreated, onRepaired, sidebarCollapsed, onToggleSidebar }: Props) {
  const [data, setData] = useState<UiDiscoveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [repairing, setRepairing] = useState<string | null>(null);
  const request = useRef(0);
  const mounted = useRef(true);
  const createInFlight = useRef(false);
  const repairInFlight = useRef(false);
  const busy = creating || repairing !== null;

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
    setNotice(null);
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

  async function repair(link: BrokenLink, suggestion: UiLinkSuggestion) {
    if (repairInFlight.current) return;
    repairInFlight.current = true;
    setRepairing(`${link.sourceId}:${link.start}`);
    setError(null);
    setNotice(null);
    try {
      // Discovery intentionally does not expose source hashes; re-read the
      // source immediately before the revision-checked rewrite.
      const { note } = await api.note(link.sourceId);
      const result = await api.repairWikiLink(link.sourceId, {
        baseHash: note.contentHash,
        start: link.start,
        end: link.end,
        target: link.target,
        replacementNoteId: suggestion.noteId,
        ...(link.display === undefined ? {} : { display: link.display }),
      });
      if (!mounted.current) return;
      setNotice(result.changed
        ? `Linked ${link.target} to ${suggestion.title}. Later renames stay safe because the link uses a stable ID.`
        : `The link already points to ${suggestion.title}.`);
      await load(true);
      if (onRepaired !== undefined) await onRepaired(link.sourceId);
    } catch (error) {
      if (mounted.current) {
        const message = messageOf(error);
        setError(message);
        await load(true);
        if (mounted.current) setError(message);
      }
    } finally {
      repairInFlight.current = false;
      if (mounted.current) setRepairing(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        {sidebarCollapsed ? <Button variant="ghost" size="icon-sm" aria-label="Expand sidebar" onClick={onToggleSidebar}><PanelLeft /></Button> : null}
        <h1 className="flex-1 text-sm font-medium">Knowledge discovery</h1>
        <Button variant="ghost" size="sm" onClick={() => void load(true)} disabled={loading || busy}><RefreshCw data-icon="inline-start" />Refresh from disk</Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-8" aria-busy={loading}>
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          <p className="text-sm text-muted-foreground">Follow unfinished ideas and rediscover notes outside your current trail. Broken links can be repaired to a similar note; the rewrite is pinned to that note's stable ID so later renames keep working. Results reflect saved Markdown; refresh to include external edits.</p>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
          {loading ? <p role="status" className="text-sm text-muted-foreground">Loading discovery…</p> : data ? <>
            <section aria-labelledby="unresolved-heading" className="flex flex-col gap-3">
              <h2 id="unresolved-heading" className="text-base font-semibold">Unresolved links ({data.unresolved.length})</h2>
              <p className="text-sm text-muted-foreground">Create the intended destination without changing the original link, or link to an existing note with a similar title or path. Missing ID targets create a “Recovered note” with that ID.</p>
              {data.unresolved.length === 0 ? <p className="text-sm text-muted-foreground">All wiki-link targets exist.</p> : <ul className="flex flex-col divide-y">
                {data.unresolved.map((link) => <li key={`${link.sourceId}:${link.start}`} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="break-words font-medium">{link.raw}</span>
                    <Button variant="link" size="sm" className="h-auto justify-start self-start p-0" onClick={() => onOpenNote(link.sourceId)}>{link.sourceTitle}</Button>
                    <span className="break-all text-xs text-muted-foreground">{link.sourcePath} · line {link.line}</span>
                    <p className="break-words text-sm text-muted-foreground">{link.snippet}</p>
                    <SuggestionList
                      link={link}
                      suggestions={link.suggestions}
                      busy={busy}
                      repairingKey={repairing}
                      onRepair={(suggestion) => void repair(link, suggestion)}
                    />
                  </div>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void create(link.target)}>Create target<span className="sr-only"> {link.target}</span></Button>
                </li>)}
              </ul>}
            </section>
            {data.ambiguous.length > 0 ? <section aria-labelledby="ambiguous-heading" className="flex flex-col gap-3">
              <h2 id="ambiguous-heading" className="text-base font-semibold">Ambiguous links ({data.ambiguous.length})</h2>
              <p className="text-sm text-muted-foreground">Multiple notes match. Choose one below to pin the link to that note's stable ID.</p>
              <ul className="flex flex-col gap-2">{data.ambiguous.map((link) => <li key={`${link.sourceId}:${link.start}`} className="flex flex-col gap-2">
                <Button variant="link" className="h-auto max-w-full justify-start whitespace-normal text-left" onClick={() => onOpenNote(link.sourceId)}>{link.raw} in {link.sourceTitle} · {link.sourcePath}:{link.line}</Button>
                <SuggestionList
                  link={link}
                  suggestions={link.suggestions}
                  busy={busy}
                  repairingKey={repairing}
                  onRepair={(suggestion) => void repair(link, suggestion)}
                  emptyLabel="No other candidate is available. Edit the source note to choose a destination."
                />
              </li>)}</ul>
            </section> : null}
            <section aria-labelledby="orphans-heading" className="flex flex-col gap-3">
              <h2 id="orphans-heading" className="text-base font-semibold">Isolated notes ({data.isolated.length})</h2>
              <p className="text-sm text-muted-foreground">No other note links to these notes, and they link to no other note. Self-links and ambiguous mentions do not count. These notes are valid; this is a way to discover and connect them.</p>
              {data.isolated.length === 0 ? <p className="text-sm text-muted-foreground">Every note has an incoming or outgoing link.</p> : <ul className="flex flex-col divide-y">{data.isolated.map((note) => <li key={note.id} className="flex flex-col items-start gap-1 py-2">
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
function SuggestionList({
  link,
  suggestions,
  busy,
  repairingKey,
  onRepair,
  emptyLabel = 'No close match found. Create the target or edit the source note.',
}: {
  link: BrokenLink;
  suggestions: UiLinkSuggestion[];
  busy: boolean;
  repairingKey: string | null;
  onRepair: (suggestion: UiLinkSuggestion) => void;
  emptyLabel?: string;
}) {
  if (suggestions.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  const key = `${link.sourceId}:${link.start}`;
  const repairingThis = repairingKey === key;
  return (
    <div role="group" aria-label={`Suggested targets for ${link.target}`} className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{repairingThis ? 'Repairing link…' : 'Use an existing note:'}</span>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion.noteId}
            type="button"
            variant="outline"
            size="sm"
            className="h-auto max-w-full justify-start whitespace-normal py-1.5 text-left"
            disabled={busy}
            onClick={() => onRepair(suggestion)}
            aria-label={`Link ${link.target} to ${suggestion.title} (${reasonLabel(suggestion.reason)})`}
          >
            <span className="flex min-w-0 flex-col items-start gap-0.5">
              <span className="max-w-full truncate font-medium">{suggestion.title}</span>
              <span className="max-w-full truncate text-[11px] text-muted-foreground">
                {suggestion.path} · {reasonLabel(suggestion.reason)}
              </span>
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function reasonLabel(reason: UiLinkSuggestion['reason']): string {
  switch (reason) {
    case 'exact-title': return 'title matches';
    case 'exact-alias': return 'alias matches';
    case 'exact-path': return 'path matches';
    case 'title-similar': return 'similar title';
    case 'alias-similar': return 'similar alias';
    case 'path-similar': return 'similar path';
    case 'title-words': return 'shared title words';
    case 'alias-words': return 'shared alias words';
    case 'path-words': return 'shared path words';
    case 'candidate': return 'current candidate';
  }
}

function messageOf(error: unknown) { return error instanceof Error ? error.message : 'Could not load discovery.'; }
