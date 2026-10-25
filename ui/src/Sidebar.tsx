import type { RefObject } from 'react';
import {
  CloudOff,
  Database,
  FileText,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import type { UiVaultStatus } from '../../src/ui-server/dto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { View } from './types';

interface SidebarProps {
  view: View;
  onView: (view: View) => void;
  query: string;
  onQueryChange: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onCreate: () => void;
  creating: boolean;
  status: UiVaultStatus | null;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const navItems = [
  { id: 'notes' as const, label: 'All notes', icon: FileText },
  { id: 'databases' as const, label: 'Databases', icon: Database },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
];

export function Sidebar({
  view,
  onView,
  query,
  onQueryChange,
  searchRef,
  onCreate,
  creating,
  status,
  theme,
  onToggleTheme,
}: SidebarProps) {
  return (
    <aside className="flex shrink-0 flex-col gap-2 border-b border-sidebar-border bg-sidebar px-2.5 py-2.5 lg:h-full lg:w-[232px] lg:gap-3 lg:border-r lg:border-b-0 lg:px-3 lg:py-4">
      <div className="flex items-center gap-2">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold tracking-tight text-primary-foreground">
          N
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold tracking-tight">Nodus</div>
          <div className="text-[11px] text-muted-foreground">Local notes</div>
        </div>
        <div className="ml-auto flex items-center gap-1 lg:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCreate}
            disabled={creating}
            aria-label="New note"
          >
            <Plus />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? <Moon /> : <Sun />}
          </Button>
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        className="hidden w-full justify-center gap-1.5 lg:inline-flex"
        onClick={onCreate}
        disabled={creating}
      >
        <Plus data-icon="inline-start" />
        {creating ? 'Creating…' : 'New note'}
      </Button>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="Search notes"
          autoComplete="off"
          className="h-8 bg-background pl-8 pr-12 text-xs"
          onChange={(event) => {
            onQueryChange(event.target.value);
            onView('notes');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onQueryChange('');
              event.currentTarget.blur();
            }
          }}
        />
        <Kbd className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[10px]">
          ⌘K
        </Kbd>
      </div>

      <nav
        className="flex gap-1 overflow-x-auto pb-0.5 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0"
        aria-label="Primary"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const selected = view === item.id;
          return (
            <Button
              key={item.id}
              type="button"
              variant={selected ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'h-8 shrink-0 justify-start gap-2 px-2.5 text-[12.5px] lg:w-full',
                selected && 'font-medium',
              )}
              aria-current={selected ? 'page' : undefined}
              onClick={() => onView(item.id)}
            >
              <Icon data-icon="inline-start" />
              <span className="hidden sm:inline">{item.label}</span>
            </Button>
          );
        })}
      </nav>

      <div className="hidden flex-1 lg:block" />

      <div className="hidden border-t border-sidebar-border px-1 pt-3 lg:block">
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
          <span className="truncate">{status?.vault.name ?? 'Opening vault…'}</span>
        </div>
        <p
          className="mt-1 truncate pl-3 font-mono text-[10px] text-muted-foreground"
          title={status?.vault.path}
        >
          {status?.vault.path ?? 'Waiting for local storage'}
        </p>
      </div>

      <div className="hidden items-center justify-between gap-2 border-t border-sidebar-border px-1 pt-3 lg:flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <CloudOff className="size-3.5 shrink-0" />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[11px]">{status?.sync.label ?? 'Checking sync'}</div>
                <div className="text-[9px] tracking-wide text-muted-foreground/70 uppercase">
                  Phase 4
                </div>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
            {status?.sync.detail ?? 'The Phase 4 sync client is not implemented.'}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onToggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            >
              {theme === 'light' ? <Moon /> : <Sun />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            Switch to {theme === 'light' ? 'dark' : 'light'} theme
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
