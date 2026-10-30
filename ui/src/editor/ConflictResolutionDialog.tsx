import { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { UiNote } from '../../../src/ui-server/dto';

export interface ConflictDraft {
  title: string;
  body: string;
  icon: string | null;
  revision: number;
}

export interface NoteConflict {
  vaultIdentity: string;
  noteId: string;
  baseHash: string;
  baseNote: UiNote | null;
  diskNote: UiNote | null;
  draft: ConflictDraft;
  deleted: boolean;
  loading: boolean;
  error: string | null;
}

function VersionCard({ label, title, icon, body, marker }: {
  label: string;
  title: string;
  icon: string | null;
  body: string;
  marker?: string;
}) {
  return (
    <section className="min-w-0 rounded-md border bg-muted/20" aria-label={label}>
      <div className="border-b px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold">{label}</h3>
          {marker && <Badge variant="outline">{marker}</Badge>}
        </div>
        <p className="mt-1 break-words text-sm">{icon ? `${icon} ` : ''}{title || 'Untitled note'}</p>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed" tabIndex={0} aria-label={`${label} Markdown body`}>
        {body || '— Empty document —'}
      </pre>
    </section>
  );
}

function Difference({ label, changed }: { label: string; changed: boolean }) {
  return <div className="flex items-center justify-between gap-2 text-xs"><dt className="text-muted-foreground">{label}</dt><dd><Badge variant={changed ? 'destructive' : 'secondary'}>{changed ? 'Changed' : 'Same'}</Badge></dd></div>;
}

export function ConflictResolutionDialog({
  conflict,
  busy,
  onRetry,
  onUseDisk,
  onSaveSeparate,
  onSaveOverDisk,
  onClose,
  onFocusEditor,
}: {
  conflict: NoteConflict | null;
  busy: boolean;
  onRetry: () => void;
  onUseDisk: () => void;
  onSaveSeparate: () => void;
  onSaveOverDisk: () => void;
  onClose: () => void;
  onFocusEditor: () => void;
}) {
  const [keepDraft, setKeepDraft] = useState(false);
  const [confirmedOverwrite, setConfirmedOverwrite] = useState(false);
  useEffect(() => {
    setKeepDraft(false);
    setConfirmedOverwrite(false);
  }, [conflict?.diskNote?.contentHash, conflict?.deleted, conflict?.noteId]);
  const open = conflict !== null;
  const disk = conflict?.diskNote ?? null;
  const base = conflict?.baseNote ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl" onCloseAutoFocus={(event) => { event.preventDefault(); onFocusEditor(); }}>
        <DialogHeader>
          <DialogTitle>{conflict?.deleted ? 'This note was deleted on disk' : 'This note changed outside Nodus'}</DialogTitle>
          <DialogDescription>
            Your local draft is safe. Compare the versions and choose what to keep. Nodus will not merge or overwrite anything without your explicit choice.
          </DialogDescription>
        </DialogHeader>

        {conflict?.loading && <p className="text-sm text-muted-foreground" role="status">Loading the latest disk version…</p>}
        {conflict?.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{conflict.error}</span>
          </div>
        )}
        {conflict?.deleted && <p className="text-sm text-destructive">The original note no longer exists. You can keep the draft here or save it as a separate note.</p>}
        {disk && <p className="text-xs text-muted-foreground">Current disk revision: <code className="break-all">{disk.contentHash}</code></p>}

        {conflict && disk && (
          <>
            <dl className="grid gap-2 rounded-md border px-3 py-2 sm:grid-cols-3">
              <Difference label="Title" changed={disk.title !== conflict.draft.title} />
              <Difference label="Icon" changed={disk.icon !== conflict.draft.icon} />
              <Difference label="Markdown body" changed={disk.body !== conflict.draft.body} />
            </dl>
            <div className="grid gap-3 md:grid-cols-2">
              <VersionCard label="Current on disk" title={disk.title} icon={disk.icon} body={disk.body} marker="Latest saved version" />
              <VersionCard label="Your unsaved draft" title={conflict.draft.title} icon={conflict.draft.icon} body={conflict.draft.body} marker="Not saved" />
            </div>
          </>
        )}
        {conflict && base && (
          <details className="rounded-md border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">Original saved version</summary>
            <div className="mt-3"><VersionCard label="Original saved version" title={base.title} icon={base.icon} body={base.body} marker="Draft base" /></div>
          </details>
        )}
        {conflict && !base && <p className="text-xs text-muted-foreground">The original saved text is unavailable in this session. The local draft and current disk version are shown.</p>}

        {keepDraft && disk && (
          <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm">Keeping your draft does not change the file. Saving it will replace the current disk version and must be confirmed against this exact revision.</p>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox checked={confirmedOverwrite} onCheckedChange={(checked) => setConfirmedOverwrite(checked === true)} />
              <span>I reviewed both versions and want to save my draft over the current disk version.</span>
            </label>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-wrap">
          {conflict?.error && <Button type="button" variant="outline" disabled={busy} onClick={onRetry}><RefreshCw /> Retry loading disk version</Button>}
          <Button type="button" variant="outline" disabled={busy || conflict?.loading} onClick={onSaveSeparate}>Save draft as separate note</Button>
          <Button type="button" variant="outline" disabled={busy || !disk} onClick={onUseDisk}>Use disk version</Button>
          {keepDraft && disk ? (
            <Button type="button" variant="destructive" disabled={busy || !confirmedOverwrite} onClick={onSaveOverDisk}>
              <AlertTriangle /> Save over current disk version
            </Button>
          ) : (
            <Button type="button" disabled={busy || !disk} onClick={() => { setKeepDraft(true); setConfirmedOverwrite(false); }}>Keep my draft</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
