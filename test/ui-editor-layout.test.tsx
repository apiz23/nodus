import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UiNote, UiNoteSummary } from '../src/ui-server/dto';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Editor } from '@/Editor';

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

function render(fullWidth: boolean): string {
  const notes: UiNoteSummary[] = [];
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(Editor, {
        note,
        notes,
        icon: null,
        onIconChange: () => {},
        loading: false,
        title: note.title,
        body: note.body,
        dirty: false,
        saveState: 'saved',
        error: null,
        focusMode: false,
        fullWidth,
        onToggleWidth: () => {},
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
        backlinksRevision: 0,
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

  it('contains editor scroll chaining at the viewport edge', () => {
    expect(render(false)).toContain('overscroll-contain');
  });
});
