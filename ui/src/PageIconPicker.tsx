import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const selectedVisible = value !== null && filtered.some((choice) => choice.emoji === value);

  const choose = (icon: string | null) => {
    onSelect(icon);
    onOpenChange(false);
    setQuery('');
  };

  function handleIconKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
    const index = options.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    const columns = 8;
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowRight'
          ? Math.min(index + 1, options.length - 1)
          : event.key === 'ArrowLeft'
            ? Math.max(index - 1, 0)
            : event.key === 'ArrowDown'
              ? Math.min(index + columns, options.length - 1)
              : Math.max(index - columns, 0);
    options[next]?.focus();
  }

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
        <Input
          id="page-icon-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search icons…"
          autoComplete="off"
          className="h-8 text-sm"
        />

        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground" role="status">No matching icons.</p>
        ) : (
          <div
            role="listbox"
            aria-label="Page icons"
            className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto p-1"
            onKeyDown={handleIconKeyDown}
          >
            {filtered.map((choice, index) => {
              const selected = value === choice.emoji;
              return (
                <Button
                  key={choice.emoji}
                  type="button"
                  variant="ghost"
                  size="icon"
                  role="option"
                  aria-selected={selected}
                  aria-label={choice.name}
                  title={choice.name}
                  tabIndex={selected || (!selectedVisible && index === 0) ? 0 : -1}
                  className={cn('text-lg', selected && 'bg-muted ring-1 ring-ring/40')}
                  onClick={() => choose(choice.emoji)}
                >
                  <span aria-hidden="true">{choice.emoji}</span>
                </Button>
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
