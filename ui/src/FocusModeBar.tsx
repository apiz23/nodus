import { Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Shown on desktop while focus mode hides the sidebar, on every view. Focus
 * mode previously had no exit outside the editor header, so users who switched
 * views could lose the only visible recovery control. The palette also exposes
 * an exit command; this bar keeps recovery obvious without adding state.
 */
export function FocusModeBar({ onExit }: { onExit: () => void }) {
  return (
    <div className="hidden h-9 shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-3 md:flex">
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Minimize2 className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">Focus mode is on — the sidebar is hidden.</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 text-xs"
        onClick={onExit}
        aria-label="Exit focus mode"
      >
        Exit focus mode
      </Button>
    </div>
  );
}
