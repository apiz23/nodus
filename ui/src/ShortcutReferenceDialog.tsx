import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { detectPlatform, shortcutsByGroup } from './shortcuts';

interface ShortcutReferenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Discoverability surface for the central shortcut registry. It reads the
 * same definitions used by the global key handler, so the reference cannot
 * drift from actual behavior.
 */
export function ShortcutReferenceDialog({ open, onOpenChange }: ShortcutReferenceDialogProps) {
  const platform = detectPlatform();
  const groups = shortcutsByGroup(platform);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(80vh,680px)] sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts respect focused text fields. The command palette can run every action without a shortcut.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[min(60vh,420px)] min-h-0 pr-3">
          <div className="flex flex-col gap-5">
            {groups.map(({ group, items }) => (
              <section key={group} aria-label={group}>
                <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{group}</h3>
                <ul className="flex flex-col gap-1">
                  {items.map(({ definition, label }) => (
                    <li key={definition.id} className="flex items-start justify-between gap-4 rounded-md px-1 py-1.5">
                      <span className="min-w-0">
                        <span className="block text-sm">{definition.label}</span>
                        <span className="block text-[11px] text-muted-foreground">{definition.description}</span>
                      </span>
                      <kbd className="mt-0.5 shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                        {label}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
