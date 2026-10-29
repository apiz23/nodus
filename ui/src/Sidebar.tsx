import { useEffect, useRef, type RefObject } from 'react';
import {
  ChevronDown,
  Database,
  Compass,
  FileText,
  FolderClosed,
  FolderOpen,
  Moon,
  Network,
  Plus,
  Search,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import type { UiNoteSummary, UiSearchResult, UiVaultStatus } from '../../src/ui-server/dto';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { PageTree } from './PageTree';
import { modShortcut } from './format';
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
  onRenameNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onClearSearch: () => void;
  onRetry: () => void;
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onExpandForSearch: () => void;
  onOpenAnotherVault: () => void;
  switchingVault: boolean;
  navigationLocked: boolean;
}

const navItems = [
  { id: 'notes' as const, label: 'All notes', icon: FileText },
  { id: 'discovery' as const, label: 'Discovery', icon: Compass },
  { id: 'graph' as const, label: 'Local graph', icon: Network },
  { id: 'databases' as const, label: 'Databases', icon: Database },
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
  onRenameNote,
  onDeleteNote,
  onClearSearch,
  onRetry,
  open,
  onClose,
  collapsed,
  onExpandForSearch,
  onOpenAnotherVault,
  switchingVault,
  navigationLocked,
}: SidebarProps) {
  const compact = collapsed && !open;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const aside = closeButtonRef.current?.closest('aside');
      const items = aside?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (items === undefined || items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
    };
  }, [open]);

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
          'fixed inset-y-0 left-0 z-50 flex min-h-0 w-[280px] shrink-0 flex-col gap-2 overflow-hidden border-r border-sidebar-border bg-sidebar px-2.5 py-3 transition-[width,transform] duration-150',
          compact ? 'md:static md:z-auto md:w-16 md:items-center md:px-2' : 'md:static md:z-auto md:w-[240px]',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
        aria-label="Workspace navigation"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-busy={navigationLocked || undefined}
        inert={navigationLocked || undefined}
      >
        <div className={cn('flex w-full items-center gap-2 px-1', compact && 'md:justify-center')}>
          <div className="grid size-6 shrink-0 place-items-center rounded-md bg-foreground text-[11px] font-semibold text-background">
            N
          </div>
          {compact ? null : (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[13px] font-semibold tracking-tight">Nodus</div>
              <div className="truncate text-[10.5px] text-muted-foreground">Local workspace</div>
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn('ml-auto md:hidden', compact && 'hidden')}
            onClick={onClose}
            aria-label="Close navigation"
            ref={closeButtonRef}
          >
            <X />
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size={compact ? 'icon' : 'default'}
              className={cn(
                'w-full min-w-0 justify-start border border-transparent text-left hover:border-sidebar-border hover:bg-sidebar-accent',
                compact ? 'md:size-9 md:justify-center' : 'h-[54px] gap-2 px-2',
              )}
              aria-label={`Vault menu: ${status?.vault.name ?? 'Loading vault'}`}
              title={compact ? status?.vault.name ?? 'Current vault' : undefined}
              disabled={navigationLocked}
            >
              <FolderClosed className="size-4 shrink-0 text-muted-foreground" />
              {compact ? null : (
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[12.5px] font-medium text-foreground">
                    {status?.vault.name ?? 'Opening vault…'}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] font-normal text-muted-foreground" title={status?.vault.path}>
                    {shortPath(status?.vault.path)}
                  </span>
                </span>
              )}
              {compact ? null : <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side={compact ? 'right' : 'bottom'} className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate font-medium text-foreground">{status?.vault.name ?? 'Current vault'}</span>
              <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground" title={status?.vault.path}>
                {status?.vault.path ?? 'Waiting for local storage'}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={navigationLocked} onSelect={onOpenAnotherVault}>
              <FolderOpen />
              {switchingVault ? 'Opening vault…' : 'Open another vault'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { onView('settings'); onClose(); }}>
              <Settings />
              Vault settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {compact ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Search notes" onClick={onExpandForSearch}>
                <Search />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Search notes ({modShortcut('k')})</TooltipContent>
          </Tooltip>
        ) : (
          <div className="relative w-full">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              type="search"
              aria-label="Search notes"
              value={query}
              placeholder="Search pages"
              autoComplete="off"
              className="h-7 rounded-md border-transparent bg-transparent pr-11 pl-7 text-[12.5px] hover:bg-sidebar-accent focus-visible:bg-sidebar-accent md:text-[13px] dark:bg-transparent"
              onChange={(event) => {
                onQueryChange(event.target.value);
                if (view !== 'notes') onView('notes');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  onQueryChange('');
                  event.currentTarget.blur();
                  return;
                }
                if (event.key === 'ArrowDown' || (event.key === 'Enter' && query.trim() !== '')) {
                  // Move focus from the search box into the first result/page.
                  const tree = event.currentTarget
                    .closest('aside')
                    ?.querySelector<HTMLElement>(
                      '[role="treeitem"], [data-search-result="true"]',
                    );
                  if (tree !== null && tree !== undefined) {
                    event.preventDefault();
                    if (event.key === 'Enter') tree.click();
                    else tree.focus();
                  }
                }
              }}
            />
            {query.trim() === '' ? (
              <kbd
                className="pointer-events-none absolute top-1/2 right-1.5 hidden -translate-y-1/2 rounded border border-sidebar-border bg-sidebar px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground select-none md:inline-block"
                aria-hidden="true"
              >
                {modShortcut('k')}
              </kbd>
            ) : null}
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 w-full justify-start gap-1.5 px-2 text-[13px] font-normal text-muted-foreground hover:text-foreground', compact && 'md:justify-center md:px-0')}
          onClick={onCreate}
          disabled={creating || navigationLocked}
          aria-label={compact ? 'New page' : undefined}
        >
          <Plus data-icon="inline-start" className="size-4" />
          {compact ? null : creating ? 'Creating…' : 'New page'}
        </Button>

        <nav className={cn('flex w-full flex-col gap-0.5', compact && 'md:items-center')} aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            const selected = view === item.id;
            return (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 w-full justify-start gap-2 px-2 text-[13px] font-normal text-muted-foreground hover:text-foreground',
                  compact && 'md:w-9 md:justify-center md:px-0',
                  selected && 'bg-success/12 font-medium text-foreground hover:bg-success/15',
                )}
                aria-current={selected ? 'page' : undefined}
                aria-label={compact ? item.label : undefined}
                title={compact ? item.label : undefined}
                disabled={navigationLocked}
                onClick={() => {
                  onView(item.id);
                  onClose();
                }}
              >
                <Icon
                  data-icon="inline-start"
                  className={cn('size-4', selected ? 'text-success' : 'text-muted-foreground')}
                />
                {compact ? null : item.label}
              </Button>
            );
          })}
        </nav>

        {compact ? null : (
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
            onRenameNote={onRenameNote}
            onDeleteNote={onDeleteNote}
            onClearSearch={onClearSearch}
            onRetry={onRetry}
          />
        )}

        <div className={cn('mt-auto w-full border-t border-sidebar-border px-1 pt-2.5', compact && 'md:flex md:flex-col md:items-center md:px-0')}>
          <Button
            type="button"
            variant="ghost"
            size={compact ? 'icon' : 'sm'}
            className={cn(
              'mb-1 h-7 w-full justify-start gap-2 px-2 text-[12px] font-normal text-muted-foreground hover:text-foreground',
              compact && 'md:size-9 md:justify-center md:px-0',
              view === 'settings' && 'bg-success/12 font-medium text-foreground hover:bg-success/15',
            )}
            aria-current={view === 'settings' ? 'page' : undefined}
            aria-label={compact ? 'Settings' : undefined}
            title={compact ? 'Settings' : undefined}
            disabled={navigationLocked}
            onClick={() => { onView('settings'); onClose(); }}
          >
            <Settings data-icon="inline-start" className={cn('size-4', view === 'settings' ? 'text-success' : 'text-muted-foreground')} />
            {compact ? null : 'Settings'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size={compact ? 'icon' : 'sm'}
            className={cn('h-7 w-full justify-start gap-1.5 px-1.5 text-[11px] font-normal text-muted-foreground hover:text-foreground', compact && 'md:size-9 md:justify-center md:px-0')}
            aria-label={`Storage health: ${status?.counts.issues ?? 0} ${status?.counts.issues === 1 ? 'issue' : 'issues'}. Open settings.`}
            title={compact ? `Storage health: ${status?.counts.issues ?? 0} ${status?.counts.issues === 1 ? 'issue' : 'issues'}` : undefined}
            onClick={() => { onView('settings'); onClose(); }}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                status === null ? 'bg-muted-foreground/40' : status.counts.issues > 0 ? 'bg-destructive' : 'bg-success',
              )}
              aria-hidden="true"
            />
            {compact ? null : <span className="truncate">{status?.counts.issues ? `${status.counts.issues} storage ${status.counts.issues === 1 ? 'issue' : 'issues'}` : 'Storage healthy'}</span>}
          </Button>
        </div>

        <div className={cn('flex w-full items-center justify-end gap-2 border-t border-sidebar-border px-1 pt-2', compact && 'md:justify-center')}>
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

function shortPath(path: string | undefined): string {
  if (path === undefined) return 'Waiting for local storage';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path;
}
