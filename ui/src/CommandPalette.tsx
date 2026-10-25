import { useEffect, useState } from 'react';
import {
  Database,
  FileText,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import type { UiSearchResult } from '../../src/ui-server/dto';
import { api, ApiError } from './api';
import { modShortcut } from './format';
import { PageIcon } from './PageIcon';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import type { View } from './types';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateNote: () => void;
  onOpenNote: (id: string) => void;
  onView: (view: View) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onCreateNote,
  onOpenNote,
  onView,
  theme,
  onToggleTheme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UiSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setError(null);
      setSearching(false);
    }
  }, [open]);

  useEffect(() => {
    const value = query.trim();
    if (value === '') {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setSearching(true);
    setError(null);
    const timer = window.setTimeout(() => {
      api
        .search(value)
        .then((response) => {
          if (!cancelled) setResults(response.results);
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setError(cause instanceof ApiError ? cause.message : 'Search failed.');
            setResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const close = () => onOpenChange(false);
  const run = (action: () => void) => {
    close();
    action();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search notes or run a workspace command."
      className="sm:max-w-[560px]"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search notes or type a command…"
      />
      <CommandList className="max-h-[min(420px,60vh)]">
        <CommandEmpty>
          {searching ? 'Searching…' : error ?? 'No results.'}
        </CommandEmpty>

        {query.trim() === '' ? (
          <>
            <CommandGroup heading="Workspace">
              <CommandItem value="new note create" onSelect={() => run(onCreateNote)}>
                <Plus />
                New note
                <CommandShortcut>{modShortcut('n')}</CommandShortcut>
              </CommandItem>
              <CommandItem value="all notes" onSelect={() => run(() => onView('notes'))}>
                <FileText />
                All notes
              </CommandItem>
              <CommandItem value="databases" onSelect={() => run(() => onView('databases'))}>
                <Database />
                Databases
              </CommandItem>
              <CommandItem value="settings" onSelect={() => run(() => onView('settings'))}>
                <Settings />
                Settings
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Appearance">
              <CommandItem value="toggle theme dark light" onSelect={() => run(onToggleTheme)}>
                {theme === 'light' ? <Moon /> : <Sun />}
                Use {theme === 'light' ? 'dark' : 'light'} theme
              </CommandItem>
            </CommandGroup>
          </>
        ) : (
          <CommandGroup heading={searching ? 'Searching notes…' : 'Notes'}>
            {results.map((result) => (
              <CommandItem
                key={result.id}
                value={`${result.title} ${result.path} ${result.snippet}`}
                onSelect={() => run(() => onOpenNote(result.id))}
              >
                <PageIcon icon={result.icon} className="size-4 text-[13px]" />
                <span className="min-w-0">
                  <span className="block truncate">{result.title}</span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                    {result.path}
                  </span>
                </span>
              </CommandItem>
            ))}
            {!searching && results.length === 0 && error === null ? (
              <CommandItem disabled value="no notes">
                <Search />
                No notes match “{query.trim()}”
              </CommandItem>
            ) : null}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
