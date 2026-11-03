import { describe, expect, it } from 'vitest';
import {
  clearWorkspacePreferences,
  DEFAULT_WORKSPACE_PREFERENCES,
  LEGACY_EDITOR_WIDTH_KEY,
  LEGACY_SIDEBAR_WIDTH_KEY,
  LEGACY_THEME_KEY,
  loadWorkspacePreferences,
  makeWorkspacePreset,
  normalizeWorkspacePreferences,
  readWorkspaceTheme,
  restoreWorkspacePreset,
  saveGlobalTheme,
  saveWorkspacePreferences,
  WORKSPACE_PREFERENCES_KEY,
} from '../ui/src/workspacePreferences.js';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  entries(): Record<string, string> { return Object.fromEntries(this.values); }
}

describe('versioned workspace preferences', () => {
  it('provides safe defaults and validates bounded fields and supported sections', () => {
    expect(normalizeWorkspacePreferences(null).preferences).toEqual(DEFAULT_WORKSPACE_PREFERENCES);
    const result = normalizeWorkspacePreferences({
      sidebar: { width: 9999, order: ['graph', 'unknown', 'graph'], hidden: ['templates', 'unknown'], collapsed: 'yes' },
      editor: { layout: 'floating', width: 'panoramic', splitRatio: 0.9 },
      panels: { backlinks: false, relatedNotes: 'yes' },
    });
    expect(result.issue).toContain('replaced with defaults');
    expect(result.preferences.sidebar.width).toBe(240);
    expect(result.preferences.sidebar.order).toContain('databases');
    expect(result.preferences.sidebar.order).not.toContain('unknown');
    expect(result.preferences.sidebar.hidden).toEqual(['templates']);
    expect(result.preferences.editor).toEqual(DEFAULT_WORKSPACE_PREFERENCES.editor);
    expect(result.preferences.panels).toMatchObject({ backlinks: false, relationBacklinks: true, relatedNotes: true });
  });

  it('migrates the old theme and unscoped widths to only the first vault opened', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_THEME_KEY, 'dark');
    storage.setItem(LEGACY_EDITOR_WIDTH_KEY, 'full');
    storage.setItem(LEGACY_SIDEBAR_WIDTH_KEY, '360');
    const first = loadWorkspacePreferences(storage, '/vault/first');
    expect(first).toMatchObject({ theme: 'dark', migrated: true, preferences: { sidebar: { width: 360 }, editor: { width: 'full' } } });
    expect(loadWorkspacePreferences(storage, '/vault/second').preferences).toEqual(DEFAULT_WORKSPACE_PREFERENCES);
    expect(readWorkspaceTheme(storage)).toBe('dark');
  });

  it('preserves pending legacy widths if the global theme changes before the first vault opens', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_EDITOR_WIDTH_KEY, 'full');
    storage.setItem(LEGACY_SIDEBAR_WIDTH_KEY, '360');
    expect(saveGlobalTheme(storage, 'dark')).toBe(true);
    const migrated = loadWorkspacePreferences(storage, '/vault/first');
    expect(migrated).toMatchObject({ theme: 'dark', preferences: { sidebar: { width: 360 }, editor: { width: 'full' } } });
    expect(loadWorkspacePreferences(storage, '/vault/second').preferences).toEqual(DEFAULT_WORKSPACE_PREFERENCES);
  });

  it('keeps workspace settings isolated per vault while theme remains global', () => {
    const storage = new MemoryStorage();
    loadWorkspacePreferences(storage, '/vault/one');
    loadWorkspacePreferences(storage, '/vault/two');
    const first = { ...DEFAULT_WORKSPACE_PREFERENCES, sidebar: { ...DEFAULT_WORKSPACE_PREFERENCES.sidebar, width: 320, collapsed: true } };
    expect(saveWorkspacePreferences(storage, '/vault/one', first)).toBe(true);
    expect(saveGlobalTheme(storage, 'dark')).toBe(true);
    expect(loadWorkspacePreferences(storage, '/vault/one')).toMatchObject({ preferences: first, theme: 'dark' });
    expect(loadWorkspacePreferences(storage, '/vault/two')).toMatchObject({ preferences: DEFAULT_WORKSPACE_PREFERENCES, theme: 'dark' });
  });

  it('recovers malformed data with a visible issue and leaves unsupported future data untouched', () => {
    const storage = new MemoryStorage();
    storage.setItem(WORKSPACE_PREFERENCES_KEY, '{broken');
    const malformed = loadWorkspacePreferences(storage, '/vault');
    expect(malformed.preferences).toEqual(DEFAULT_WORKSPACE_PREFERENCES);
    expect(malformed.issue).toContain('malformed');

    const future = new MemoryStorage();
    const raw = JSON.stringify({ version: 9, global: { theme: 'dark' }, workspaces: {} });
    future.setItem(WORKSPACE_PREFERENCES_KEY, raw);
    expect(loadWorkspacePreferences(future, '/vault').issue).toContain('newer Nodus version');
    expect(saveWorkspacePreferences(future, '/vault', DEFAULT_WORKSPACE_PREFERENCES)).toBe(false);
    expect(saveGlobalTheme(future, 'light')).toBe(false);
    expect(future.getItem(WORKSPACE_PREFERENCES_KEY)).toBe(raw);
  });

  it('previews presets without mutating current preferences and supports persisted undo/reset', () => {
    const storage = new MemoryStorage();
    const current = { ...DEFAULT_WORKSPACE_PREFERENCES, editor: { ...DEFAULT_WORKSPACE_PREFERENCES.editor, width: 'full' as const } };
    const applied = makeWorkspacePreset(current, 'research');
    expect(current.editor.width).toBe('full');
    expect(applied.preferences.editor.layout).toBe('split');
    expect(restoreWorkspacePreset(applied.undo)).toEqual(current);

    loadWorkspacePreferences(storage, '/vault');
    expect(saveGlobalTheme(storage, 'dark')).toBe(true);
    expect(saveWorkspacePreferences(storage, '/vault', applied.preferences, applied.undo)).toBe(true);
    expect(loadWorkspacePreferences(storage, '/vault').undo).toEqual(applied.undo);
    expect(clearWorkspacePreferences(storage, '/vault')).toBe(true);
    expect(loadWorkspacePreferences(storage, '/vault')).toMatchObject({ preferences: DEFAULT_WORKSPACE_PREFERENCES, theme: 'dark', undo: null });
  });

  it('keeps per-user storage failures non-fatal', () => {
    expect(loadWorkspacePreferences(null, '/vault').issue).toContain('unavailable');
    const failing = { getItem: () => null, setItem: () => { throw new Error('denied'); } };
    expect(loadWorkspacePreferences(failing, '/vault').issue).toContain('Could not save migrated');
    expect(saveWorkspacePreferences(failing, '/vault', DEFAULT_WORKSPACE_PREFERENCES)).toBe(false);
  });
});
