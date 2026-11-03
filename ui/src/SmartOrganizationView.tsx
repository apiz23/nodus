import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, FolderInput, RefreshCw, Sparkles, Tags, X } from 'lucide-react';
import type { OrganizationAction, OrganizationSuggestion, OrganizationSuggestionType } from '../../src/organization/analysis.js';
import type { UiOrganizationAnalysis } from '../../src/ui-server/dto.js';
import type { UiOrganizationMovePreview } from '../../src/ui-server/dto.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from './api';
import { readOrganizationStatuses, writeOrganizationStatuses, type OrganizationStatus } from './organizationState';

type Category = 'all' | OrganizationSuggestionType;
interface Props {
  vaultIdentity: string;
  revision: number;
  onOpenNote: (id: string) => void;
  onChanged: () => Promise<void>;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

const categoryNames: Record<OrganizationSuggestionType, string> = {
  tag: 'Tags', duplicate: 'Possible duplicates', folder: 'Folder ideas', metadata: 'Missing properties',
};

export function SmartOrganizationView({ vaultIdentity, revision, onOpenNote, onChanged, sidebarCollapsed, onToggleSidebar }: Props) {
  const [data, setData] = useState<UiOrganizationAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<Category>('all');
  const [statuses, setStatuses] = useState<Record<string, OrganizationStatus>>({});
  const [storageIssue, setStorageIssue] = useState<string | null>(null);
  const [preview, setPreview] = useState<OrganizationSuggestion | null>(null);
  const [movePreview, setMovePreview] = useState<UiOrganizationMovePreview | null>(null);
  const [movePreviewLoading, setMovePreviewLoading] = useState(false);
  const [movePreviewError, setMovePreviewError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const request = useRef(0);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const movePreviewRequest = useRef(0);

  async function load(refresh = false) {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.organization(refresh);
      if (mounted.current && current === request.current) setData(result);
    } catch (reason) {
      if (mounted.current && current === request.current) setError(messageOf(reason));
    } finally {
      if (mounted.current && current === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    try {
      const loaded = readOrganizationStatuses(window.localStorage, vaultIdentity);
      setStatuses(loaded.entries);
      setStorageIssue(loaded.issue ?? null);
    } catch {
      setStatuses({});
      setStorageIssue('Suggestion status storage is unavailable. You can still review and apply recommendations.');
    }
    void load();
    return () => { mounted.current = false; request.current++; };
  }, [vaultIdentity, revision]);

  useEffect(() => {
    if (!data) return;
    const activeIds = new Set(data.suggestions.map((suggestion) => suggestion.id));
    const next = Object.fromEntries(Object.entries(statuses).filter(([id]) => activeIds.has(id)));
    if (Object.keys(next).length === Object.keys(statuses).length) return;
    setStatuses(next);
    try { writeOrganizationStatuses(window.localStorage, vaultIdentity, next); }
    catch { setStorageIssue('Some obsolete suggestion states could not be cleared.'); }
  }, [data, statuses, vaultIdentity]);

  const pending = useMemo(() => (data?.suggestions ?? []).filter((item) => !statuses[item.id]
    && (category === 'all' || item.type === category)), [data, statuses, category]);

  function setSuggestionStatus(id: string, status: OrganizationStatus) {
    const next = { ...statuses, [id]: status };
    try {
      writeOrganizationStatuses(window.localStorage, vaultIdentity, next);
      setStatuses(next);
      setStorageIssue(null);
    } catch {
      setStorageIssue('Could not save this suggestion state. The suggestion was left open.');
    }
  }

  async function applyTag(suggestion: OrganizationSuggestion) {
    if (inFlight.current || suggestion.action.type !== 'add-tag') return;
    inFlight.current = true;
    setBusyId(suggestion.id);
    setActionError(null);
    try {
      const action = suggestion.action;
      await api.applyOrganizationSuggestion(suggestion.id);
      if (!mounted.current) return;
      setSuggestionStatus(suggestion.id, 'reviewed');
      setPreview(null);
      await onChanged();
    } catch (reason) {
      if (mounted.current) setActionError(`${messageOf(reason)} The note was not changed unless the API confirmed the write; refresh to check the current vault state.`);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusyId(null);
    }
  }

  async function openPreview(suggestion: OrganizationSuggestion) {
    setPreview(suggestion);
    setMovePreview(null);
    setMovePreviewError(null);
    if (suggestion.action.type !== 'preview-move') return;
    const current = ++movePreviewRequest.current;
    setMovePreviewLoading(true);
    try {
      const result = await api.organizationMovePreview(suggestion.id);
      if (mounted.current && current === movePreviewRequest.current) setMovePreview(result.preview);
    } catch (reason) {
      if (mounted.current && current === movePreviewRequest.current) setMovePreviewError(messageOf(reason));
    } finally {
      if (mounted.current && current === movePreviewRequest.current) setMovePreviewLoading(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Smart organization">
      <header className="flex min-h-12 flex-wrap items-center gap-2 border-b px-4 py-2">
        {sidebarCollapsed ? <Button variant="ghost" size="icon-sm" aria-label="Expand sidebar" onClick={onToggleSidebar}><FolderInput /></Button> : null}
        <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="flex-1 text-sm font-medium">Smart organization</h1>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(true)}><RefreshCw data-icon="inline-start" />Refresh analysis</Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-8" aria-busy={loading}>
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <p className="max-w-[74ch] text-sm leading-6 text-muted-foreground">Review local suggestions based on saved Markdown, existing tags, registered properties, and confirmed links. Nothing moves, merges, or changes until you choose an action.</p>
          {storageIssue ? <p role="status" className="text-sm text-muted-foreground">{storageIssue}</p> : null}
          {error ? <div role="alert" className="flex flex-wrap items-center gap-3 border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive"><span className="min-w-0 flex-1">{error}</span><Button variant="outline" size="sm" onClick={() => void load(true)}>Retry</Button></div> : null}
          {actionError ? <div role="alert" className="flex flex-wrap items-center gap-3 border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive"><span className="min-w-0 flex-1">{actionError}</span><Button variant="ghost" size="icon-sm" aria-label="Dismiss action error" onClick={() => setActionError(null)}><X /></Button></div> : null}
          {loading && data === null ? <div className="flex flex-col gap-3" aria-label="Analyzing notes"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div> : null}
          {!loading && data && data.totalNotes === 0 ? <div className="border border-dashed px-5 py-12 text-center"><h2 className="text-sm font-semibold">No notes to organize yet</h2><p className="mt-2 text-sm text-muted-foreground">Create Markdown notes to see tag, duplicate, folder, and property suggestions here.</p></div> : null}
          {data && data.totalNotes > 0 ? <>
            <section aria-label="Organization overview" className="grid grid-cols-2 gap-px border bg-border sm:grid-cols-5">
              <Overview label="Notes analyzed" count={data.totalNotes} />
              <Overview label="Open suggestions" count={data.suggestions.filter((item) => !statuses[item.id]).length} />
              {(['tag', 'duplicate', 'folder', 'metadata'] as const).map((key) => <Overview key={key} label={categoryNames[key]} count={data.counts[key]} />)}
            </section>
            {data.truncated ? <p role="status" className="text-xs text-muted-foreground">Showing a bounded set of suggestions. Refine the vault or review the current set before refreshing.</p> : null}
            {data.retrievalIssue ? <p role="status" className="text-xs text-muted-foreground">{data.retrievalIssue} Exact duplicates and confirmed-link folder evidence remain available.</p> : null}
            {data.catalogIssue ? <p role="status" className="text-xs text-muted-foreground">Registered-property suggestions are unavailable: {data.catalogIssue}</p> : null}
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter organization suggestions">
              {(['all', 'tag', 'duplicate', 'folder', 'metadata'] as const).map((value) => <Button key={value} size="sm" variant={category === value ? 'secondary' : 'outline'} aria-pressed={category === value} onClick={() => setCategory(value)}>{value === 'all' ? 'All' : categoryNames[value]}</Button>)}
            </div>
            {pending.length === 0 ? <div className="border border-dashed px-5 py-10 text-center"><h2 className="text-sm font-semibold">You’re all caught up</h2><p className="mt-2 text-sm text-muted-foreground">There are no open suggestions in this category. Reviewed and dismissed suggestions stay out of the way.</p><Button variant="link" size="sm" onClick={() => { setStatuses({}); try { writeOrganizationStatuses(window.localStorage, vaultIdentity, {}); setStorageIssue(null); } catch { setStorageIssue('Could not clear saved suggestion states.'); } }}>Show all suggestions again</Button></div> : <ul className="flex flex-col gap-3">{pending.map((suggestion) => <SuggestionItem key={suggestion.id} suggestion={suggestion} busy={busyId === suggestion.id} onOpenNote={onOpenNote} onDismiss={() => setSuggestionStatus(suggestion.id, 'dismissed')} onReview={() => setSuggestionStatus(suggestion.id, 'reviewed')} onApply={() => void openPreview(suggestion)} />)}</ul>}
          </> : null}
        </div>
      </div>
      <Dialog open={preview !== null} onOpenChange={(open) => { if (!open && busyId === null) { movePreviewRequest.current++; setPreview(null); setMovePreview(null); setMovePreviewLoading(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{preview?.action.type === 'add-tag' ? 'Preview tag change' : 'Preview folder idea'}</DialogTitle>
            <DialogDescription>{preview?.action.type === 'add-tag'
              ? `This adds the existing “${preview.action.tag}” tag to one note. Markdown body text and other frontmatter fields are preserved.`
              : 'This is a proposal only. The move-safe link maintenance needed to execute a move is not integrated yet.'}</DialogDescription>
          </DialogHeader>
            {preview?.action.type === 'add-tag' ? <div className="flex max-h-64 flex-col gap-2 overflow-auto rounded-md border p-3 text-sm">
            {preview.affectedNotes.map((note) => <div key={note.id} className="flex items-center gap-2"><Button variant="link" size="sm" className="h-auto min-w-0 justify-start p-0 text-left" onClick={() => onOpenNote(note.id)}>{note.title}</Button><span className="min-w-0 truncate text-xs text-muted-foreground">{note.path}</span>{preview.action.type === 'add-tag' && note.id === preview.action.noteId ? <Badge variant="secondary">tag will be added</Badge> : null}</div>)}
          </div> : null}
          {preview?.action.type === 'preview-move' ? <div className="flex max-h-72 flex-col gap-2 overflow-auto rounded-md border p-3 text-sm">
            {movePreviewLoading ? <Skeleton className="h-12 w-full" aria-label="Loading move impact" /> : null}
            {movePreviewError ? <div role="alert" className="flex items-center gap-2 text-destructive"><span className="flex-1">{movePreviewError}</span><Button variant="outline" size="sm" onClick={() => void openPreview(preview)}>Retry preview</Button></div> : null}
            {movePreview ? <>
              <div><span className="text-xs text-muted-foreground">Current path</span><p className="break-all font-mono text-xs">{movePreview.currentPath}</p></div>
              <div><span className="text-xs text-muted-foreground">Proposed path</span><p className="break-all font-mono text-xs">{movePreview.destinationPath}</p></div>
              {movePreview.destinationExists ? <p role="alert" className="text-sm text-destructive">A note already exists at this path.</p> : null}
              <p className="text-xs text-muted-foreground">{movePreview.pathLinkCount} path-based link {movePreview.pathLinkCount === 1 ? 'occurrence' : 'occurrences'} in {movePreview.affectedSourceCount} source notes. Stable-ID and title links are not counted.</p>
              {movePreview.pathLinks.length ? <ul className="flex flex-col divide-y border-t">{movePreview.pathLinks.map((link, index) => <li key={`${link.sourceId}:${link.target}:${link.line}:${index}`} className="py-2"><Button variant="link" size="sm" className="h-auto justify-start p-0" onClick={() => onOpenNote(link.sourceId)}>{link.sourceTitle}</Button><p className="break-all text-xs text-muted-foreground">{link.sourcePath}:{link.line} · [[{link.target}{link.display === undefined ? '' : `|${link.display}`}]]</p><p className="break-words text-xs text-muted-foreground">{link.snippet}</p></li>)}</ul> : <p className="text-xs text-muted-foreground">No incoming path-based wiki links were found in this snapshot.</p>}
              {movePreview.truncated ? <p className="text-xs text-muted-foreground">Showing the first {movePreview.pathLinks.length} link occurrences.</p> : null}
              <p className="border-t pt-2 text-xs text-muted-foreground">This milestone does not execute moves. Path-safe move maintenance is pending integration; review this preview, then use the existing move workflow only when its link impact is acceptable.</p>
            </> : null}
          </div> : null}
          <DialogFooter>
            <Button variant="outline" disabled={busyId !== null} onClick={() => setPreview(null)}>Cancel</Button>
            {preview?.action.type === 'add-tag' ? <Button disabled={busyId !== null} onClick={() => void applyTag(preview)}>{busyId ? 'Applying…' : 'Add existing tag'}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Overview({ label, count }: { label: string; count: number }) {
  return <div className="min-w-0 bg-background px-3 py-3"><div className="font-heading text-xl font-semibold tabular-nums">{count}</div><div className="mt-1 truncate text-xs text-muted-foreground">{label}</div></div>;
}

function SuggestionItem({ suggestion, busy, onOpenNote, onDismiss, onReview, onApply }: {
  suggestion: OrganizationSuggestion; busy: boolean; onOpenNote: (id: string) => void; onDismiss: () => void; onReview: () => void; onApply: () => void;
}) {
  const action: OrganizationAction = suggestion.action;
  return <li className="flex flex-col gap-3 border p-3 sm:p-4">
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">{categoryNames[suggestion.type]}</Badge>
      <Badge variant="outline">{Math.round(suggestion.confidence * 100)}% confidence</Badge>
      {suggestion.confidence >= 0.8 ? <span className="sr-only">High confidence</span> : <span className="sr-only">Suggested for review</span>}
      <span className="ml-auto text-xs text-muted-foreground">{suggestion.affectedNotes.length} related {suggestion.affectedNotes.length === 1 ? 'note' : 'notes'}</span>
    </div>
    <div><h2 className="text-sm font-medium">{suggestion.explanation}</h2><ul className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">{suggestion.evidence.map((item) => <li key={item}>• {item}</li>)}</ul></div>
    <ul className="flex flex-col divide-y border-y">{suggestion.affectedNotes.slice(0, 8).map((note) => <li key={note.id}><Button variant="ghost" className="h-auto w-full justify-start gap-2 rounded-none px-1.5 py-2 text-left font-normal" onClick={() => onOpenNote(note.id)}><span className="min-w-0 flex-1 truncate">{note.title}</span><span className="max-w-[45%] truncate text-xs text-muted-foreground">{note.path}</span><ArrowRight className="text-muted-foreground" /></Button></li>)}</ul>
    <div className="flex flex-wrap items-center gap-2">
      {action.type === 'add-tag' ? <Button size="sm" disabled={busy} onClick={onApply}><Tags data-icon="inline-start" />Preview tag change</Button> : null}
      {action.type === 'preview-move' ? <Button size="sm" variant="outline" onClick={onApply}><FolderInput data-icon="inline-start" />Preview folder move</Button> : null}
      {action.type === 'review' ? <Button size="sm" variant="outline" onClick={() => onOpenNote(action.noteId)}>Review notes</Button> : null}
      <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={onReview}>Mark reviewed</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>Dismiss</Button>
    </div>
  </li>;
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : 'Could not load organization suggestions.'; }
