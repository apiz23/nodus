import { AlertCircle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { UiNote } from '../../../src/ui-server/dto';

function Version({ label, note }: { label: string; note: UiNote }) {
  return (
    <section className="min-w-0 rounded-md border bg-muted/20" aria-label={label}>
      <div className="border-b px-3 py-2">
        <h3 className="text-xs font-semibold">{label}</h3>
        <p className="mt-1 break-words text-sm">{note.icon ? `${note.icon} ` : ''}{note.title}</p>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed" tabIndex={0} aria-label={`${label} Markdown body`}>
        {note.body || '— Empty document —'}
      </pre>
    </section>
  );
}

export function ExternalChangeNotice({
  note,
  error,
  busy,
  onReload,
  onCompare,
  onRetry,
}: {
  note: UiNote | null;
  error: string | null;
  busy: boolean;
  onReload: () => void;
  onCompare: () => void;
  onRetry: () => void;
}) {
  if (!note && !error) return null;
  return (
    <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm sm:mx-4">
      {error ? <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" /> : <RefreshCw className="size-4 shrink-0 text-primary" aria-hidden="true" />}
      <p className="min-w-0 flex-1" role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} aria-atomic="true">{error ?? `“${note?.title}” changed on disk outside Nodus. Your editor has not been replaced.`}</p>
      {error ? <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={busy}>Check again</Button> : (
        <>
          <Button type="button" size="sm" variant="outline" onClick={onCompare} disabled={busy}>Compare versions</Button>
          <Button type="button" size="sm" onClick={onReload} disabled={busy}>{busy ? 'Reloading…' : 'Reload note'}</Button>
        </>
      )}
    </div>
  );
}

export function ExternalChangeDialog({
  open,
  current,
  latest,
  busy,
  onReload,
  onClose,
  onFocusEditor,
}: {
  open: boolean;
  current: UiNote | null;
  latest: UiNote | null;
  busy: boolean;
  onReload: () => void;
  onClose: () => void;
  onFocusEditor: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl"
        onCloseAutoFocus={(event) => { event.preventDefault(); onFocusEditor(); }}
      >
        <DialogHeader>
          <DialogTitle>Compare the external change</DialogTitle>
          <DialogDescription>The newer Markdown is on the right. Your current editor content remains unchanged until you choose Reload note.</DialogDescription>
        </DialogHeader>
        {current && latest ? (
          <>
            <dl className="grid gap-2 rounded-md border px-3 py-2 sm:grid-cols-3">
              <div className="flex items-center justify-between gap-2 text-xs"><dt className="text-muted-foreground">Title</dt><dd><Badge variant={current.title !== latest.title ? 'destructive' : 'secondary'}>{current.title !== latest.title ? 'Changed' : 'Same'}</Badge></dd></div>
              <div className="flex items-center justify-between gap-2 text-xs"><dt className="text-muted-foreground">Icon</dt><dd><Badge variant={current.icon !== latest.icon ? 'destructive' : 'secondary'}>{current.icon !== latest.icon ? 'Changed' : 'Same'}</Badge></dd></div>
              <div className="flex items-center justify-between gap-2 text-xs"><dt className="text-muted-foreground">Markdown body</dt><dd><Badge variant={current.body !== latest.body ? 'destructive' : 'secondary'}>{current.body !== latest.body ? 'Changed' : 'Same'}</Badge></dd></div>
            </dl>
            <div className="grid gap-3 md:grid-cols-2">
              <Version label="Currently open in Nodus" note={current} />
              <Version label="Latest on disk" note={latest} />
            </div>
          </>
        ) : <p role="status" className="text-sm text-muted-foreground">Loading the latest note…</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Keep current editor content</Button>
          <Button type="button" disabled={busy || !latest} onClick={onReload}>{busy ? 'Reloading…' : 'Reload note'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
