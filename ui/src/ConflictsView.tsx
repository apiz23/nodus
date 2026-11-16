import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Cloud, CloudOff, FileDiff, RefreshCw } from 'lucide-react';
import type { ResolutionIntent, ResolutionSnapshot } from '../../src/sync/resolution-decisions';
import type { UiConflictInspection, UiConflictPage, UiResolutionHistoryEntry, UiSyncConnection } from '../../src/ui-server/dto';
import { api, ApiError } from './api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { SidebarToggle } from './SidebarToggle';
import { FeedbackMessage } from './AsyncFeedback';
import { conflictLabel } from './conflictPresentation';

type Action = ResolutionIntent['action'];
const snapshot = (value: NonNullable<UiConflictInspection['local']>): ResolutionSnapshot => ({ id: value.id, path: value.path, contentHash: value.hash, content: value.content });
const labelForAction: Record<Action, string> = { 'keep-local': 'Keep local', 'keep-remote': 'Keep incoming', 'save-merged-copy': 'Create merged copy' };
const statusLabel = (value: string) => value.replaceAll('-', ' ');

export function ConflictsView({ onOpenDocument, sidebarCollapsed, onToggleSidebar }: { onOpenDocument: (kind: 'note' | 'database', id: string) => void; sidebarCollapsed: boolean; onToggleSidebar: () => void }) {
  const [connection, setConnection] = useState<UiSyncConnection>({ connected: false });
  const [relayUrl, setRelayUrl] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [page, setPage] = useState<UiConflictPage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UiConflictInspection | null>(null);
  const [history, setHistory] = useState<UiResolutionHistoryEntry[]>([]);
  const [historyNext, setHistoryNext] = useState<string | null>(null);
  const [mergedText, setMergedText] = useState('');
  const [mergedTarget, setMergedTarget] = useState<ResolutionSnapshot | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const inspectionSequence = useRef(0);

  const reload = useCallback(async () => {
    const sequence = ++inspectionSequence.current;
    setLoading(true);
    setError(null);
    try {
      const status = await api.syncConnection();
      setConnection(status);
      const next = await api.conflicts();
      if (sequence !== inspectionSequence.current) return;
      setPage(next);
      if (selectedId && next.conflicts.some((item) => item.conflictId === selectedId)) {
        const [inspection, entries] = await Promise.all([api.inspectConflict(selectedId), api.resolutionHistory(selectedId)]);
        if (sequence !== inspectionSequence.current) return;
        setDetail(inspection); setHistory([...entries.decisions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); setHistoryNext(entries.next);
      } else { setSelectedId(null); setDetail(null); setHistory([]); setHistoryNext(null); }
    } catch (cause) { if (sequence === inspectionSequence.current) setError(cause instanceof Error ? cause.message : 'Could not load conflict data.'); }
    finally { if (sequence === inspectionSequence.current) setLoading(false); }
  }, [selectedId]);

  useEffect(() => { void reload(); }, [reload]);

  async function inspect(conflictId: string) {
    const sequence = ++inspectionSequence.current;
    setSelectedId(conflictId); setDetail(null); setHistory([]); setHistoryNext(null); setError(null); setLoading(true);
    try {
      const [inspection, entries] = await Promise.all([api.inspectConflict(conflictId), api.resolutionHistory(conflictId)]);
      if (sequence !== inspectionSequence.current) return;
      setDetail(inspection); setHistory([...entries.decisions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); setHistoryNext(entries.next); setMergedText(inspection.local?.content ?? inspection.remote?.content ?? ''); setMergedTarget(null);
    } catch (cause) { if (sequence === inspectionSequence.current) setError(cause instanceof Error ? cause.message : 'Could not inspect this conflict.'); }
    finally { if (sequence === inspectionSequence.current) setLoading(false); }
  }

  async function connect(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { const status = await api.connectSync({ relayUrl, pairingCode }); setConnection(status); setPairingCode(''); setAnnouncement('Connected for this session. Credentials are held in memory.'); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not connect to the relay.'); }
    finally { setBusy(false); }
  }

  async function manualPull() {
    setBusy(true); setError(null);
    try { await api.pullSync(); setAnnouncement('Incoming changes checked. Local documents may have been updated.'); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The incoming check failed.'); }
    finally { setBusy(false); }
  }

  async function retryDecision(decisionId: string) {
    setBusy(true); setError(null);
    try {
      const result = await api.executeResolution(decisionId);
      setAnnouncement(result.status === 'completed' ? 'The saved resolution completed.' : `Decision status: ${statusLabel(result.status)}. ${result.diagnostic ?? ''}`);
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The saved resolution needs inspection.'); }
    finally { setBusy(false); }
  }

  async function loadOlderHistory() {
    if (selectedId === null || historyNext === null) return;
    try {
      const page = await api.resolutionHistory(selectedId, historyNext);
      setHistory((current) => [...current, ...page.decisions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setHistoryNext(page.next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load older resolution history.'); }
  }

  async function reviewMergedCopy() {
    if (detail === null || detail.remote === null || detail.local === null) return;
    setBusy(true); setError(null);
    try {
      const target = await api.previewMergedCopy({
        conflictId: detail.summary.conflictId,
        draftContent: mergedText,
        reviewed: { localHash: detail.local.hash, remoteHash: detail.remote.hash, copyHash: detail.copy?.expectedHash ?? null },
      });
      setMergedTarget(target);
      setAction('save-merged-copy');
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === 'STALE_REVIEW'
        ? 'The reviewed versions changed. Reload the conflict before creating a merged copy.'
        : cause instanceof Error ? cause.message : 'Merged content could not be reviewed.');
    } finally { setBusy(false); }
  }

  const staleReview = useMemo(() => detail === null || detail.remote === null || !detail.remote.verified ||
    (detail.summary.local?.hash ?? null) !== (detail.local?.hash ?? null) ||
    (detail.summary.local?.path ?? null) !== (detail.local?.path ?? null) ||
    (detail.copy !== null && !detail.copy.verified), [detail]);

  async function execute(actionToRun: Action) {
    if (detail === null || detail.remote === null) return;
    setBusy(true); setError(null); setAction(null); setAnnouncement(`Preparing and executing ${labelForAction[actionToRun].toLowerCase()}…`);
    try {
      const local = detail.local;
      const copy = detail.copy;
      const remote = detail.remote;
      const expectedLocal = local === null ? null : snapshot(local);
      const expectedCopy = copy !== null && copy.content !== null && copy.actualHash === copy.expectedHash
        ? { id: copy.id, path: copy.path, contentHash: copy.expectedHash, content: copy.content! } : null;
      let target: ResolutionSnapshot | null = null;
      if (actionToRun === 'keep-local') target = expectedLocal;
      if (actionToRun === 'keep-remote' && remote.content !== null) target = await api.previewRemoteResolution({
        conflictId: detail.summary.conflictId,
        reviewed: { localHash: local?.hash ?? null, remoteHash: remote.hash, copyHash: copy?.expectedHash ?? null },
      });
      if (actionToRun === 'save-merged-copy') {
        if (mergedTarget === null) throw new Error('Review the merged output before continuing.');
        target = mergedTarget;
      }
      const decisionId = crypto.randomUUID();
      const intent: ResolutionIntent = {
        schemaVersion: 1, decisionId, conflictId: detail.summary.conflictId,
        document: detail.summary.document, action: actionToRun, expectedBase: detail.summary.base,
        expectedLocal, expectedRemote: {
          version: remote.version, path: remote.path, contentHash: remote.hash,
          operation: remote.operation as ResolutionIntent['expectedRemote']['operation'], content: remote.content,
        }, expectedCopy, target,
      };
      const prepared = await api.prepareResolution({ intent, reviewed: { localHash: local?.hash ?? null, remoteHash: remote.hash, copyHash: copy?.expectedHash ?? null } });
      const result = await api.executeResolution(prepared.intent.decisionId);
      setAnnouncement(result.status === 'completed'
        ? actionToRun === 'save-merged-copy' ? `Merged copy saved at ${result.result?.path}. The original conflict remains unresolved.` : `${labelForAction[actionToRun]} completed.`
        : `Decision status: ${statusLabel(result.status)}. ${result.diagnostic ?? ''}`);
      await reload();
    } catch (cause) {
      const message = cause instanceof ApiError && cause.code === 'STALE_REVIEW'
        ? 'The reviewed versions changed. Reload the conflict before choosing an action.'
        : cause instanceof Error ? cause.message : 'Resolution could not be completed.';
      await reload();
      setError(message);
    } finally { setBusy(false); }
  }

  const selected = page?.conflicts.find((item) => item.conflictId === selectedId) ?? null;
  const latest = history[0] ?? null;
  const detailStatus = latest?.status === 'applying' || latest?.status === 'prepared' || latest?.status === 'rejected-stale' || latest?.status === 'needs-recovery'
    ? latest.status : detail?.summary.status;
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-labelledby="conflicts-title">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        <div><h1 id="conflicts-title" className="text-xl font-semibold tracking-tight">Conflicts</h1><p className="mt-1 max-w-[70ch] text-xs text-muted-foreground">Review exact versions recorded by this vault, then choose what to keep. Nothing syncs until you ask.</p></div>
        {connection.connected ? <Button variant="outline" size="sm" onClick={() => void manualPull()} disabled={busy}><Cloud className="size-4" />Check for incoming changes</Button> : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 border-b lg:w-80 lg:border-r lg:border-b-0" aria-label="Conflict list">
          {!connection.connected ? <form className="space-y-3 p-4" onSubmit={(event) => void connect(event)}>
            <div className="flex items-center gap-2 text-sm font-medium"><CloudOff className="size-4" />Connect for network actions</div>
            <p className="text-xs leading-relaxed text-muted-foreground">Conflicts recorded on this device can be inspected below without connecting. Enter a relay address and one-time pairing code only when you want to check for incoming changes or resolve a conflict. The bearer credential stays in memory.</p>
            <label className="block text-xs font-medium" htmlFor="relay-url">Relay address</label><Input id="relay-url" type="url" autoComplete="url" required value={relayUrl} onChange={(event) => setRelayUrl(event.target.value)} placeholder="https://relay.example" />
            <label className="block text-xs font-medium" htmlFor="pairing-code">One-time pairing code</label><Input id="pairing-code" type="password" autoComplete="off" required value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} />
            <Button type="submit" size="sm" disabled={busy}>Connect for this session</Button>
          </form> : <div className="flex items-center justify-between gap-2 px-3 py-2"><span className="text-xs text-muted-foreground">Vault {connection.vaultId?.slice(0, 8)} · epoch {connection.epoch}</span><Button variant="ghost" size="xs" disabled={busy} onClick={() => void api.disconnectSync().then(() => reload())}>Disconnect</Button></div>}
            <div className="px-3 pb-2"><Button variant="outline" size="sm" className="w-full" onClick={() => void reload()} disabled={loading || busy}><RefreshCw className="size-3.5" />Refresh local conflict list</Button></div>
            <ScrollArea className="max-h-64 lg:max-h-[calc(100%-3rem)]">
              {loading ? <p className="p-4 text-xs text-muted-foreground" role="status">Loading conflicts…</p> : page?.conflicts.length ? page.conflicts.map((conflict) => <button key={conflict.conflictId} type="button" onClick={() => void inspect(conflict.conflictId)} aria-current={selectedId === conflict.conflictId ? 'true' : undefined} className="block w-full border-t px-3 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{conflict.document.kind} · {conflict.document.id.slice(0, 8)}</span><Badge variant={conflict.status === 'needs-recovery' ? 'destructive' : 'secondary'}>{conflictLabel(conflict)}</Badge></span>
                <span className="mt-1 block text-xs text-muted-foreground">{statusLabel(conflict.type)} · incoming v{conflict.remote.version}</span>
              </button>) : <div className="p-4 text-xs text-muted-foreground">{connection.connected ? 'No recorded conflicts in this vault. Check for incoming changes if you expect new updates.' : 'No conflicts have been recorded on this device.'}</div>}
            </ScrollArea>
        </aside>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4 sm:p-6">
          {error ? <div className="mb-4"><FeedbackMessage onRetry={() => void reload()} pending={loading || busy}>{error}</FeedbackMessage></div> : null}
          {announcement ? <p role="status" aria-live="polite" className="mb-4 rounded-md border bg-muted/40 p-3 text-sm">{announcement}</p> : null}
          {selected === null ? <div className="grid min-h-64 place-items-center text-center text-sm text-muted-foreground">{loading ? 'Loading conflict records…' : 'Select a conflict to inspect its recorded local and incoming versions.'}</div> : detail === null ? <div role="status" className="text-sm text-muted-foreground">Loading exact content…</div> : <div className="mx-auto max-w-6xl space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{detail.summary.document.kind} conflict</h2><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{detail.summary.document.id}</p></div><Badge variant={detailStatus === 'needs-recovery' || detailStatus === 'rejected-stale' ? 'destructive' : 'secondary'}>{detailStatus === detail.summary.status ? conflictLabel(detail.summary) : statusLabel(detailStatus ?? 'open')}</Badge></div>
            {detail.summary.diagnostics.map((diagnostic) => <p key={diagnostic} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs" role="note">{diagnostic}</p>)}
            {detail.diagnostics.map((diagnostic) => <p key={diagnostic} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs" role="alert">{diagnostic}</p>)}
            {staleReview ? <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs" role="alert">This content differs from its captured conflict evidence. Reload and inspect before making a decision.</p> : null}
            <div className="grid gap-4 xl:grid-cols-2">
              <VersionPanel title="Local version" metadata={`${detail.local?.path ?? 'Missing'} · ${detail.summary.local?.hash?.slice(0, 12) ?? 'no recorded local hash'}`} content={detail.local?.content ?? '[Local document is missing]'} onOpen={detail.local ? () => onOpenDocument(detail.summary.document.kind, detail.summary.document.id) : undefined} />
              <VersionPanel title="Incoming version" metadata={`${detail.remote?.path ?? 'Path unavailable'} · v${detail.remote?.version ?? '—'} · ${detail.remote?.timestamp ?? ''}`} content={detail.remote?.content ?? '[Incoming revision is a deletion or its bytes are unavailable]'} />
            </div>
            {detail.copy ? <section className="space-y-2"><h3 className="text-sm font-semibold">Preserved conflict copy</h3><p className="break-all text-xs text-muted-foreground">{detail.copy.path} · {detail.copy.verified ? 'verified at the reserved path and hash' : 'missing or changed; inspect manually'}</p>{detail.copy.content !== null ? <VersionPanel title="Preserved local snapshot" metadata={detail.copy.expectedHash} content={detail.copy.content} onOpen={() => onOpenDocument(detail.summary.document.kind, detail.copy!.id)} /> : null}</section> : null}
            <section><h3 className="mb-2 text-sm font-semibold">Resolution history</h3>{history.length === 0 ? <p className="text-xs text-muted-foreground">No decisions recorded.</p> : <ul className="space-y-2">{history.map((entry) => <li key={entry.decisionId} className="flex flex-wrap items-center gap-2 border-t py-2 text-xs"><Badge variant="outline">{statusLabel(entry.status)}</Badge><span>{labelForAction[entry.action]}</span><span className="text-muted-foreground">{new Date(entry.updatedAt).toLocaleString()}</span>{entry.result ? <><span className="text-muted-foreground">{entry.result.path}</span>{entry.action === 'save-merged-copy' ? <Badge variant="secondary">original conflict remains open</Badge> : null}{entry.action === 'save-merged-copy' && entry.status === 'completed' ? <Button variant="link" size="xs" onClick={() => onOpenDocument(detail.summary.document.kind, entry.result!.id)}>Open merged copy</Button> : null}</> : null}{['prepared', 'applying', 'needs-recovery'].includes(entry.status) && connection.connected ? <Button variant="outline" size="xs" disabled={busy} onClick={() => void retryDecision(entry.decisionId)}>Retry safely</Button> : null}{entry.diagnostic ? <span role="note" className="text-destructive">{entry.diagnostic}</span> : null}</li>)}</ul>}{historyNext ? <Button type="button" variant="outline" size="xs" className="mt-2" onClick={() => void loadOlderHistory()}>Load older decisions</Button> : null}</section>
            {detail.summary.status === 'open' ? <section className="space-y-3 border-t pt-4"><h3 className="text-sm font-semibold">Choose an outcome</h3><p className="text-xs text-muted-foreground">Each choice is prepared against the hashes shown above. If either version changes, Nodus will reject the stale review.</p>
              <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !connection.connected || staleReview || detail.local === null || detail.remote?.operation === 'delete'} onClick={() => setAction('keep-local')}>Keep local</Button><Button variant="outline" disabled={busy || !connection.connected || staleReview} onClick={() => setAction('keep-remote')}>Keep incoming</Button><Button variant="outline" disabled={busy || !connection.connected || staleReview || detail.local === null} onClick={() => void reviewMergedCopy()}><FileDiff className="size-4" />Review merged copy</Button></div>
              {detail.remote?.operation === 'delete' ? <p className="text-xs text-muted-foreground">Keeping local by restoring a remotely deleted ID is not available yet. Keep the incoming deletion or save the local content as a new merged copy.</p> : null}
              <label htmlFor="merged-content" className="block text-xs font-medium">Merged document content (explicitly reviewed; no automatic merge)</label><Textarea id="merged-content" value={mergedText} onChange={(event) => { setMergedText(event.target.value); setMergedTarget(null); }} rows={8} className="font-mono text-xs" aria-describedby="merged-help" /><p id="merged-help" className="text-xs text-muted-foreground">A third document is created. The original local and incoming versions stay unchanged; the conflict remains open until you separately choose Keep local or Keep incoming.</p>
            </section> : null}
          </div>}
        </div>
      </div>
      <Dialog open={action !== null} onOpenChange={(open) => { if (!open && !busy) setAction(null); }}>
        <DialogContent><DialogHeader><DialogTitle>{action ? labelForAction[action] : 'Confirm resolution'}</DialogTitle><DialogDescription>{action === 'keep-local' ? 'The exact local version will be retained and the incoming revision reconciled through the existing conditional sync path.' : action === 'keep-remote' ? 'The incoming version will replace the original document only if its reviewed local and remote revisions still match.' : 'A third document will be created from the reviewed content. Both original versions remain unchanged and this conflict stays unresolved.'}</DialogDescription></DialogHeader>
          {action === 'save-merged-copy' && mergedTarget ? <div className="rounded-md border p-3 text-xs"><span className="font-medium">Reviewed output · {mergedTarget.path}</span><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono">{mergedTarget.content}</pre></div> : null}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setAction(null)}>Cancel</Button><Button type="button" disabled={busy || staleReview || (action === 'save-merged-copy' && mergedTarget === null)} onClick={() => action && void execute(action)}>{busy ? 'Working…' : 'Confirm and execute'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function VersionPanel({ title, metadata, content, onOpen }: { title: string; metadata: string; content: string; onOpen?: () => void }) {
  return <section className="min-w-0 rounded-md border"><header className="flex flex-wrap items-start justify-between gap-2 border-b px-3 py-2"><div className="min-w-0"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">{metadata}</p></div>{onOpen ? <Button variant="outline" size="xs" onClick={onOpen}>Open document</Button> : null}</header><ScrollArea className="h-72"><pre tabIndex={0} aria-label={`${title} exact content`} className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed selection:bg-primary/20">{content}</pre></ScrollArea></section>;
}
