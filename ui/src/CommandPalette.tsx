import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Bookmark,
  CircleHelp,
  Compass,
  CopyPlus,
  Database,
  FileText,
  GitMerge,
  FolderClosed,
  FolderOpen,
  HardDrive,
  History,
  Keyboard,
  ListFilter,
  ListTodo,
  Maximize2,
  Minimize2,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Settings,
  Sun,
  Trash2,
  Workflow,
} from 'lucide-react';
import type { NoteFilter, NoteFilterLogic } from '../../src/search/note-filters.js';
import type { RecentNote } from './recentNavigation';
import { useNoteSearch } from './useNoteSearch';
import { SearchResultContext } from './SearchResultContext';
import { Button } from '@/components/ui/button';
import { PageIcon } from './PageIcon';
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import type { View } from './types';
import {
  dedupeCommands,
  executeCommand,
  groupCommands,
  searchCommands,
  type CommandCategory,
  type CommandLike,
} from './commands';
import {
  detectPlatform,
  shortcutById,
  shortcutLabel,
  type ShortcutId,
} from './shortcuts';

export interface PaletteCommand extends CommandLike {
  icon: ReactNode;
  shortcut?: ShortcutId;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

/**
 * Everything the palette needs from the application shell. Keeping the
 * context in one object lets the command list be built and tested as a pure
 * function without a full registry rewrite.
 */
export interface PaletteCommandDeps {
  recentNotes: readonly RecentNote[];
  onCreateNote: () => void | Promise<void>;
  onSaveNote?: () => void | Promise<void>;
  canSaveNote: boolean;
  onOpenNote: (id: string) => void | Promise<void>;
  onView: (view: View) => void;
  onOpenDatabase?: (id: string) => void;
  onOpenFolder?: (path: string) => void;
  onOpenRecent: () => void;
  onOpenShortcuts: () => void;
  databases: ReadonlyArray<{ id: string; name: string }>;
  folders: readonly string[];
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  sidebarCollapsed: boolean;
  canToggleSidebar: boolean;
  onToggleSidebar: () => void;
  onOpenGettingStarted: () => void;
  onOpenSearchFilters: () => void;
  onOpenSearchLibrary: () => void;
  onOpenSettingsSection: (section: 'backup') => void;
  onSwitchVault: () => void;
  canManageNote: boolean;
  onRenameNote: () => void;
  onDeleteNote: () => void;
  onReloadNote: () => void;
  canOpenAutomations: boolean;
  onOpenAutomations: () => void;
}

/**
 * Build the palette's command list from the current application context.
 * Context-dependent commands are registered but disabled when their
 * prerequisite (an open note, a database, desktop layout) is missing, so the
 * palette never offers an action that cannot run safely.
 */
export function buildPaletteCommands(deps: PaletteCommandDeps): PaletteCommand[] {
  const definitions: PaletteCommand[] = [
    ...deps.recentNotes.map((note): PaletteCommand => ({
      id: `recent:${note.id}`,
      title: note.title || 'Untitled note',
      keywords: `recent history ${note.path}`,
      category: 'Recent notes',
      icon: <PageIcon icon={null} className="size-4 text-[13px]" />,
      run: () => deps.onOpenNote(note.id),
    })),
    {
      id: 'new-note',
      title: 'New note',
      keywords: 'create page file',
      category: 'Notes',
      icon: <Plus />,
      shortcut: 'new-note',
      run: deps.onCreateNote,
    },
    ...(deps.onSaveNote === undefined ? [] : [{
      id: 'save-note',
      title: 'Save note',
      keywords: 'save write persist',
      category: 'Notes' as const,
      icon: <Save />,
      shortcut: 'save-note' as const,
      disabled: !deps.canSaveNote,
      run: deps.onSaveNote,
    }]),
    {
      id: 'recent-notes',
      title: 'Recent notes',
      keywords: 'history recently opened quick switcher',
      category: 'Notes',
      icon: <History />,
      shortcut: 'recent-notes',
      run: deps.onOpenRecent,
    },
    {
      id: 'rename-note',
      title: 'Rename note path',
      keywords: 'rename move note path title file',
      category: 'Notes',
      icon: <Pencil />,
      disabled: !deps.canManageNote,
      run: deps.onRenameNote,
    },
    {
      id: 'delete-note',
      title: 'Delete note',
      keywords: 'delete remove note trash',
      category: 'Notes',
      icon: <Trash2 />,
      disabled: !deps.canManageNote,
      run: deps.onDeleteNote,
    },
    {
      id: 'reload-note',
      title: 'Reload note from disk',
      keywords: 'reload refresh external change disk',
      category: 'Notes',
      icon: <RefreshCw />,
      disabled: !deps.canManageNote,
      run: deps.onReloadNote,
    },
    {
      id: 'view-notes',
      title: 'All notes',
      keywords: 'workspace pages home',
      category: 'Navigation',
      icon: <FileText />,
      run: () => deps.onView('notes'),
    },
    {
      id: 'view-tasks',
      title: 'Tasks',
      keywords: 'todo checklist checkboxes open completed due priority',
      category: 'Navigation',
      icon: <ListTodo />,
      run: () => deps.onView('tasks'),
    },
    {
      id: 'view-conflicts',
      title: 'Conflicts',
      keywords: 'sync conflict resolution relay',
      category: 'Navigation',
      icon: <GitMerge />,
      run: () => deps.onView('conflicts'),
    },
    {
      id: 'view-discovery',
      title: 'Knowledge discovery',
      keywords: 'unresolved wiki links orphan notes discoveries',
      category: 'Navigation',
      icon: <Compass />,
      run: () => deps.onView('discovery'),
    },
    {
      id: 'view-graph',
      title: 'Local graph',
      keywords: 'links connections explore network',
      category: 'Navigation',
      icon: <Network />,
      run: () => deps.onView('graph'),
    },
    {
      id: 'view-insights',
      title: 'Knowledge health',
      keywords: 'insights analytics clusters metrics graph health',
      category: 'Navigation',
      icon: <Activity />,
      run: () => deps.onView('insights'),
    },
    {
      id: 'view-organization',
      title: 'Smart organization',
      keywords: 'tags duplicates folders metadata suggestions organize',
      category: 'Navigation',
      icon: <Sparkles />,
      run: () => deps.onView('organization'),
    },
    {
      id: 'view-databases',
      title: 'Databases',
      keywords: 'tables records schemas',
      category: 'Navigation',
      icon: <Database />,
      run: () => deps.onView('databases'),
    },
    {
      id: 'view-templates',
      title: 'Templates',
      keywords: 'reusable note database structures apply template create from',
      category: 'Navigation',
      icon: <CopyPlus />,
      run: () => deps.onView('templates'),
    },
    {
      id: 'view-settings',
      title: 'Settings',
      keywords: 'preferences workspace layout sidebar panels presets vault storage theme',
      category: 'Navigation',
      icon: <Settings />,
      run: () => deps.onView('settings'),
    },
    {
      id: 'backup-restore',
      title: 'Backup and restore',
      keywords: 'backup restore snapshot recover archive create validate',
      category: 'Navigation',
      icon: <HardDrive />,
      run: () => deps.onOpenSettingsSection('backup'),
    },
    {
      id: 'import-export',
      title: 'Import or export workspace',
      keywords: 'import export portable archive migrate merge restore',
      category: 'Navigation',
      icon: <ArrowLeftRight />,
      run: () => deps.onOpenSettingsSection('backup'),
    },
    {
      id: 'switch-vault',
      title: 'Open another vault',
      keywords: 'vault switch folder workspace open change',
      category: 'Navigation',
      icon: <FolderOpen />,
      run: deps.onSwitchVault,
    },
    {
      id: 'toggle-focus-mode',
      title: deps.focusMode ? 'Exit focus mode' : 'Enter focus mode',
      keywords: 'focus mode hide sidebar distraction writing zen',
      category: 'Navigation',
      icon: deps.focusMode ? <Minimize2 /> : <Maximize2 />,
      disabled: !deps.canToggleSidebar && !deps.focusMode,
      run: deps.onToggleFocusMode,
    },
    {
      id: 'toggle-sidebar',
      title: deps.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar',
      keywords: 'sidebar show hide collapse expand panel navigation',
      category: 'Navigation',
      icon: deps.sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />,
      disabled: !deps.canToggleSidebar,
      run: deps.onToggleSidebar,
    },
    {
      id: 'search-filters',
      title: 'Search filters',
      keywords: 'filter metadata tag property refine narrow search',
      category: 'Search',
      icon: <ListFilter />,
      run: deps.onOpenSearchFilters,
    },
    {
      id: 'search-library',
      title: 'Saved searches',
      keywords: 'search library history saved bookmark recent queries',
      category: 'Search',
      icon: <Bookmark />,
      run: deps.onOpenSearchLibrary,
    },
    {
      id: 'toggle-theme',
      title: `Use ${deps.theme === 'light' ? 'dark' : 'light'} theme`,
      keywords: 'appearance color dark light mode',
      category: 'Appearance',
      icon: deps.theme === 'light' ? <Moon /> : <Sun />,
      run: deps.onToggleTheme,
    },
    {
      id: 'getting-started',
      title: 'Getting started guide',
      keywords: 'onboarding tutorial tour help learn first steps',
      category: 'Help',
      icon: <CircleHelp />,
      run: deps.onOpenGettingStarted,
    },
    {
      id: 'keyboard-shortcuts',
      title: 'Keyboard shortcuts',
      keywords: 'keybindings keys help reference',
      category: 'Help',
      icon: <Keyboard />,
      shortcut: 'shortcut-reference',
      run: deps.onOpenShortcuts,
    },
    {
      id: 'database-automations',
      title: 'Database automations',
      keywords: 'automation workflow trigger condition action rules',
      category: 'Databases',
      icon: <Workflow />,
      disabled: !deps.canOpenAutomations,
      run: deps.onOpenAutomations,
    },
    ...deps.databases.map((database): PaletteCommand => ({
      id: `database:${database.id}`,
      title: database.name,
      keywords: `database open switch ${database.id}`,
      category: 'Databases',
      icon: <Database />,
      run: () => deps.onOpenDatabase?.(database.id),
    })),
    ...deps.folders.map((folder): PaletteCommand => ({
      id: `folder:${folder}`,
      title: `Open folder: ${folder}`,
      keywords: `folder navigate path ${folder}`,
      category: 'Folders',
      showInEmpty: false,
      icon: <FolderClosed />,
      run: () => deps.onOpenFolder?.(folder),
    })),
  ];
  return dedupeCommands(definitions);
}

interface CommandPaletteProps {
  vaultKey?: string;
  revision?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  onCreateNote: () => void | Promise<void>;
  onSaveNote?: () => void | Promise<void>;
  canSaveNote?: boolean;
  onOpenNote: (id: string) => void | Promise<void>;
  onView: (view: View) => void;
  onOpenDatabase?: (id: string) => void;
  onOpenFolder?: (path: string) => void;
  onOpenRecent: () => void;
  onOpenShortcuts: () => void;
  databases?: ReadonlyArray<{ id: string; name: string }>;
  folders?: readonly string[];
  recentNotes?: readonly RecentNote[];
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  filters?: readonly NoteFilter[];
  filterLogic?: NoteFilterLogic;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  sidebarCollapsed: boolean;
  canToggleSidebar: boolean;
  onToggleSidebar: () => void;
  onOpenGettingStarted: () => void;
  onOpenSearchFilters: () => void;
  onOpenSearchLibrary: () => void;
  onOpenSettingsSection: (section: 'backup') => void;
  onSwitchVault: () => void;
  canManageNote: boolean;
  onRenameNote: () => void;
  onDeleteNote: () => void;
  onReloadNote: () => void;
  canOpenAutomations: boolean;
  onOpenAutomations: () => void;
}

export function CommandPalette({
  vaultKey = '',
  revision = 0,
  open,
  onOpenChange,
  returnFocusRef,
  fallbackFocusRef,
  onCreateNote,
  onSaveNote,
  canSaveNote = false,
  onOpenNote,
  onView,
  onOpenDatabase,
  onOpenFolder,
  onOpenRecent,
  onOpenShortcuts,
  databases = [],
  folders = [],
  recentNotes = [],
  theme,
  onToggleTheme,
  filters = [],
  filterLogic = 'and',
  focusMode,
  onToggleFocusMode,
  sidebarCollapsed,
  canToggleSidebar,
  onToggleSidebar,
  onOpenGettingStarted,
  onOpenSearchFilters,
  onOpenSearchLibrary,
  onOpenSettingsSection,
  onSwitchVault,
  canManageNote,
  onRenameNote,
  onDeleteNote,
  onReloadNote,
  canOpenAutomations,
  onOpenAutomations,
}: CommandPaletteProps) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);
  const [query, setQuery] = useState('');
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<PaletteCommand | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  // Same query + same filters as the sidebar must produce the same results.
  const { results, searching, error, retry, metadataIssueCount, catalogIssue } = useNoteSearch(query, vaultKey, revision, open, filters, filterLogic);
  const platform = detectPlatform();

  useEffect(() => {
    if (!open) {
      setQuery('');
      setExecutionError(null);
      setLastCommand(null);
      setRunningId(null);
    }
  }, [open]);

  const commands = useMemo(() => buildPaletteCommands({
    recentNotes,
    onCreateNote,
    onSaveNote,
    canSaveNote,
    onOpenNote,
    onView,
    onOpenDatabase,
    onOpenFolder,
    onOpenRecent,
    onOpenShortcuts,
    databases,
    folders,
    theme,
    onToggleTheme,
    focusMode,
    onToggleFocusMode,
    sidebarCollapsed,
    canToggleSidebar,
    onToggleSidebar,
    onOpenGettingStarted,
    onOpenSearchFilters,
    onOpenSearchLibrary,
    onOpenSettingsSection,
    onSwitchVault,
    canManageNote,
    onRenameNote,
    onDeleteNote,
    onReloadNote,
    canOpenAutomations,
    onOpenAutomations,
  }), [
    canManageNote,
    canOpenAutomations,
    canSaveNote,
    canToggleSidebar,
    databases,
    focusMode,
    folders,
    onDeleteNote,
    onOpenAutomations,
    onOpenDatabase,
    onOpenFolder,
    onOpenGettingStarted,
    onOpenNote,
    onOpenRecent,
    onOpenSearchFilters,
    onOpenSearchLibrary,
    onOpenSettingsSection,
    onOpenShortcuts,
    onReloadNote,
    onRenameNote,
    onSaveNote,
    onSwitchVault,
    onToggleFocusMode,
    onToggleSidebar,
    onToggleTheme,
    onCreateNote,
    onView,
    recentNotes,
    sidebarCollapsed,
    theme,
  ]);

  const visibleCommands = useMemo(() => {
    // Recent notes are a convenience launchpad for the empty state. Once the
    // user searches, server-ranked note results own that surface.
    const searchable = query.trim() === ''
      ? commands
      : commands.filter((command) => command.category !== 'Recent notes');
    return searchCommands(searchable, query);
  }, [commands, query]);
  const commandGroups = useMemo(() => groupCommands(visibleCommands), [visibleCommands]);
  // Mirror the sidebar: a non-empty query or any active metadata filter means
  // server-ranked note results own the surface.
  const noteResultsVisible = query.trim() !== '' || filters.length > 0;
  const noResults = !searching && error === null && visibleCommands.length === 0
    && (!noteResultsVisible || results.length === 0);

  const close = () => onOpenChange(false);

  const execute = async (command: PaletteCommand): Promise<void> => {
    if (runningId !== null || command.disabled === true) return;
    setExecutionError(null);
    setLastCommand(command);
    setRunningId(command.id);
    const result = await executeCommand(command);
    setRunningId(null);
    if (result.ok) {
      restoreFocusRef.current = false;
      close();
      return;
    }
    setExecutionError(result.error ?? 'The command could not be completed.');
  };

  const onChange = (value: string) => {
    setQuery(value);
    if (executionError !== null) setExecutionError(null);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search notes or run a workspace command."
      className="sm:max-w-[560px]"
      shouldFilter={false}
      onOpenAutoFocus={() => {
        restoreFocusRef.current = true;
        previousFocusRef.current = returnFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      }}
      onCloseAutoFocus={(event) => {
        const captured = returnFocusRef?.current ?? previousFocusRef.current;
        const previous = captured === document.body ? fallbackFocusRef?.current : captured ?? fallbackFocusRef?.current;
        if (restoreFocusRef.current && previous?.isConnected) {
          event.preventDefault();
          window.requestAnimationFrame(() => {
            if (previous.isConnected && !previous.closest('[inert]')) previous.focus();
          });
        }
      }}
    >
      <CommandInput
        value={query}
        onValueChange={onChange}
        aria-label="Search notes or commands"
        placeholder="Search notes or type a command…"
        autoFocus
      />
      <CommandList aria-busy={searching} className="max-h-[min(420px,60vh)]" aria-label="Command results">
        {executionError === null ? null : (
          <div className="mx-1 mb-1 flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive" role="alert">
            <span>{executionError}</span>
            {lastCommand === null ? null : (
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => void execute(lastCommand)}>
                Try again
              </Button>
            )}
          </div>
        )}

        {error === null ? null : (
          <div className="flex flex-col items-center gap-2 py-4 text-center text-sm text-destructive" role="alert">
            {error}
            <Button type="button" variant="outline" size="sm" onClick={retry}>Retry search</Button>
          </div>
        )}

        {noResults ? (
          <div className="py-6 text-center text-sm text-muted-foreground" role="status">
            No commands or notes match “{query.trim()}”.
          </div>
        ) : null}

        {commandGroups.map(({ category, commands: items }) => (
          <CommandGroup key={category} heading={category}>
            {items.map((command) => (
              <CommandItem
                key={command.id}
                value={`${command.id} ${command.title} ${command.keywords ?? ''}`}
                disabled={command.disabled === true || runningId !== null}
                onSelect={() => { void execute(command); }}
                aria-label={command.title}
              >
                {command.icon}
                <span className="min-w-0 flex-1 truncate">{command.title}</span>
                {command.shortcut === undefined ? null : (
                  <CommandShortcut>{shortcutLabel(shortcutById(command.shortcut).binding, platform)}</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        {noteResultsVisible ? (
          <>
            {visibleCommands.length === 0 || results.length === 0 || searching ? null : <CommandSeparator />}
            {searching && results.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground" role="status">Searching notes…</div>
            ) : null}
            {catalogIssue !== undefined && results.length > 0 ? (
              <p role="status" className="px-3 pb-1 text-[11px] text-amber-700 dark:text-amber-300">Metadata search is limited because the property catalog could not be read.</p>
            ) : null}
            {metadataIssueCount > 0 && results.length > 0 ? (
              <p role="status" className="px-3 pb-1 text-[11px] text-muted-foreground">{metadataIssueCount} registered property {metadataIssueCount === 1 ? 'value is' : 'values are'} invalid and excluded from search and filters.</p>
            ) : null}
            {results.length === 0 ? null : (
              <CommandGroup key={`${query.trim()}:${vaultKey}:${revision}`} heading="Notes">
                {results.map((result) => (
                  <CommandItem
                    key={result.id}
                    value={`note:${result.id}`}
                    onSelect={() => { void execute({
                      id: `note:${result.id}`,
                      title: result.title,
                      category: 'Notes',
                      icon: null,
                      run: () => onOpenNote(result.id),
                    }); }}
                    aria-label={`Open ${result.title}`}
                  >
                    <PageIcon icon={result.icon} className="size-4 text-[13px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{result.title}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{result.path}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        <SearchResultContext result={result} />
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.length === 50 ? (
              <p role="status" className="px-3 pb-1 text-[11px] text-muted-foreground">Top 50 matches</p>
            ) : null}
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
