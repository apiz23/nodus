import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '../ui/src/components/ui/tooltip.js';
import type { UiVaultStatus } from '../src/ui-server/dto.js';
import { SettingsView } from '../ui/src/SettingsView.js';
import { DEFAULT_WORKSPACE_PREFERENCES } from '../ui/src/workspacePreferences.js';

describe('vault health settings UI', () => {
  it('renders template catalog health details using the existing issue list', () => {
    const status: UiVaultStatus = {
      vault: { name: 'Test', path: '/tmp/test-vault' },
      counts: { notes: 0, databases: 0, issues: 1 },
      health: { issues: [{ code: 'UNSUPPORTED_VERSION', path: '.nodus-templates/templates.json', message: 'Template catalog version 99 is unsupported. Preserve it and open with a compatible Nodus version.' }] },
      sync: { status: 'not-connected', label: 'Not connected', detail: 'Local only.' },
    };
    const markup = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(SettingsView, {
      status, loading: false, error: null, onRefresh() {}, onPickVault() {}, picking: false,
      vaultPathDraft: status.vault.path, onVaultPathDraftChange() {}, onOpenVault() {}, openingVault: false,
      theme: 'light', onToggleTheme() {}, onRestored() {}, onVaultWorkChange() {},
      sidebarCollapsed: false, onToggleSidebar() {},
      workspacePreferences: DEFAULT_WORKSPACE_PREFERENCES, workspacePreferencesReady: true,
      workspacePreferencesIssue: null, workspacePresetUndo: null,
      onWorkspacePreferencesChange() {}, onApplyWorkspacePreset() {}, onUndoWorkspacePreset() {}, onResetWorkspace() {},
    })));
    expect(markup).toContain('validate the optional template catalog');
    expect(markup).toContain('UNSUPPORTED_VERSION');
    expect(markup).toContain('.nodus-templates/templates.json');
    expect(markup).toContain('Preserve it and open with a compatible Nodus version.');
  });
});
