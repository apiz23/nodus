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
  X,
} from 'lucide-react';
import type { UiNoteSummary, UiSearchResult, UiVaultStatus } from '../../src/ui-server/dto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { PageTree } from './PageTree';
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
  notes: UiNoteSummary[];
  results: UiSearchResult[];
  selectedId: string | null;
  loading: boolean;
  searching: boolean;
  searchError: string | null;
  onOpen: (id: string) => void;
  onClearSearch: () => void;
  onRetry: () => void;
  open: boolean;
  onClose: () => void;
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
  notes,
  results,
  selectedId,
  loading,
  searching,
  searchError,
  onOpen,
  onClearSearch,
  onRetry,
  open,
  onClose,
}: SidebarProps) {
  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden dark:bg-black/40"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[280px] shrink-0 flex-col gap-2 border-r border-sidebar-border bg-sidebar px-2.5 py-3 transition-transform duration-150',
          'md:static md:z-auto md:w-[240px]',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
        aria-label="Workspace navigation"
      >
        <div className="flex items-center gap-2 px-1">
          <div className="grid size-6 shrink-0 place-items-center rounded-[4px] bg-sidebar-accent text-[11px] font-semibold text-sidebar-foreground">
            N
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-semibold tracking-tight">Nodus</div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto md:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X />
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            type="search"
            aria-label="Search notes"
            value={query}
            placeholder="Search pages"
            autoComplete="off"
            className="h-7 rounded-md border-transparent bg-transparent pr-2 pl-7 text-[12.5px] hover:bg-sidebar-accent focus-visible:bg-sidebar-accent md:text-[13px] dark:bg-transparent"
            onChange={(event) => {
              onQueryChange(event.target.value);
              if (view !== 'notes') onView('notes');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onQueryChange('');
                event.currentTarget.blur();
              }
            }}
          />
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start gap-1.5 px-2 text-[13px] font-normal text-muted-foreground hover:text-foreground"
          onClick={onCreate}
          disabled={creating}
        >
          <Plus data-icon="inline-start" className="size-4" />
          {creating ? 'Creating…' : 'New page'}
        </Button>

        <nav className="flex flex-col gap-0.5" aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            const selected = view === item.id;
            const highlighted = selected && item.id !== 'notes';
            return (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 w-full justify-start gap-2 px-2 text-[13px] font-normal text-muted-foreground hover:text-foreground',
                  highlighted && 'bg-sidebar-accent font-medium text-sidebar-foreground',
                )}
                aria-current={selected ? 'page' : undefined}
                onClick={() => {
                  onView(item.id);
                  onClose();
                }}
              >
                <Icon data-icon="inline-start" className="size-4 text-muted-foreground" />
                {item.label}
              </Button>
            );
          })}
        </nav>

        {view === 'notes' ? (
          <PageTree
            notes={notes}
            results={results}
            query={query}
            selectedId={selectedId}
            loading={loading}
            searching={searching}
            error={searchError}
            onCreate={onCreate}
            onOpen={onOpen}
            onClearSearch={onClearSearch}
            onRetry={onRetry}
          />
        ) : (
          <div className="flex-1" />
        )}

        <div className="border-t border-sidebar-border px-1 pt-2.5">
          <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-sidebar-foreground">
            <span className="size-1.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
            <span className="truncate">{status?.vault.name ?? 'Opening vault…'}</span>
          </div>
          <p
            className="mt-1 truncate pl-3 font-mono text-[10px] text-muted-foreground"
            title={status?.vault.path}
          >
            {status?.vault.path ?? 'Waiting for local storage'}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-sidebar-border px-1 pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <CloudOff className="size-3.5 shrink-0" />
                <div className="min-w-0 truncate text-[11px]">
                  {status?.sync.label ?? 'Checking sync'}
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
    </>
  );
}
