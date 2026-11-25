import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UiNote, UiNoteSummary } from '../src/ui-server/dto';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Editor } from '@/Editor';
import {
  breadcrumbNavigationPatch,
  planBreadcrumbReveal,
  reduceFolderNavigation,
  type FolderNavigationCommand,
} from '@/breadcrumbNavigation';
import { folderBreadcrumbSegments, toDisplayFolderPath, toDisplayPath, withFolderAncestors } from '@/folderPaths';
import { DEFAULT_WORKSPACE_PREFERENCES } from '../ui/src/workspacePreferences.js';

const note: UiNote = {
  id: '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c',
  title: 'A long title that should wrap naturally across multiple lines without hiding any of its words',
  path: 'notes/long-title.md',
  body: 'Body',
  contentHash: 'abc123',
  icon: null,
  createdAt: '2026-10-27T00:00:00Z',
  updatedAt: '2026-10-27T00:00:00Z',
  tags: [],
  aliases: [],
  metadataKeys: [],
};

function render(fullWidth: boolean, currentNote: UiNote = note): string {
  const notes: UiNoteSummary[] = [];
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(Editor, {
        note: currentNote,
        notes,
        icon: null,
        onIconChange: () => {},
        loading: false,
        title: currentNote.title,
        body: currentNote.body,
        dirty: false,
        saveState: 'saved',
        error: null,
        focusMode: false,
        fullWidth,
        onToggleWidth: () => {},
        layout: 'live',
        editorMode: 'live',
        splitRatio: 0.5,
        onLayoutChange: () => {},
        onEditorModeChange: () => {},
        onSplitRatioChange: () => {},
        panels: DEFAULT_WORKSPACE_PREFERENCES.panels,
        sidebarCollapsed: false,
        onToggleSidebar: () => {},
        onToggleFocus: () => {},
        onTitleChange: () => {},
        onBodyChange: () => {},
        onSave: () => {},
        onReload: () => {},
        onRename: () => {},
        onDelete: () => {},
        onOpenNote: () => {},
        onOpenAllNotes: () => {},
        onOpenFolder: () => {},
        backlinksRevision: 0,
        taskNavigation: null,
      }),
    ),
  );
}

describe('editor layout and title field', () => {
  it('renders the accessible width toggle and preserves the comfortable measure by default', () => {
    const markup = render(false);
    expect(markup).toContain('aria-label="Use full editor width"');
    expect(markup).toContain('max-w-[43rem]');
    expect(markup).toContain('aria-pressed="false"');
  });

  it('removes the width cap in full writing mode while keeping responsive padding', () => {
    const markup = render(true);
    expect(markup).toContain('aria-label="Use comfortable editor width"');
    expect(markup).toContain('max-w-none');
    expect(markup).toContain('lg:px-12');
    expect(markup).toContain('aria-pressed="true"');
  });

  it('keeps the title large and truncates overflow at the editor width', () => {
    const markup = render(false);
    expect(markup).toContain(`<h1 class="sr-only">${note.title}</h1>`);
    expect(markup).toContain('<label class="sr-only" for="note-title">Note title</label>');
    expect(markup).toContain('id="note-title"');
    expect(markup).toContain('type="text"');
    expect(markup).toContain('truncate');
    expect(markup).toContain('text-[34px]');
    expect(markup).toContain('sm:text-[40px]');
    expect(markup).toContain('md:text-[40px]');
    expect(markup).toContain('focus-visible:ring-1');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('pointer-events-none absolute inset-0 block truncate');
    expect(markup).toContain(note.title);
  });

  it('renders actionable breadcrumb navigation and marks the current note', () => {
    const nested = { ...note, title: 'Alpha', path: 'notes/Projects/Sub/Alpha.md' };
    const markup = render(false, nested);
    expect(markup).toMatch(/<button[^>]*aria-label="Open all notes"[^>]*>Notes<\/button>/);
    expect(markup).toMatch(/<button[^>]*aria-label="Open folder Projects"[^>]*>/);
    expect(markup).toMatch(/<button[^>]*aria-label="Open folder Projects\/Sub"[^>]*>/);
    expect(markup).toContain('aria-current="page"');
    expect(markup).not.toContain('aria-label="Open folder notes"');
  });

  it('keeps the current note breadcrumb non-interactive', () => {
    const nested = { ...note, title: 'Alpha', path: 'notes/Projects/Sub/Alpha.md' };
    const current = render(false, nested).match(/<span[^>]*aria-current="page"[^>]*>[\s\S]*?<\/nav>/)?.[0];
    expect(current).toBeDefined();
    expect(current).toContain('Alpha');
    expect(current).not.toContain('<button');
  });

  it('contains editor scroll chaining at the viewport edge', () => {
    expect(render(false)).toContain('overscroll-contain');
  });
});

describe('breadcrumb folder normalization', () => {
  it('separates display labels from notes-root storage targets', () => {
    expect(folderBreadcrumbSegments('notes/Projects/Sub/Alpha.md')).toEqual([
      { label: 'Projects', storagePath: 'notes/Projects' },
      { label: 'Sub', storagePath: 'notes/Projects/Sub' },
    ]);
  });

  it('keeps storage targets unchanged when the note has no notes root', () => {
    expect(folderBreadcrumbSegments('Projects/Sub/Alpha.md')).toEqual([
      { label: 'Projects', storagePath: 'Projects' },
      { label: 'Sub', storagePath: 'Projects/Sub' },
    ]);
  });

  it('has no folder segments for notes directly in the vault or notes root', () => {
    expect(folderBreadcrumbSegments('Alpha.md')).toEqual([]);
    expect(folderBreadcrumbSegments('notes/Alpha.md')).toEqual([]);
    expect(folderBreadcrumbSegments('')).toEqual([]);
  });

  it('preserves unusual folder names without search encoding', () => {
    expect(folderBreadcrumbSegments('notes/Research & Design/2026 "plans"/Alpha.md')).toEqual([
      { label: 'Research & Design', storagePath: 'notes/Research & Design' },
      { label: '2026 "plans"', storagePath: 'notes/Research & Design/2026 "plans"' },
    ]);
  });

  it('maps storage folder paths to sidebar display paths', () => {
    expect(toDisplayFolderPath('notes/Projects/Sub')).toBe('Projects/Sub');
    expect(toDisplayFolderPath('Projects/Sub')).toBe('Projects/Sub');
    expect(toDisplayFolderPath('notes')).toBe('');
  });

  it('strips the notes root without treating a file named notes as the root', () => {
    expect(toDisplayPath('notes/Projects/Alpha.md')).toBe('Projects/Alpha.md');
    expect(toDisplayPath('notes')).toBe('notes');
  });

  it('adds every ancestor of the destination to the expanded set', () => {
    expect([...withFolderAncestors(new Set(['Other']), 'Projects/Sub')].sort()).toEqual([
      'Other',
      'Projects',
      'Projects/Sub',
    ]);
    expect(withFolderAncestors(new Set<string>(), '')).toEqual(new Set<string>());
  });
});

describe('breadcrumb navigation state', () => {
  it('returns All Notes with free-text and metadata filters cleared', () => {
    expect(breadcrumbNavigationPatch(null, 4)).toEqual({
      query: '',
      noteFilters: [],
      filterLogic: 'and',
      folderPath: null,
      sequence: 4,
    });
  });

  it('targets a display folder path without producing a free-text query', () => {
    const patch = breadcrumbNavigationPatch('notes/Projects/Sub', 1);
    expect(patch.query).toBe('');
    expect(patch.noteFilters).toEqual([]);
    expect(patch.filterLogic).toBe('and');
    expect(patch.folderPath).toBe('Projects/Sub');
    expect(patch.sequence).toBe(1);
  });

  it('keeps non-prefixed folder paths unchanged', () => {
    const patch = breadcrumbNavigationPatch('Projects/Sub', 7);
    expect(patch.folderPath).toBe('Projects/Sub');
    expect(patch.sequence).toBe(7);
  });

  it('does not carry note or draft state', () => {
    expect(Object.keys(breadcrumbNavigationPatch('notes/Projects', 0)).sort()).toEqual([
      'filterLogic',
      'folderPath',
      'noteFilters',
      'query',
      'sequence',
    ]);
  });
});

describe('breadcrumb destination reveal', () => {
  it('expands the desktop sidebar and leaves focus mode', () => {
    expect(planBreadcrumbReveal(true, true, true)).toEqual({
      exitFocus: true,
      reveal: 'expand-sidebar',
    });
  });

  it('opens the mobile drawer for a folder target', () => {
    expect(planBreadcrumbReveal(false, false, true)).toEqual({
      exitFocus: false,
      reveal: 'open-drawer',
    });
  });

  it('does not open the mobile drawer for All Notes', () => {
    expect(planBreadcrumbReveal(false, false, false)).toEqual({
      exitFocus: false,
      reveal: 'none',
    });
  });
});

describe('folder navigation command lifecycle', () => {
  const command = (path: string | null, sequence: number): FolderNavigationCommand => ({ path, sequence });

  it('applies a navigation command', () => {
    expect(reduceFolderNavigation(undefined, { type: 'navigate', command: command('Projects', 1) })).toEqual(
      command('Projects', 1),
    );
  });

  it('clears only the command with the acknowledged sequence', () => {
    const pending = command('Projects', 2);
    expect(reduceFolderNavigation(pending, { type: 'acknowledge', sequence: 2 })).toBeUndefined();
    expect(reduceFolderNavigation(pending, { type: 'acknowledge', sequence: 1 })).toBe(pending);
  });

  it('does not let a stale acknowledgment clear a newer command', () => {
    const newer = command('Projects/Sub', 3);
    expect(reduceFolderNavigation(newer, { type: 'acknowledge', sequence: 2 })).toBe(newer);
  });

  it('cancels a pending command when a note opens', () => {
    expect(reduceFolderNavigation(command('Projects', 1), { type: 'note-opened' })).toBeUndefined();
    expect(reduceFolderNavigation(undefined, { type: 'note-opened' })).toBeUndefined();
  });
});

describe('compact breadcrumb presentation', () => {
  const longNote: UiNote = {
    ...note,
    title: 'Alpha',
    path: 'notes/Programs/2026/Research & Design/Sub/Alpha.md',
  };

  function breadcrumbNav(markup: string): string {
    return markup.match(/<nav[^>]*aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0] ?? '';
  }

  it('renders exactly one breadcrumb navigation that is visible at every width', () => {
    const markup = render(false, longNote);
    expect(markup.match(/aria-label="Breadcrumb"/g)).toHaveLength(1);
    const nav = breadcrumbNav(markup).match(/<nav[^>]*>/)?.[0] ?? '';
    const classes = (nav.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/);
    expect(classes).toContain('flex');
    expect(classes).not.toContain('hidden');
    expect(classes).not.toContain('sm:flex');
    expect(classes).toContain('overflow-x-auto');
    expect(classes).toContain('overscroll-x-contain');
    expect(classes).toContain('min-w-0');
    expect(classes).toContain('flex-nowrap');
  });

  it('keeps every ancestor reachable as a labelled button and marks the current page', () => {
    const markup = render(false, longNote);
    for (const label of [
      'Open folder Programs',
      'Open folder Programs/2026',
      'Open folder Programs/2026/Research & Design',
      'Open folder Programs/2026/Research & Design/Sub',
    ]) {
      // React escapes the ampersand in the rendered attribute.
      expect(markup).toContain(`aria-label="${label.replaceAll('&', '&amp;')}"`);
    }
    const current = markup.match(/<span[^>]*aria-current="page"[^>]*>[\s\S]*?<\/nav>/)?.[0];
    expect(current).toBeDefined();
    expect(current).toContain('Alpha');
    expect(current).not.toContain('<button');
  });

  it('bounds long breadcrumbs with truncation and scrolling instead of overflowing the editor', () => {
    const nav = breadcrumbNav(render(false, longNote));
    expect(nav).toContain('max-w-[9rem]');
    expect(nav).toContain('max-w-[45vw]');
    expect(nav).toContain('truncate');
  });

  it('keeps the same single breadcrumb at comfortable and full editor widths', () => {
    const comfortable = breadcrumbNav(render(false, longNote));
    const full = breadcrumbNav(render(true, longNote));
    expect(comfortable).not.toBe('');
    expect(full).toBe(comfortable);
  });

  it('plans a drawer reveal for mobile folder navigation and keeps focus mode semantics', () => {
    expect(planBreadcrumbReveal(true, false, true)).toEqual({ exitFocus: false, reveal: 'expand-sidebar' });
    expect(planBreadcrumbReveal(true, true, true)).toEqual({ exitFocus: true, reveal: 'expand-sidebar' });
    expect(planBreadcrumbReveal(false, false, true)).toEqual({ exitFocus: false, reveal: 'open-drawer' });
    expect(planBreadcrumbReveal(false, true, true)).toEqual({ exitFocus: true, reveal: 'open-drawer' });
    expect(planBreadcrumbReveal(false, false, false)).toEqual({ exitFocus: false, reveal: 'none' });
  });

  it('drops a pending command when navigation moves on to a note', () => {
    const pending = { path: 'Programs/2026', sequence: 9 };
    expect(reduceFolderNavigation(pending, { type: 'note-opened' })).toBeUndefined();
    expect(reduceFolderNavigation(pending, { type: 'navigate', command: { path: null, sequence: 10 } })).toEqual({ path: null, sequence: 10 });
  });
});
