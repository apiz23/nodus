import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UiNoteSummary, UiVaultStatus } from '../src/ui-server/dto';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sidebar } from '@/Sidebar';
import { SidebarToggle } from '@/SidebarToggle';
import { SearchResultContext } from '@/SearchResultContext';
import type { View } from '@/types';

const status: UiVaultStatus = {
  vault: { name: 'Nodus', path: '/Users/alex/Documents/Journal' },
  counts: { notes: 2, databases: 0, issues: 0 },
  health: { issues: [] },
  sync: { status: 'not-connected', label: 'Not connected', detail: 'Local only' },
};

function note(id: string, title: string, path: string): UiNoteSummary {
  return { id, title, path, updatedAt: '2026-01-01T00:00:00.000Z', aliases: [], icon: null };
}

const rootNotes = [note('id-alpha', 'Alpha note', 'notes/alpha.md'), note('id-beta', 'Beta note', 'notes/beta.md')];
const nestedNotes = [note('id-alpha', 'Alpha note', 'notes/projects/alpha.md')];

it('renders untrusted search context as escaped text while highlighting the matched characters', () => {
  const text = '<img src=x onerror=alert(1)> & "needle"';
  const start = text.indexOf('needle');
  const html = renderToStaticMarkup(createElement(SearchResultContext, { result: {
    ...rootNotes[0]!, snippet: text,
    match: { field: 'content', text, start, end: start + 'needle'.length },
  } }));
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).toContain('&amp;');
  expect(html).toMatch(/<mark[^>]*>needle<\/mark>/);
  expect(html).not.toContain('<img');
  const fallback = renderToStaticMarkup(createElement(SearchResultContext, {
    result: { ...rootNotes[0]!, snippet: '<script>alert(1)</script>' },
  }));
  expect(fallback).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
});

function renderSidebar(
  view: View,
  {
    notes = rootNotes,
    folders = [],
    selectedId = 'id-alpha',
    collapsed = false,
    open = false,
    folderError = null,
    searchError = null,
  }: { notes?: UiNoteSummary[]; folders?: string[]; selectedId?: string | null; collapsed?: boolean; open?: boolean; folderError?: string | null; searchError?: string | null } = {},
): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(Sidebar, {
        view,
        onView: () => {},
        query: '',
        onQueryChange: () => {},
        searchRef: { current: null },
        onCreate: () => {},
        onCreateInFolder: () => {},
        onCreateFolder: async () => {},
        onMoveFolder: async () => true,
        onInspectFolder: async (path) => ({ path, folders: 0, notes: 0, files: 0, token: 'a'.repeat(64), noteIds: [] }),
        onDeleteFolder: async () => [],
        onFolderMutation: () => {},
        creating: false,
        status,
        theme: 'light',
        onToggleTheme: () => {},
        notes,
        folders,
        folderError,
        results: [],
        selectedId,
        loading: false,
        searching: false,
        searchError,
        onOpen: () => {},
        onRenameNote: () => {},
        onDeleteNote: () => {},
        onClearSearch: () => {},
        onRetry: () => {},
        open,
        onClose: () => {},
        collapsed,
        onExpandForSearch: () => {},
        onOpenAnotherVault: () => {},
        switchingVault: false,
        navigationLocked: false,
      }),
    ),
  );
}

describe('Sidebar note tree visibility across main sections', () => {
  it('keeps the note tree mounted on Settings (regression: tree disappeared)', () => {
    const markup = renderSidebar('settings');
    expect(markup).toContain('Alpha note');
    expect(markup).toContain('Beta note');
    expect(markup).toContain('Pages');
  });

  it('keeps the note tree mounted on Databases', () => {
    const markup = renderSidebar('databases');
    expect(markup).toContain('Alpha note');
    expect(markup).toContain('Beta note');
  });

  it('keeps the note tree mounted on All notes', () => {
    expect(renderSidebar('notes')).toContain('Alpha note');
  });

  it('marks the active section while the selected note stays selected', () => {
    const markup = renderSidebar('settings');
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toContain('aria-selected="true"');
    const settingsNav = markup.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find((b) => b.includes('Settings'));
    expect(settingsNav).toContain('aria-current="page"');
  });

  it('does not mark a section as current on All notes for the selected note', () => {
    const markup = renderSidebar('notes');
    const allNotesNav = markup.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find((b) => b.includes('All notes'));
    expect(allNotesNav).toContain('aria-current="page"');
  });

  it('renders nested folder rows regardless of section', () => {
    const markup = renderSidebar('settings', { notes: nestedNotes });
    expect(markup).toContain('projects, 1 page');
    expect(markup).toContain('aria-current="location"');
  });

  it('renders empty filesystem folders and discoverable note/folder actions', () => {
    const markup = renderSidebar('notes', { notes: [], folders: ['Empty', 'notes/Research/Methods'] , selectedId: null });
    expect(markup).toContain('Empty, 0 pages');
    expect(markup).toContain('Research, 0 pages');
    expect(markup).toContain('aria-label="New folder"');
    expect(markup).toContain('New note');
    expect(markup).toContain('aria-label="Actions for Empty"');
  });

  it('renders contextual action menus for both folders and notes', () => {
    const markup = renderSidebar('notes', { notes: [...rootNotes, ...nestedNotes], folders: ['projects'] });
    expect(markup).toContain('aria-label="Actions for Alpha note"');
    expect(markup).toContain('aria-label="Actions for projects"');
  });

  it('renders the empty state on Settings when the vault has no pages', () => {
    const markup = renderSidebar('settings', { notes: [], selectedId: null });
    expect(markup).toContain('No pages yet');
  });

  it('shows Markdown filenames while preserving note titles for accessible navigation', () => {
    const markup = renderSidebar('notes', { notes: [note('root', 'A different title', 'actual-file.md')] });
    expect(markup).toContain('>actual-file.md</span>');
    expect(markup).toContain('aria-label="A different title (actual-file.md)"');
  });

  it('shows the empty state when only the hidden default notes namespace remains', () => {
    const markup = renderSidebar('notes', { notes: [], folders: ['notes'], selectedId: null });
    expect(markup).toContain('No pages yet');
    expect(markup).not.toContain('role="tree"');
  });

  it('reports API failures without claiming the vault is empty or hiding known notes', () => {
    for (const errors of [{ searchError: 'Cannot read notes' }, { folderError: 'Cannot read folders' }]) {
      const empty = renderSidebar('notes', { notes: [], selectedId: null, ...errors });
      expect(empty).toContain('role="alert"');
      expect(empty).toContain('Retry');
      expect(empty).not.toContain('No pages yet');
      expect(renderSidebar('notes', errors)).toContain('>alpha.md</span>');
    }
  });

  it('shows a real current-vault switcher with a shortened path and menu trigger', () => {
    const markup = renderSidebar('notes');
    expect(markup).toContain('Vault menu: Nodus');
    expect(markup).toContain('…/Documents/Journal');
    expect(markup).toContain('aria-haspopup="menu"');
  });

  it('renders a compact desktop rail without removing mobile drawer content', () => {
    const compact = renderSidebar('notes', { collapsed: true });
    expect(compact).not.toContain('aria-label="Expand sidebar"');
    expect(compact).toContain('aria-label="Search notes"');
    expect(compact).not.toContain('Alpha note');

    const mobile = renderSidebar('settings', { collapsed: true, open: true });
    expect(mobile).toContain('role="dialog"');
    expect(mobile).toContain('aria-modal="true"');
    expect(mobile).toContain('aria-label="Close navigation"');
    expect(mobile).toContain('Alpha note');
    expect(mobile).toContain('Search pages');
  });

  it('keeps the sidebar inside the app viewport with its tree as the scroll area', () => {
    const markup = renderSidebar('notes');
    expect(markup).toContain('min-h-0');
    expect(markup).toContain('overflow-hidden');
  });

  it('renders the collapse control as a separate main-header action', () => {
    const markup = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(SidebarToggle, { collapsed: false, onToggle: () => {} })),
    );
    expect(markup).toContain('aria-label="Collapse sidebar"');
  });

  it('keeps settings and storage health in the compact footer', () => {
    const markup = renderSidebar('settings', { collapsed: true });
    expect(markup).toContain('aria-label="Settings"');
    expect(markup).toContain('Storage health: 0 issues');
    expect(markup).not.toContain('Not connected');
  });
});
