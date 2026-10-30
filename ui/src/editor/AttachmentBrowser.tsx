import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, FileText, Image, Link2, Trash2, Upload } from 'lucide-react';
import type { UiAttachment } from '../../../src/ui-server/dto.js';
import { api, ApiError } from '../api.js';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { attachmentMarkdown, relativeAttachmentPath } from './attachmentMarkdown.js';
import { markdownReferencesPath } from '../../../src/links/markdown-paths.js';

export function AttachmentBrowser({ open, onOpenChange, notePath, noteBody, onInsert }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notePath: string;
  noteBody: string;
  onInsert: (markdown: string[]) => void;
}) {
  const [attachments, setAttachments] = useState<UiAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState<UiAttachment | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setError('');
    setLoading(true);
    try { setAttachments((await api.attachments()).attachments); }
    catch (reason) { setAttachments([]); setError(reason instanceof Error ? reason.message : 'Could not load attachments.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  async function upload(files: FileList | File[]): Promise<void> {
    const selected = Array.from(files);
    if (!selected.length) return;
    if (selected.length > 10 || selected.some((file) => file.size > 10 * 1024 * 1024) || selected.reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) {
      setError('Choose up to 10 files, 25 MiB total, with each file no larger than 10 MiB.');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    const added: UiAttachment[] = [];
    const failures: string[] = [];
    for (const file of selected) {
      try { added.push((await api.uploadAttachment(file)).attachment); }
      catch (reason) { failures.push(`${file.name}: ${reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'upload failed'}`); }
    }
    try { await refresh(); } catch { /* refresh exposes its own error */ }
    setBusy(false);
    if (added.length) onInsert(added.map((attachment) => attachmentMarkdown(notePath, attachment)));
    if (failures.length) setError(failures.join(' · '));
    else if (added.length) setMessage(`${added.length} attachment${added.length === 1 ? '' : 's'} uploaded and added to the note.`);
  }

  async function remove(attachment: UiAttachment): Promise<void> {
    setBusy(true); setError('');
    try {
      await api.deleteAttachment(attachment.path, attachment.references.length > 0 || markdownReferencesPath(noteBody, notePath, attachment.path));
      setDeleting(null); await refresh(); setMessage('Attachment deleted.');
    } catch (reason) { setDeleteError(reason instanceof Error ? reason.message : 'Could not delete attachment.'); }
    finally { setBusy(false); }
  }

  async function copyPath(attachment: UiAttachment): Promise<void> {
    try { await navigator.clipboard.writeText(relativeAttachmentPath(notePath, attachment.path)); setMessage('Relative path copied.'); }
    catch { setError('Clipboard access is unavailable.'); }
  }

  return <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] w-[min(42rem,calc(100vw-2rem))] max-w-none flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Attachments</DialogTitle>
          <DialogDescription>Files are stored in this vault and referenced by portable relative Markdown paths. Images, PDF, and UTF-8 text up to 10 MiB are supported.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} className="sr-only" type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/avif,application/pdf,text/plain" onChange={(event) => { if (event.target.files) void upload(event.target.files); event.currentTarget.value = ''; }} aria-label="Choose attachments" />
          <Button type="button" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}><Upload data-icon="inline-start" />Upload files</Button>
          <Button type="button" size="sm" variant="outline" disabled={attachments.length === 0} onClick={() => onInsert(attachments.map((attachment) => attachmentMarkdown(notePath, attachment)))}><Link2 data-icon="inline-start" />Insert all</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
        <ScrollArea className="min-h-0 flex-1 rounded-md border">
          {loading ? <p role="status" className="p-6 text-center text-sm text-muted-foreground">Loading attachments…</p> : attachments.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">{error ? 'Attachments could not be loaded.' : 'No attachments in this vault yet.'}</p> :
            <ul className="divide-y">
              {attachments.map((attachment) => {
                const draftReference = markdownReferencesPath(noteBody, notePath, attachment.path);
                return <li key={attachment.id} className="flex flex-wrap items-center gap-3 p-3">
                {attachment.contentType.startsWith('image/') ? <img className="size-14 rounded border object-cover" src={`/api/assets/image?path=${encodeURIComponent(attachment.path)}`} alt={`Preview of ${attachment.name}`} /> : <div className="flex size-14 items-center justify-center rounded border bg-muted">{attachment.contentType === 'application/pdf' ? <FileText aria-hidden="true" /> : <FileText aria-hidden="true" />}</div>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={attachment.name}>{attachment.name}</p>
                  <p className="text-xs text-muted-foreground">{(attachment.size / 1024).toFixed(1)} KB · {attachment.contentType}</p>
                  {(attachment.references.length > 0 || draftReference) && <Badge variant="secondary" className="mt-1">Used in {attachment.references.length} saved note{attachment.references.length === 1 ? '' : 's'}{draftReference ? ' and this draft' : ''}</Badge>}
                </div>
                <div className="flex gap-1">
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Open ${attachment.name}`} onClick={() => window.open(api.attachmentUrl(attachment.path), '_blank', 'noopener,noreferrer')}><Image aria-hidden="true" /></Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Copy path for ${attachment.name}`} onClick={() => void copyPath(attachment)}><Copy aria-hidden="true" /></Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Insert ${attachment.name}`} onClick={() => onInsert([attachmentMarkdown(notePath, attachment)])}><Check aria-hidden="true" /></Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Delete ${attachment.name}`} onClick={() => { setDeleting(attachment); setDeleteError(''); }}><Trash2 aria-hidden="true" /></Button>
                </div>
              </li>;
              })}
            </ul>}
        </ScrollArea>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={deleting !== null} onOpenChange={(value) => { if (!value) setDeleting(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete attachment?</AlertDialogTitle>
          <AlertDialogDescription>{deleting && (deleting.references.length > 0 || markdownReferencesPath(noteBody, notePath, deleting.path)) ? `This file is referenced by ${deleting.references.length} saved note(s)${deleting.references.length ? `: ${deleting.references.slice(0, 5).join(', ')}${deleting.references.length > 5 ? `, and ${deleting.references.length - 5} more` : ''}` : ''}${markdownReferencesPath(noteBody, notePath, deleting.path) ? ' and the current draft' : ''}. Deleting it will leave those Markdown links unresolved.` : 'This removes the file from the active vault. This cannot be undone except by restoring a backup.'}</AlertDialogDescription>
        </AlertDialogHeader>
        {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => deleting && void remove(deleting)}>{busy ? 'Deleting…' : 'Delete file'}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
