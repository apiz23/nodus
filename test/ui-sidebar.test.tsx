import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UiNoteSummary, UiVaultStatus } from '../src/ui-server/dto';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sidebar } from '@/Sidebar';
import { SidebarToggle } from '@/SidebarToggle';
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

function renderSidebar(
  view: View,
  {
    notes = rootNotes,
    selectedId = 'id-alpha',
    collapsed = false,
    open = false,
  }: { notes?: UiNoteSummary[]; selectedId?: string | null; collapsed?: boolean; open?: boolean } = {},
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
        creating: false,
        status,
        theme: 'light',
        onToggleTheme: () => {},
        notes,
        results: [],
        selectedId,
        loading: false,
        searching: false,
        searchError: null,
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

  it('renders note-only action menus without adding actions to folders', () => {
    const markup = renderSidebar('notes', { notes: [...rootNotes, ...nestedNotes] });
    expect(markup).toContain('aria-label="Actions for Alpha note"');
    expect(markup).not.toContain('aria-label="Actions for projects"');
  });

  it('renders the empty state on Settings when the vault has no pages', () => {
    const markup = renderSidebar('settings', { notes: [], selectedId: null });
    expect(markup).toContain('No pages yet');
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
