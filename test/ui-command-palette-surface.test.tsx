import { searchCommands } from '../ui/src/commands';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NoteFilter } from '../src/search/note-filters.js';

// The palette dialog itself is a Radix portal that does not render under
// react-dom/server, so the command primitives are replaced with inert elements
// to exercise the palette's own command list, disabled states, and search wiring.
const searchState = vi.hoisted(() => ({
  captured: [] as unknown[][],
  state: {
    results: [] as unknown[],
    searching: false,
    error: null as string | null,
    metadataIssueCount: 0,
    catalogIssue: undefined as string | undefined,
    retry: () => {},
  },
}));

vi.mock('../ui/src/useNoteSearch', () => ({
  useNoteSearch: (...args: unknown[]) => {
    searchState.captured.push(args);
    return searchState.state;
  },
}));

vi.mock('@/components/ui/command', () => ({
  CommandDialog: ({ open, children }: { open: boolean; children: unknown }) => (open ? createElement('div', { 'data-palette': 'open' }, children as never) : null),
  CommandGroup: ({ heading, children }: { heading: string; children: unknown }) => createElement('div', { 'data-group': heading }, children as never),
  CommandInput: (props: { 'aria-label'?: string; placeholder?: string }) => createElement('input', { 'aria-label': props['aria-label'], placeholder: props.placeholder, readOnly: true }),
  CommandItem: ({ children, disabled, 'aria-label': ariaLabel }: { children: unknown; disabled?: boolean; 'aria-label'?: string }) => createElement('button', { disabled: disabled ?? false, 'aria-label': ariaLabel }, children as never),
  CommandList: ({ children }: { children: unknown }) => createElement('div', null, children as never),
  CommandSeparator: () => createElement('hr'),
  CommandShortcut: ({ children }: { children: unknown }) => createElement('span', null, children as never),
}));

import { CommandPalette, buildPaletteCommands } from '@/CommandPalette';

const baseProps = {
  open: true,
  onOpenChange: () => {},
  onCreateNote: () => {},
  onOpenNote: () => {},
  onView: () => {},
  onOpenRecent: () => {},
  onOpenShortcuts: () => {},
  theme: 'light' as const,
  onToggleTheme: () => {},
  focusMode: false,
  onToggleFocusMode: () => {},
  sidebarCollapsed: false,
  canToggleSidebar: true,
  onToggleSidebar: () => {},
  onOpenGettingStarted: () => {},
  onOpenSearchFilters: () => {},
  onOpenSearchLibrary: () => {},
  onOpenSettingsSection: () => {},
  onSwitchVault: () => {},
  canManageNote: true,
  onRenameNote: () => {},
  onDeleteNote: () => {},
  onReloadNote: () => {},
  canOpenAutomations: true,
  onOpenAutomations: () => {},
};

function renderPalette(props: Partial<typeof baseProps> = {}): string {
  searchState.captured.length = 0;
  return renderToStaticMarkup(createElement(CommandPalette, { ...baseProps, ...props }));
}

function buttonLabels(html: string): Array<{ label: string; disabled: boolean }> {
  const tags = [...html.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
  return tags.map((tag) => ({
    label: tag.match(/aria-label="([^"]*)"/)?.[1] ?? '',
    disabled: /(?:^|\s)disabled=""/.test(tag),
  }));
}

describe('command palette surface', () => {
  it('registers the Phase 32B commands', () => {
    const html = renderPalette();
    const labels = buttonLabels(html).map((entry) => entry.label);
    expect(labels).toContain('Backup and restore');
    expect(labels).toContain('Import or export workspace');
    expect(labels).toContain('Database automations');
    expect(labels).toContain('Conflicts');
    expect(labels).toContain('Enter focus mode');
    expect(labels).toContain('Hide sidebar');
    expect(labels).toContain('Getting started guide');
    expect(labels).toContain('Search filters');
    expect(labels).toContain('Saved searches');
    expect(labels).toContain('Open another vault');
    expect(labels).toContain('Rename note path');
    expect(labels).toContain('Delete note');
    expect(labels).toContain('Reload note from disk');
  });

  it('disables context-dependent commands when their context is unavailable', () => {
    const html = renderPalette({ canManageNote: false, canOpenAutomations: false, canToggleSidebar: false, focusMode: false });
    const labels = buttonLabels(html);
    const byLabel = new Map(labels.map((entry) => [entry.label, entry.disabled]));
    expect(byLabel.get('Rename note path')).toBe(true);
    expect(byLabel.get('Delete note')).toBe(true);
    expect(byLabel.get('Reload note from disk')).toBe(true);
    expect(byLabel.get('Database automations')).toBe(true);
    expect(byLabel.get('Enter focus mode')).toBe(true);
    expect(byLabel.get('Hide sidebar')).toBe(true);
    expect(byLabel.get('Backup and restore')).toBe(false);
    expect(byLabel.get('New note')).toBe(false);
  });

  it('reflects focus mode and sidebar state in command titles', () => {
    const html = renderPalette({ focusMode: true, sidebarCollapsed: true });
    const labels = buttonLabels(html).map((entry) => entry.label);
    expect(labels).toContain('Exit focus mode');
    expect(labels).toContain('Show sidebar');
    expect(labels).not.toContain('Enter focus mode');
    expect(labels).not.toContain('Hide sidebar');
  });

  it('keeps the exit command available while focus mode hides the sidebar', () => {
    const labels = new Map(buttonLabels(renderPalette({ focusMode: true, canToggleSidebar: false })).map((entry) => [entry.label, entry.disabled]));
    expect(labels.get('Exit focus mode')).toBe(false);
    expect(labels.get('Hide sidebar')).toBe(true);
    expect(labels.get('Search filters')).toBe(false);
    expect(labels.get('Saved searches')).toBe(false);
  });

  it('passes the active metadata filters and logic to the shared search hook', () => {
    const filters: NoteFilter[] = [{ type: 'tag', operator: 'contains', value: 'project' }];
    renderPalette({ filters, filterLogic: 'or' });
    expect(searchState.captured.length).toBeGreaterThan(0);
    const last = searchState.captured.at(-1)!;
    expect(last[4]).toEqual(filters);
    expect(last[5]).toBe('or');
  });

  it('shows note results, the result cap, and catalog diagnostics for filter-only searches', () => {
    searchState.state = {
      ...searchState.state,
      results: Array.from({ length: 50 }, (_, index) => ({ id: `note-${index}`, title: `Note ${index}`, path: `notes/note-${index}.md` })),
      catalogIssue: 'catalog unreadable',
      metadataIssueCount: 2,
    };
    const filters: NoteFilter[] = [{ type: 'tag', operator: 'contains', value: 'project' }];
    // Empty query with active filters must still render the Notes group (parity
    // with the sidebar, where filters alone drive results).
    const html = renderPalette({ filters, filterLogic: 'and' });
    expect(html).toContain('Open Note 49');
    expect(html).toContain('Top 50 matches');
    expect(html).toContain('Metadata search is limited because the property catalog could not be read.');
    expect(html).toContain('2 registered property values are invalid and excluded from search and filters.');
    searchState.state = { ...searchState.state, results: [], catalogIssue: undefined, metadataIssueCount: 0 };
  });

  it('does not render note results without a query or filters', () => {
    searchState.state = {
      ...searchState.state,
      results: [{ id: 'note-z', title: 'Zebra Result', path: 'notes/zebra.md' }],
    };
    const html = renderPalette();
    expect(html).not.toContain('Open Zebra Result');
    expect(html).not.toContain('Top 50 matches');
    searchState.state = { ...searchState.state, results: [] };
  });
});

describe('buildPaletteCommands', () => {
  const deps = {
    recentNotes: [],
    onCreateNote: () => {},
    onSaveNote: () => {},
    canSaveNote: false,
    onOpenNote: () => {},
    onView: () => {},
    onOpenRecent: () => {},
    onOpenShortcuts: () => {},
    databases: [{ id: 'db-1', name: 'Bugs' }],
    folders: ['notes/projects'],
    theme: 'light' as const,
    onToggleTheme: () => {},
    focusMode: false,
    onToggleFocusMode: () => {},
    sidebarCollapsed: false,
    canToggleSidebar: true,
    onToggleSidebar: () => {},
    onOpenGettingStarted: () => {},
    onOpenSearchFilters: () => {},
    onOpenSearchLibrary: () => {},
    onOpenSettingsSection: () => {},
    onSwitchVault: () => {},
    canManageNote: true,
    onRenameNote: () => {},
    onDeleteNote: () => {},
    onReloadNote: () => {},
    canOpenAutomations: true,
    onOpenAutomations: () => {},
  };


  it('keeps every command id unique with dynamic databases and folders', () => {
    const commands = buildPaletteCommands(deps);
    const ids = commands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Pre-existing commands survive alongside the Phase 32B additions.
    for (const id of ['new-note', 'save-note', 'recent-notes', 'view-notes', 'view-settings', 'toggle-theme', 'keyboard-shortcuts', 'database:db-1', 'folder:notes/projects']) {
      expect(ids).toContain(id);
    }
  });

  it('routes the Conflicts command to the conflict view', async () => {
    const onView = vi.fn();
    const commands = buildPaletteCommands({ ...deps, onView });
    await commands.find((command) => command.id === 'view-conflicts')!.run();
    expect(onView).toHaveBeenCalledWith('conflicts');
  });

  it('routes note and vault actions through the provided handlers', async () => {
    const onRenameNote = vi.fn();
    const onDeleteNote = vi.fn();
    const onReloadNote = vi.fn();
    const onSwitchVault = vi.fn();
    const commands = buildPaletteCommands({ ...deps, onRenameNote, onDeleteNote, onReloadNote, onSwitchVault });
    await commands.find((command) => command.id === 'rename-note')!.run();
    await commands.find((command) => command.id === 'delete-note')!.run();
    await commands.find((command) => command.id === 'reload-note')!.run();
    await commands.find((command) => command.id === 'switch-vault')!.run();
    expect(onRenameNote).toHaveBeenCalledTimes(1);
    expect(onDeleteNote).toHaveBeenCalledTimes(1);
    expect(onReloadNote).toHaveBeenCalledTimes(1);
    expect(onSwitchVault).toHaveBeenCalledTimes(1);
  });

  it('navigates backup and import commands to the backup settings section', async () => {
    const onOpenSettingsSection = vi.fn();
    const commands = buildPaletteCommands({ ...deps, onOpenSettingsSection });
    const backup = commands.find((command) => command.id === 'backup-restore')!;
    const portable = commands.find((command) => command.id === 'import-export')!;
    await backup.run();
    await portable.run();
    expect(onOpenSettingsSection).toHaveBeenNthCalledWith(1, 'backup');
    expect(onOpenSettingsSection).toHaveBeenNthCalledWith(2, 'backup');
  });

  it('runs the automations command only through the provided handler', async () => {
    const onOpenAutomations = vi.fn();
    const commands = buildPaletteCommands({ ...deps, onOpenAutomations });
    await commands.find((command) => command.id === 'database-automations')!.run();
    expect(onOpenAutomations).toHaveBeenCalledTimes(1);
  });

  it('routes template application through the existing templates view command', () => {
    const commands = buildPaletteCommands(deps);
    const matches = commands.filter((command) => 'apply template'.split(' ').every((token) => `${command.title} ${command.keywords ?? ''}`.toLowerCase().includes(token)));
    expect(matches.map((command) => command.id)).toContain('view-templates');
    // No second command performs an apply: applying stays in the templates workspace.
    expect(matches.filter((command) => command.id !== 'view-templates')).toEqual([]);
  });
});
