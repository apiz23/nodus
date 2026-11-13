import { useState } from 'react';
import { Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { WorkspacePreferences } from './workspacePreferences';
import { BacklinksPanel } from './BacklinksPanel';
import { RelationBacklinksPanel } from './RelationBacklinksPanel';
import { RelatedNotesPanel } from './RelatedNotesPanel';

/** Keep note context together without changing the underlying panel data or preferences. */
export function ConnectionsSheet({ panels, noteId, title, revision, onOpenNote }: {
  panels: WorkspacePreferences['panels'];
  noteId: string;
  title: string;
  revision: number;
  onOpenNote: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const navigate = (id: string) => {
    setOpen(false);
    onOpenNote(id);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label="Open note connections">
          <Network data-icon="inline-start" />
          <span className="hidden sm:inline">Connections</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="min-w-0 gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Connections</SheetTitle>
          <SheetDescription className="break-words">Links and related notes for {title}. This information is separate from your Markdown.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
          <p className="text-xs text-muted-foreground">Sections follow your workspace panel settings.</p>
          {open ? <div className="flex min-w-0 flex-col gap-6 [&_section]:mt-0 [&_section]:border-0 [&_section]:pt-0">
            {panels.backlinks ? <BacklinksPanel noteId={noteId} revision={revision} onOpenNote={navigate} /> : null}
            {panels.relationBacklinks ? <RelationBacklinksPanel noteId={noteId} revision={revision} onOpenNote={navigate} /> : null}
            {panels.relatedNotes ? <RelatedNotesPanel key={`${noteId}:${revision}`} noteId={noteId} revision={revision} onOpenNote={navigate} /> : null}
          </div> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
