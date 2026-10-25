import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { PAGE_ICONS } from './pageIcons';

interface PageIconPickerProps {
  open: boolean;
  value: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (icon: string | null) => void;
}

export function PageIconPicker({ open, value, onOpenChange, onSelect }: PageIconPickerProps) {
  const [query, setQuery] = useState('');

  const filtered = PAGE_ICONS.filter((choice) =>
    choice.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const choose = (icon: string | null) => {
    onSelect(icon);
    onOpenChange(false);
    setQuery('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Page icon</DialogTitle>
          <DialogDescription>
            Pick a small marker for this page. It is stored as optional frontmatter and stays
            readable outside Nodus.
          </DialogDescription>
        </DialogHeader>

        <label className="sr-only" htmlFor="page-icon-search">
          Search icons
        </label>
        <input
          id="page-icon-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search icons…"
          autoComplete="off"
          className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/80"
        />

        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No matching icons.</p>
        ) : (
          <div
            role="listbox"
            aria-label="Page icons"
            className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto p-1"
          >
            {filtered.map((choice) => {
              const selected = value === choice.emoji;
              return (
                <button
                  key={choice.emoji}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={choice.name}
                  title={choice.name}
                  className={cn(
                    'grid size-8 place-items-center rounded-md text-lg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80',
                    selected && 'bg-muted ring-1 ring-ring/40',
                  )}
                  onClick={() => choose(choice.emoji)}
                >
                  <span aria-hidden="true">{choice.emoji}</span>
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => choose(null)}>
            Remove icon
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
