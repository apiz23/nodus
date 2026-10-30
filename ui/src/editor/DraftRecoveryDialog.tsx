import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { DraftRecoveryEntry } from '../draftRecoveryJournal.js';

export function DraftRecoveryDialog({
  entries,
  diskHash,
  busy,
  error,
  onRecover,
  onDiscard,
  onClose,
  onFocusEditor,
}: {
  entries: readonly DraftRecoveryEntry[];
  diskHash: string;
  busy: boolean;
  error: string | null;
  onRecover: (entry: DraftRecoveryEntry) => void;
  onDiscard: (entry: DraftRecoveryEntry) => void;
  onClose: () => void;
  onFocusEditor: () => void;
}) {
  return (
    <Dialog open={entries.length > 0} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg" onCloseAutoFocus={(event) => { event.preventDefault(); onFocusEditor(); }}>
        <DialogHeader>
          <DialogTitle>Recover an unsaved draft?</DialogTitle>
          <DialogDescription>
            These drafts are stored in this browser only. Markdown files have not been changed. Choose a draft to restore it to the editor, or discard it.
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => {
            const conflict = entry.baseHash !== diskHash;
            return (
              <li key={`${entry.writerId}:${entry.revision}`} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <time className="text-xs text-muted-foreground" dateTime={entry.updatedAt}>
                    Draft saved {new Date(entry.updatedAt).toLocaleString()}
                  </time>
                  {conflict && <Badge variant="destructive">Disk version changed</Badge>}
                </div>
                {conflict && <p className="mt-2 text-sm text-destructive">This draft is based on an older version of this note. Recovering will not change the file; saving may be rejected until you resolve the conflict.</p>}
                <p className="mt-2 truncate text-sm font-medium">{entry.title || 'Untitled note'}</p>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">{entry.body.slice(0, 500) || 'Empty draft'}</p>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onDiscard(entry)}>Discard draft</Button>
                  <Button type="button" size="sm" disabled={busy} onClick={() => onRecover(entry)}>Recover draft</Button>
                </div>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Not now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
