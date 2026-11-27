import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { UiNote, UiNoteSummary } from '../src/ui-server/dto';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { EditorLayout } from '@/workspacePreferences';
import { DEFAULT_WORKSPACE_PREFERENCES } from '../ui/src/workspacePreferences.js';

/**
 * Render the real Editor, but replace `React.lazy` with a synchronous stand-in
 * that records the props each lazily loaded component receives. This is the
 * only way to assert the Editor → MarkdownPreview prop path without a browser:
 * server rendering otherwise only shows the Suspense fallback.
 *
 * `Editor` declares `CodeMirrorEditor` first and `MarkdownPreview` second, so
 * the stand-in's index identifies the preview component.
 */
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  let index = 0;
  return {
    ...actual,
    lazy: () => {
      index += 1;
      const componentIndex = index;
      return (props: Record<string, unknown>) => actual.createElement('div', {
        'data-lazy-index': String(componentIndex),
        'data-vault-identity': props.vaultIdentity,
      });
    },
  } as unknown as typeof import('react');
});

const { Editor } = await import('@/Editor');

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

function render(vaultIdentity: string, layout: EditorLayout): string {
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

const PREVIEW = /data-lazy-index="2"[^>]*data-vault-identity="([^"]*)"/;

describe('Editor passes vaultIdentity to MarkdownPreview', () => {
  it('forwards the identity prop to the preview component', () => {
    const match = render('/vaults/alpha', 'preview').match(PREVIEW);
    expect(match?.[1]).toBe('/vaults/alpha');
  });

  it('forwards a changed identity on the next render', () => {
    expect(render('/vaults/beta', 'split').match(PREVIEW)?.[1]).toBe('/vaults/beta');
  });

  it('does not mount the preview component in live mode', () => {
    expect(render('/vaults/alpha', 'live')).not.toMatch(PREVIEW);
  });
});
