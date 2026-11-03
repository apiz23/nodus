import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  Compass,
  CopyPlus,
  Database,
  FileText,
  FolderClosed,
  History,
  Keyboard,
  Moon,
  Network,
  Plus,
  Save,
  Settings,
  Sun,
} from 'lucide-react';
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

interface PaletteCommand extends CommandLike {
  icon: ReactNode;
  shortcut?: ShortcutId;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

interface CommandPaletteProps {
  vaultKey?: string;
  revision?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
}

export function CommandPalette({
  vaultKey = '',
  revision = 0,
  open,
  onOpenChange,
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
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<PaletteCommand | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const { results, searching, error, retry } = useNoteSearch(query, vaultKey, revision, open);
  const platform = detectPlatform();

  useEffect(() => {
    if (!open) {
      setQuery('');
      setExecutionError(null);
      setLastCommand(null);
      setRunningId(null);
    }
  }, [open]);

  const commands = useMemo(() => {
    const definitions: PaletteCommand[] = [
      ...recentNotes.map((note): PaletteCommand => ({
        id: `recent:${note.id}`,
        title: note.title || 'Untitled note',
        keywords: `recent history ${note.path}`,
        category: 'Recent notes',
        icon: <PageIcon icon={null} className="size-4 text-[13px]" />,
        run: () => onOpenNote(note.id),
      })),
      {
        id: 'new-note',
        title: 'New note',
        keywords: 'create page file',
        category: 'Notes',
        icon: <Plus />,
        shortcut: 'new-note',
        run: onCreateNote,
      },
      ...(onSaveNote === undefined ? [] : [{
        id: 'save-note',
        title: 'Save note',
        keywords: 'save write persist',
        category: 'Notes' as const,
        icon: <Save />,
        shortcut: 'save-note' as const,
        disabled: !canSaveNote,
        run: onSaveNote,
      }]),
      {
        id: 'recent-notes',
        title: 'Recent notes',
        keywords: 'history recently opened quick switcher',
        category: 'Notes',
        icon: <History />,
        shortcut: 'recent-notes',
        run: onOpenRecent,
      },
      {
        id: 'view-notes',
        title: 'All notes',
        keywords: 'workspace pages home',
        category: 'Navigation',
        icon: <FileText />,
        run: () => onView('notes'),
      },
      {
        id: 'view-discovery',
        title: 'Knowledge discovery',
        keywords: 'unresolved wiki links orphan notes discoveries',
        category: 'Navigation',
        icon: <Compass />,
        run: () => onView('discovery'),
      },
      {
        id: 'view-graph',
        title: 'Local graph',
        keywords: 'links connections explore network',
        category: 'Navigation',
        icon: <Network />,
        run: () => onView('graph'),
      },
      {
        id: 'view-insights',
        title: 'Knowledge health',
        keywords: 'insights analytics clusters metrics graph health',
        category: 'Navigation',
        icon: <Activity />,
        run: () => onView('insights'),
      },
      {
        id: 'view-databases',
        title: 'Databases',
        keywords: 'tables records schemas',
        category: 'Navigation',
        icon: <Database />,
        run: () => onView('databases'),
      },
      {
        id: 'view-templates',
        title: 'Templates',
        keywords: 'reusable note database structures',
        category: 'Navigation',
        icon: <CopyPlus />,
        run: () => onView('templates'),
      },
      {
        id: 'view-settings',
        title: 'Settings',
        keywords: 'preferences vault storage theme',
        category: 'Navigation',
        icon: <Settings />,
        run: () => onView('settings'),
      },
      {
        id: 'toggle-theme',
        title: `Use ${theme === 'light' ? 'dark' : 'light'} theme`,
        keywords: 'appearance color dark light mode',
        category: 'Appearance',
        icon: theme === 'light' ? <Moon /> : <Sun />,
        run: onToggleTheme,
      },
      {
        id: 'keyboard-shortcuts',
        title: 'Keyboard shortcuts',
        keywords: 'keybindings keys help reference',
        category: 'Help',
        icon: <Keyboard />,
        shortcut: 'shortcut-reference',
        run: onOpenShortcuts,
      },
      ...databases.map((database): PaletteCommand => ({
        id: `database:${database.id}`,
        title: database.name,
        keywords: `database open switch ${database.id}`,
        category: 'Databases',
        icon: <Database />,
        run: () => onOpenDatabase?.(database.id),
      })),
      ...folders.map((folder): PaletteCommand => ({
        id: `folder:${folder}`,
        title: `Open folder: ${folder}`,
        keywords: `folder navigate path ${folder}`,
        category: 'Folders',
        showInEmpty: false,
        icon: <FolderClosed />,
        run: () => onOpenFolder?.(folder),
      })),
    ];
    return dedupeCommands(definitions);
  }, [
    canSaveNote,
    databases,
    folders,
    onCreateNote,
    onOpenDatabase,
    onOpenFolder,
    onOpenNote,
    onOpenRecent,
    onOpenShortcuts,
    onSaveNote,
    onToggleTheme,
    onView,
    recentNotes,
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
  const noteResultsVisible = query.trim() !== '';
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

        {query.trim() === '' ? null : (
          <>
            {visibleCommands.length === 0 || results.length === 0 || searching ? null : <CommandSeparator />}
            {searching && results.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground" role="status">Searching notes…</div>
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
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
