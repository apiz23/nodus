import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UiNote, UiNoteSummary } from '../src/ui-server/dto';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Editor } from '@/Editor';
import { DEFAULT_WORKSPACE_PREFERENCES } from '../ui/src/workspacePreferences.js';

const note: UiNote = {
  id: '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c',
  title: 'Responsive note',
  path: 'notes/responsive.md',
  body: '# Heading\n\nBody',
  contentHash: 'abc123',
  icon: null,
  createdAt: '2026-10-27T00:00:00Z',
  updatedAt: '2026-10-27T00:00:00Z',
  tags: [],
  aliases: [],
  metadataKeys: [],
};

/**
 * The editor measures its containing section at runtime. Server rendering has no
 * ResizeObserver, so the initial viewport estimate is the test seam: the same
 * estimate the browser uses before its first layout measurement.
 */
function renderEditor(layout: 'live' | 'preview' | 'split', width: number, vaultIdentity = '/vaults/alpha'): string {
  const originalWindow = Reflect.get(globalThis, 'window');
  Reflect.set(globalThis, 'window', { innerWidth: width });
  try {
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
          fullWidth: false,
          onToggleWidth: () => {},
          layout,
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
          tagMutationBusy: false,
          tagMutationDisabled: false,
          onAddTag: async () => {},
          onRemoveTag: async () => {},
          propertyMutationBusy: false,
          propertyMutationDisabled: false,
          onSetPropertyValue: async () => note,
          onUnsetPropertyValue: async () => note,
          backlinksRevision: 0,
          taskNavigation: null,
          vaultIdentity,
        }),
        ),
    );
  } finally {
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Reflect.set(globalThis, 'window', originalWindow);
  }
}

function panelGroupTag(markup: string): string {
  return markup.match(/<div[^>]*id="note-editor-preview-group"[^>]*>/)?.[0] ?? '';
}

const hasTabs = (markup: string): boolean => markup.includes('role="tablist"') && markup.includes('id="note-editor-tab"') && markup.includes('id="note-preview-tab"');
const hasSeparator = (markup: string): boolean => markup.includes('aria-label="Resize editor and preview"');

describe('responsive editor architecture', () => {
  it('keeps only the editor in Live mode', () => {
    const markup = renderEditor('live', 390);
    expect(markup).toContain('id="note-editor-panel"');
    expect(markup).not.toContain('data-testid="editor-markdown-preview"');
    expect(markup).not.toContain('data-vault-identity');
    expect(hasTabs(markup)).toBe(false);
    expect(hasSeparator(markup)).toBe(false);
  });

  it('keeps only the preview in Preview mode', () => {
    const markup = renderEditor('preview', 390);
    expect(markup).toContain('data-testid="editor-markdown-preview"');
    expect(markup).toContain('data-vault-identity="/vaults/alpha"');
    expect(hasTabs(markup)).toBe(false);
    expect(hasSeparator(markup)).toBe(false);
  });

  it('uses accessible Editor/Preview tabs at phone width instead of stacked panes', () => {
    const markup = renderEditor('split', 390);
    const group = panelGroupTag(markup);
    expect(hasTabs(markup)).toBe(true);
    expect(hasSeparator(markup)).toBe(false);
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-controls="note-editor-panel"');
    expect(markup).toContain('aria-controls="note-preview-panel"');
    expect(markup).toContain('aria-label="Editor and preview"');
    expect(group).toContain('flex-direction:row');
    expect(group).not.toContain('basis-auto');
    expect(markup).toContain('class="w-full hidden"');
  });

  it('uses tabs at tablet width rather than two narrow columns', () => {
    for (const width of [640, 768, 1024]) {
      const markup = renderEditor('split', width);
      expect(hasTabs(markup), `tabs at ${width}`).toBe(true);
      expect(hasSeparator(markup), `no separator at ${width}`).toBe(false);
    }
  });

  it('uses a resizable side-by-side layout with labels on desktop', () => {
    const markup = renderEditor('split', 1280);
    expect(hasTabs(markup)).toBe(false);
    expect(hasSeparator(markup)).toBe(true);
    expect(markup).toContain('aria-label="Resize editor and preview"');
    expect(markup).toMatch(/>\s*Editor\s*</);
    expect(markup).toMatch(/>\s*Preview\s*</);
    expect(markup).toContain('max-w-[88rem]');
    expect(panelGroupTag(markup)).toContain('w-full');
  });

  it('keeps the grouped panes scroll-transparent and without fixed viewport height', () => {
    for (const width of [390, 1280]) {
      const group = panelGroupTag(renderEditor('split', width));
      expect(group).toContain('height:auto');
      expect(group).toContain('overflow:visible');
      expect(group).not.toContain('overflow:hidden');
    }
  });

  it('carries the vault identity into the rendered preview only', () => {
    expect(renderEditor('split', 390)).toContain('data-vault-identity="/vaults/alpha"');
    expect(renderEditor('preview', 390)).toContain('data-vault-identity="/vaults/alpha"');
    expect(renderEditor('live', 390)).not.toContain('data-vault-identity');
    expect(renderEditor('split', 1280, '/vaults/beta')).not.toContain('/vaults/alpha');
  });

  it('renders one editor instance and one preview instance', () => {
    const markup = renderEditor('split', 1280);
    expect(markup).toContain('id="note-editor-panel"');
    expect(markup).toContain('id="note-preview-panel"');
    expect((markup.match(/data-testid="editor-markdown-preview"/g) ?? []).length).toBe(1);
  });
});
