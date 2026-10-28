import { useEffect, useState } from 'react';
import {
  Database,
  Compass,
  FileText,
  Moon,
  Plus,
  Settings,
  Sun,
} from 'lucide-react';
import { useNoteSearch } from './useNoteSearch';
import { SearchResultContext } from './SearchResultContext';
import { Button } from '@/components/ui/button';
import { modShortcut } from './format';
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

interface CommandPaletteProps {
  vaultKey?: string;
  revision?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateNote: () => void;
  onOpenNote: (id: string) => void;
  onView: (view: View) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function CommandPalette({
  vaultKey = '',
  revision = 0,
  open,
  onOpenChange,
  onCreateNote,
  onOpenNote,
  onView,
  theme,
  onToggleTheme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const { results, searching, error, retry } = useNoteSearch(query, vaultKey, revision, open);

  useEffect(() => { if (!open) setQuery(''); }, [open]);

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
      shouldFilter={false}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        aria-label="Search notes or commands"
        placeholder="Search notes or type a command…"
      />
      <CommandList aria-busy={searching} className="max-h-[min(420px,60vh)]" aria-label="Command results">
        {query.trim() === '' ? null : searching && results.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground" role="status">Searching…</div>
        ) : error !== null ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-destructive" role="alert">{error}<Button variant="outline" size="sm" onClick={retry}>Retry search</Button></div>
        ) : results.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground" role="status">No results.</div>
        ) : null}

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
              <CommandItem value="discovery unresolved wiki links orphan notes" onSelect={() => run(() => onView('discovery'))}>
                <Compass />
                Knowledge discovery
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
          <CommandGroup key={`${query.trim()}:${vaultKey}:${revision}`} heading="Notes">
            {results.map((result) => (
              <CommandItem
                key={result.id}
                value={result.id}
                onSelect={() => run(() => onOpenNote(result.id))}
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
      </CommandList>
    </CommandDialog>
  );
}
