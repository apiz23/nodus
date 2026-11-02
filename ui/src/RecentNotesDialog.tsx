import { useEffect, useState } from 'react';
import { FileText, History } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { PageIcon } from './PageIcon';
import type { RecentNote } from './recentNavigation';

interface RecentNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: readonly RecentNote[];
  onOpenNote: (id: string) => void | Promise<void>;
}

/**
 * Fast keyboard-only switcher for recently opened notes. Entries are already
 * reconciled against the current note list by App, so deleted notes never
 * appear and moved notes show their current path.
 */
export function RecentNotesDialog({ open, onOpenChange, notes, onOpenNote }: RecentNotesDialogProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const openNote = (id: string) => {
    onOpenChange(false);
    void onOpenNote(id);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Recent notes"
      description="Jump to a recently opened note."
      className="sm:max-w-[520px]"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        aria-label="Search recent notes"
        placeholder="Search recent notes…"
        autoFocus
      />
      <CommandList aria-label="Recent notes" className="max-h-[min(360px,60vh)]">
        <CommandEmpty>No recently opened notes in this vault.</CommandEmpty>
        <CommandGroup heading="Recent notes">
          {notes.map((note) => (
            <CommandItem
              key={note.id}
              value={`${note.id} ${note.title} ${note.path}`}
              onSelect={() => openNote(note.id)}
              aria-label={`Open ${note.title || 'Untitled note'}`}
            >
              {note.title === '' ? <FileText /> : <PageIcon icon={null} className="size-4 text-[13px]" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{note.title || 'Untitled note'}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{note.path}</span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <div className="flex items-center gap-2 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <History className="size-3.5" aria-hidden="true" />
        <span>Notes are remembered per vault on this device.</span>
      </div>
    </CommandDialog>
  );
}
