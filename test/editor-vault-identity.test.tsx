import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UiNote, UiNoteSummary } from '../src/ui-server/dto';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Editor } from '@/Editor';
import type { EditorLayout } from '@/workspacePreferences';
import { DEFAULT_WORKSPACE_PREFERENCES } from '../ui/src/workspacePreferences.js';

const note: UiNote = {
  id: '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c',
  title: 'Composition',
  path: 'notes/Composition.md',
  body: 'Body',
  contentHash: 'abc123',
  icon: null,
  createdAt: '2026-10-27T00:00:00Z',
  updatedAt: '2026-10-27T00:00:00Z',
  tags: [],
  aliases: [],
  metadataKeys: [],
};

function renderPreview(vaultIdentity: string, layout: EditorLayout = 'preview'): string {
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
}

describe('Editor preview vault identity', () => {
  it('passes the active vault identity to the Markdown preview host', () => {
    const markup = renderPreview('/vaults/alpha');
    expect(markup).toContain('data-testid="editor-markdown-preview"');
    expect(markup).toContain('data-vault-identity="/vaults/alpha"');
  });

  it('changes the preview identity when the vault changes', () => {
    expect(renderPreview('/vaults/alpha')).toContain('data-vault-identity="/vaults/alpha"');
    const beta = renderPreview('/vaults/beta');
    expect(beta).toContain('data-vault-identity="/vaults/beta"');
    expect(beta).not.toContain('/vaults/alpha');
  });

  it('keeps editor content and controls while the preview host is present', () => {
    const markup = renderPreview('/vaults/alpha', 'split');
    expect(markup).toContain(`<h1 class="sr-only">${note.title}</h1>`);
    expect(markup).toContain('id="note-title"');
    expect(markup).toContain('title="Save note (Ctrl/Cmd+S)"');
    expect(markup).toContain('data-vault-identity="/vaults/alpha"');
  });

  it('does not mark a live-only note as a rendered preview', () => {
    const markup = renderPreview('/vaults/alpha', 'live');
    expect(markup).not.toContain('data-testid="editor-markdown-preview"');
    expect(markup).not.toContain('data-vault-identity');
  });
});
