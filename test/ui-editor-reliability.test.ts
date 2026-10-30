import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiNote, UiNoteSummary, UiVaultStatus } from '../src/ui-server/dto.js';
import { AUTOSAVE_DELAY_MS } from '../ui/src/scheduleAutosave.js';

// Run App callbacks/effects without a browser dependency. Child surfaces are
// inert elements; only React's hook scheduling is emulated, with explicit flushes.
const hooks = vi.hoisted(() => {
  const slots: Array<{ value?: unknown; deps?: unknown[]; cleanup?: () => void }> = [];
  let cursor = 0;
  let effects: Array<() => void> = [];
  let pending = false;
  return {
    reset() { slots.length = 0; cursor = 0; effects = []; pending = false; },
    begin() { cursor = 0; pending = false; },
    commit() { const next = effects; effects = []; next.forEach((effect) => effect()); },
    pending() { return pending; },
    dispose() { slots.forEach((slot) => slot.cleanup?.()); },
    useState(initial: unknown) {
      const index = cursor++;
      const slot = slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slot.value, (next: unknown) => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; pending = true; }
      }];
    },
    useRef(initial: unknown) {
      const slot = slots[cursor++] ??= { value: { current: initial } };
      return slot.value;
    },
    useMemo(factory: () => unknown, deps: unknown[]) {
      const slot = slots[cursor++] ??= {};
      if (slot.deps === undefined || deps.some((dep, index) => !Object.is(dep, slot.deps?.[index]))) {
        slot.value = factory();
        slot.deps = deps;
      }
      return slot.value;
    },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const slot = slots[cursor++] ??= {};
      const changed = deps === undefined || slot.deps === undefined || deps.some((dep, index) => !Object.is(dep, slot.deps?.[index]));
      slot.deps = deps;
      if (changed) effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
    },
  };
});

const mockApi = vi.hoisted(() => ({
  status: vi.fn(), notes: vi.fn(), folders: vi.fn(), databases: vi.fn(), note: vi.fn(), saveNote: vi.fn(),
  createNote: vi.fn(),
  openVault: vi.fn(), pickVault: vi.fn(),
  search: vi.fn(),
}));
let storedPreferences = new Map<string, string>();
let shortcutEvents = new EventTarget();
const confirmDiscard = vi.fn<() => boolean>();

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: hooks.useState, useRef: hooks.useRef, useEffect: hooks.useEffect, useMemo: hooks.useMemo,
}));
vi.mock('@/components/ui/button', () => ({ Button: 'test-button' }));
vi.mock('@/lib/utils', () => ({ cn: (...parts: unknown[]) => parts.filter(Boolean).join(' ') }));
vi.mock('../ui/src/api', () => ({ api: mockApi, ApiError: class extends Error {} }));
vi.mock('../ui/src/Editor', () => ({ Editor: 'test-editor' }));
vi.mock('../ui/src/Sidebar', () => ({ Sidebar: 'test-sidebar' }));
vi.mock('../ui/src/SettingsView', () => ({ SettingsView: 'test-settings' }));
vi.mock('../ui/src/CommandPalette', () => ({ CommandPalette: 'test-palette' }));
vi.mock('../ui/src/DatabasesView', () => ({ DatabasesView: 'test-databases' }));
vi.mock('../ui/src/BacklinksPanel', () => ({ BacklinksPanel: 'test-backlinks' }));
vi.mock('../ui/src/NoteDialogs', () => ({ DeleteDialog: 'test-delete', RenameDialog: 'test-rename' }));

type Element = { type: unknown; props: Record<string, any> };
const { default: App } = await vi.importActual<{ default: () => Element }>('../ui/src/App.tsx');
let tree: Element;

function render(): void { hooks.begin(); tree = App(); hooks.commit(); }
async function flush(): Promise<void> {
  // Drain the finite API/React microtask chains, without advancing timers.
  for (let step = 0; step < 20; step++) { await Promise.resolve(); if (hooks.pending()) render(); }
}
function props(type: string): Record<string, any> {
  function find(node: unknown): Element | undefined {
    if (Array.isArray(node)) return node.map(find).find(Boolean);
    if (typeof node !== 'object' || node === null || !('props' in node)) return undefined;
    const element = node as Element;
    return element.type === type ? element : find(element.props.children);
  }
  const element = find(tree);
  if (element === undefined) throw new Error(`Missing surface ${type}`);
  return element.props;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const makeNote = (id: string, body = id, contentHash = `${id}-hash`): UiNote => ({
  id, title: id, path: `notes/${id}.md`, body, contentHash, icon: null,
  updatedAt: '2026-10-25T12:00:00Z', createdAt: '2026-10-25T12:00:00Z',
  tags: [], aliases: [], metadataKeys: [],
});
const a = makeNote('synthetic-a');
const b = makeNote('synthetic-b');
const status = { vault: { name: 'Fixture', path: '/synthetic/vault' } };

// Only the DOM target predicates used by the installed window listener are
// modeled here. Events themselves go through a real EventTarget below.
class ShortcutElement {
  constructor(readonly tag = 'button', readonly containers: string[] = [], readonly isContentEditable = false) {}
  closest(selector: string): ShortcutElement | null {
    return selector.split(',').some((part) => {
      const match = part.trim();
      return match === this.tag || this.containers.includes(match) || (match === '[contenteditable="true"]' && this.isContentEditable);
    }) ? this : null;
  }
  blur() {}
}

function shortcut(key: string, modifier: 'ctrlKey' | 'metaKey' = 'ctrlKey', target = new ShortcutElement(), prevented = false): KeyboardEvent {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperties(event, {
    key: { value: key }, ctrlKey: { value: modifier === 'ctrlKey' }, metaKey: { value: modifier === 'metaKey' },
    target: { value: target },
  });
  if (prevented) event.preventDefault();
  shortcutEvents.dispatchEvent(event);
  return event as KeyboardEvent;
}

async function mount(): Promise<void> { render(); await flush(); }
async function open(id: string): Promise<void> { props('test-sidebar').onOpen(id); await flush(); }
async function edit(body: string): Promise<void> { props('test-editor').onBodyChange(body); await flush(); }
async function debounce(): Promise<void> { vi.advanceTimersByTime(AUTOSAVE_DELAY_MS); await flush(); }

beforeEach(() => {
  vi.useFakeTimers(); hooks.reset(); vi.resetAllMocks();
  storedPreferences = new Map();
  mockApi.status.mockResolvedValue(status);
  mockApi.notes.mockResolvedValue({ notes: [] });
  mockApi.folders.mockResolvedValue({ folders: [] });
  mockApi.databases.mockResolvedValue({ databases: [] });
  mockApi.note.mockImplementation(async (id: string) => ({ note: id === a.id ? a : b }));
  mockApi.saveNote.mockImplementation(async (id: string, input: { body: string }) => ({ note: makeNote(id, input.body, `${id}-saved`) }));
  mockApi.openVault.mockResolvedValue({ vault: { name: 'Other', path: '/synthetic/other' } });
  mockApi.pickVault.mockResolvedValue({ canceled: true });
  mockApi.search.mockResolvedValue({ results: [] });
  mockApi.createNote.mockResolvedValue({ note: makeNote('synthetic-created', '') });
  shortcutEvents = new EventTarget();
  confirmDiscard.mockReturnValue(true);
  vi.stubGlobal('Element', ShortcutElement);
  vi.stubGlobal('HTMLElement', ShortcutElement);
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => storedPreferences.get(key) ?? null,
    setItem: (key: string, value: string) => { storedPreferences.set(key, value); },
  },
    confirm: confirmDiscard,
    addEventListener: shortcutEvents.addEventListener.bind(shortcutEvents),
    removeEventListener: shortcutEvents.removeEventListener.bind(shortcutEvents),
    dispatchEvent: shortcutEvents.dispatchEvent.bind(shortcutEvents),
    setTimeout, clearTimeout });
  vi.stubGlobal('document', { documentElement: { classList: { toggle: () => {} }, dataset: {} } });
});
afterEach(() => { hooks.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('installed editor keyboard listener', () => {
  describe.each(['ctrlKey', 'metaKey'] as const)('%s shortcuts', (modifier) => {
    it('saves the current complete draft immediately, without advancing the autosave clock', async () => {
      await mount(); await open(a.id); await edit('Current body');
      props('test-editor').onTitleChange('Current title');
      props('test-editor').onIconChange('📝'); await flush();
      const event = shortcut('s', modifier, new ShortcutElement('div', ['[aria-label="Editor"]'], true));
      expect(event.defaultPrevented).toBe(true);
      expect(mockApi.saveNote).toHaveBeenCalledExactlyOnceWith(a.id, {
        title: 'Current title', body: 'Current body', icon: '📝', baseHash: a.contentHash,
      });
      await flush(); await debounce();
      expect(mockApi.saveNote).toHaveBeenCalledTimes(1);
      const unload = new Event('beforeunload', { cancelable: true });
      shortcutEvents.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(false);
    });

    it('uses the new note and hash after switching notes', async () => {
      await mount(); await open(a.id); await open(b.id); await edit('B draft');
      props('test-editor').onTitleChange('B title'); await flush();
      shortcut('S', modifier);
      expect(mockApi.saveNote).toHaveBeenCalledExactlyOnceWith(b.id, {
        title: 'B title', body: 'B draft', baseHash: b.contentHash,
      });
    });

    it('confirms before creating a note and preserves the entire draft on cancellation', async () => {
      await mount(); await open(a.id); await open(b.id); await edit('Keep B body');
      props('test-editor').onTitleChange('Keep B title');
      props('test-editor').onIconChange('📌'); await flush();
      confirmDiscard.mockReturnValue(false);
      shortcut('n', modifier); await flush();
      expect(confirmDiscard).toHaveBeenCalledExactlyOnceWith('Discard unsaved changes and create a new note?');
      expect(mockApi.createNote).not.toHaveBeenCalled();
      expect(props('test-editor')).toMatchObject({ note: b, title: 'Keep B title', body: 'Keep B body', icon: '📌', dirty: true, saveState: 'idle' });
      expect(props('test-sidebar').selectedId).toBe(b.id);
      const unload = new Event('beforeunload', { cancelable: true });
      shortcutEvents.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
      shortcut('s', modifier);
      expect(mockApi.saveNote).toHaveBeenCalledExactlyOnceWith(b.id, {
        title: 'Keep B title', body: 'Keep B body', icon: '📌', baseHash: b.contentHash,
      });
    });

    it('creates exactly one note when discard is confirmed and creation is pending', async () => {
      const pending = deferred<{ note: UiNote }>();
      mockApi.createNote.mockReturnValue(pending.promise);
      await mount(); await open(a.id); await edit('Discard this draft');
      shortcut('n', modifier); shortcut('n', modifier); await flush();
      expect(confirmDiscard).toHaveBeenCalledTimes(1);
      expect(mockApi.createNote).toHaveBeenCalledExactlyOnceWith({ title: 'Untitled note' });
      pending.resolve({ note: makeNote('synthetic-created', '') }); await flush();
      expect(props('test-editor')).toMatchObject({ note: { id: 'synthetic-created' }, body: '', dirty: false });
    });

    it('does not save a clean draft, and creates a clean note without a discard prompt', async () => {
      await mount();
      shortcut('s', modifier);
      await open(a.id); shortcut('s', modifier);
      expect(mockApi.saveNote).not.toHaveBeenCalled();
      shortcut('n', modifier); await flush();
      expect(confirmDiscard).not.toHaveBeenCalled();
      expect(mockApi.createNote).toHaveBeenCalledTimes(1);
    });

    it('prevents overlapping saves and retains edits made during a shortcut save', async () => {
      const pending = deferred<{ note: UiNote }>();
      mockApi.saveNote.mockReturnValueOnce(pending.promise);
      await mount(); await open(a.id); await edit('First snapshot');
      shortcut('s', modifier); shortcut('s', modifier); await flush();
      await edit('Newer body');
      shortcut('s', modifier);
      await debounce();
      expect(mockApi.saveNote).toHaveBeenCalledTimes(1);
      pending.resolve({ note: makeNote(a.id, 'First snapshot', 'new-base-hash') }); await flush();
      expect(props('test-editor')).toMatchObject({ body: 'Newer body', dirty: true });
      shortcut('s', modifier);
      expect(mockApi.saveNote).toHaveBeenLastCalledWith(a.id, expect.objectContaining({ body: 'Newer body', baseHash: 'new-base-hash' }));
      expect(mockApi.saveNote).toHaveBeenCalledTimes(2);
    });

    it('uses the existing retry path after a save failure without clearing the draft', async () => {
      mockApi.saveNote.mockRejectedValueOnce(new Error('Save unavailable'));
      await mount(); await open(a.id); await edit('Recoverable draft');
      shortcut('s', modifier); await flush();
      expect(props('test-editor')).toMatchObject({ body: 'Recoverable draft', dirty: true, saveState: 'error', error: 'Save unavailable' });
      shortcut('s', modifier); await flush();
      expect(mockApi.saveNote).toHaveBeenCalledTimes(2);
      expect(mockApi.saveNote).toHaveBeenLastCalledWith(a.id, expect.objectContaining({ body: 'Recoverable draft', baseHash: a.contentHash }));
      expect(props('test-editor')).toMatchObject({ dirty: false, saveState: 'saved', error: null });
    });
  });

  it.each(['input', 'textarea', 'select', 'div'])('leaves %s text entry outside the editor alone', async (tag) => {
    await mount(); await open(a.id); await edit('Draft');
    const target = new ShortcutElement(tag, [], tag === 'div');
    expect(shortcut('s', 'ctrlKey', target).defaultPrevented).toBe(false);
    expect(shortcut('n', 'metaKey', target).defaultPrevented).toBe(false);
    expect(mockApi.saveNote).not.toHaveBeenCalled();
    expect(mockApi.createNote).not.toHaveBeenCalled();
  });

  it.each(['input', 'textarea', 'div'])('saves from editor %s but does not create while typing', async (tag) => {
    await mount(); await open(a.id); await edit('Editor draft');
    const target = new ShortcutElement(tag, ['[aria-label="Editor"]'], tag === 'div');
    expect(shortcut('n', 'ctrlKey', target).defaultPrevented).toBe(false);
    expect(mockApi.createNote).not.toHaveBeenCalled();
    expect(shortcut('s', 'metaKey', target).defaultPrevented).toBe(true);
    expect(mockApi.saveNote).toHaveBeenCalledTimes(1);
  });

  it('respects events already handled by CodeMirror or another control', async () => {
    await mount(); await open(a.id); await edit('Draft');
    shortcut('s', 'ctrlKey', new ShortcutElement('div', ['[aria-label="Editor"]'], true), true);
    shortcut('n', 'metaKey', new ShortcutElement(), true);
    expect(mockApi.saveNote).not.toHaveBeenCalled();
    expect(mockApi.createNote).not.toHaveBeenCalled();
  });

  it.each(['[role="dialog"]', '[role="alertdialog"]', '[data-slot="sheet-content"]'])('leaves shortcuts inside %s to that overlay', async (container) => {
    await mount(); await open(a.id); await edit('Draft');
    const target = new ShortcutElement('button', [container]);
    shortcut('s', 'ctrlKey', target); shortcut('n', 'metaKey', target);
    expect(mockApi.saveNote).not.toHaveBeenCalled();
    expect(mockApi.createNote).not.toHaveBeenCalled();
  });

  it('blocks shortcuts while the note-action dialog or command palette is open', async () => {
    await mount(); await open(a.id); await edit('Draft');
    props('test-sidebar').onRenameNote(b.id); await flush();
    shortcut('s'); shortcut('n');
    expect(mockApi.saveNote).not.toHaveBeenCalled();
    expect(mockApi.createNote).not.toHaveBeenCalled();
    props('test-rename').onCancel(); await flush();
    props('test-palette').onOpenChange(true); await flush();
    shortcut('s'); shortcut('n');
    expect(mockApi.saveNote).not.toHaveBeenCalled();
    expect(mockApi.createNote).not.toHaveBeenCalled();
  });

  it('blocks shortcuts during vault work and removes listeners on unmount', async () => {
    await mount(); await open(a.id); await edit('Draft');
    props('test-sidebar').onView('settings'); await flush();
    props('test-settings').onVaultWorkChange(true); await flush();
    shortcut('s'); shortcut('n');
    expect(mockApi.saveNote).not.toHaveBeenCalled();
    expect(mockApi.createNote).not.toHaveBeenCalled();
    props('test-settings').onVaultWorkChange(false); await flush();
    hooks.dispose();
    expect(shortcut('s').defaultPrevented).toBe(false);
    expect(shortcut('n').defaultPrevented).toBe(false);
    expect(mockApi.saveNote).not.toHaveBeenCalled();
    expect(mockApi.createNote).not.toHaveBeenCalled();
  });

  it('blocks shortcuts during a vault switch and resumes with the retained draft if switching is cancelled', async () => {
    const pending = deferred<{ canceled: true }>();
    mockApi.pickVault.mockReturnValue(pending.promise);
    await mount(); await open(a.id); await edit('Retained after picker cancellation');
    props('test-sidebar').onOpenAnotherVault(); await flush();
    shortcut('s'); shortcut('n', 'metaKey');
    expect(mockApi.saveNote).not.toHaveBeenCalled();
    expect(mockApi.createNote).not.toHaveBeenCalled();
    pending.resolve({ canceled: true }); await flush();
    shortcut('s', 'metaKey');
    expect(mockApi.saveNote).toHaveBeenCalledExactlyOnceWith(a.id, expect.objectContaining({ body: 'Retained after picker cancellation', baseHash: a.contentHash }));
  });
});

it('loads filesystem folders on startup even when there are no notes', async () => {
  const folders = ['Empty', 'Projects', 'Projects/Research'];
  mockApi.folders.mockResolvedValue({ folders });
  await mount();
  expect(props('test-sidebar')).toMatchObject({ notes: [], folders, folderError: null, loading: false });
});

it('keeps valid notes visible when startup folder loading fails and recovers on retry', async () => {
  mockApi.notes.mockResolvedValue({ notes: [a] });
  mockApi.folders.mockRejectedValueOnce(new Error('Folder listing unavailable'));
  await mount();
  expect(props('test-sidebar')).toMatchObject({ notes: [a], folderError: 'Folder listing unavailable' });
  mockApi.folders.mockResolvedValue({ folders: ['Empty'] });
  props('test-sidebar').onRetry(); await flush();
  expect(props('test-sidebar')).toMatchObject({ notes: [a], folders: ['Empty'], folderError: null });
});

it('debounces search and hides old results when the same query is cleared and entered again', async () => {
  const result = { ...a, snippet: 'Title: synthetic-a' };
  mockApi.search.mockResolvedValue({ results: [result] });
  await mount();
  props('test-sidebar').onQueryChange('synthetic'); await flush();
  vi.advanceTimersByTime(179); await flush();
  expect(mockApi.search).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); await flush();
  expect(props('test-sidebar').results).toEqual([result]);
  const pending = deferred<{ results: typeof result[] }>();
  mockApi.search.mockReturnValue(pending.promise);
  props('test-sidebar').onClearSearch(); await flush();
  props('test-sidebar').onQueryChange('synthetic'); await flush();
  expect(props('test-sidebar')).toMatchObject({ searching: true, results: [] });
  vi.advanceTimersByTime(180); await flush();
  expect(props('test-sidebar')).toMatchObject({ searching: true, results: [] });
  pending.resolve({ results: [] }); await flush();
  expect(props('test-sidebar')).toMatchObject({ searching: false, results: [] });
});

describe('editor request ownership', () => {
  it.each(['success', 'failure'])('ignores an older note-load %s after a newer note is edited', async (outcome) => {
    const old = deferred<{ note: UiNote }>();
    mockApi.note.mockImplementation((id: string) => id === a.id ? old.promise : Promise.resolve({ note: b }));
    await mount(); await open(a.id); await open(b.id); await edit('newer B draft');
    if (outcome === 'success') old.resolve({ note: a }); else old.reject(new Error('old read failed'));
    await flush();
    expect(props('test-editor')).toMatchObject({ note: b, body: 'newer B draft', dirty: true, error: null, loading: false });
    expect(props('test-sidebar').selectedId).toBe(b.id);
  });

  it('does not let an old completion clear the current load indicator', async () => {
    const old = deferred<{ note: UiNote }>(), current = deferred<{ note: UiNote }>();
    mockApi.note.mockImplementation((id: string) => id === a.id ? old.promise : current.promise);
    await mount(); await open(a.id); await open(b.id);
    old.resolve({ note: a }); await flush();
    expect(props('test-editor').loading).toBe(true);
    current.resolve({ note: b }); await flush();
    expect(props('test-editor')).toMatchObject({ note: b, loading: false });
  });

  it('ignores an initial automatic load after explicit navigation', async () => {
    const initial = deferred<{ note: UiNote }>();
    mockApi.notes.mockResolvedValue({ notes: [a] });
    mockApi.note.mockImplementation((id: string) => id === a.id ? initial.promise : Promise.resolve({ note: b }));
    await mount(); await open(b.id); await edit('newer B draft');
    initial.resolve({ note: a }); await flush();
    expect(props('test-editor')).toMatchObject({ note: b, body: 'newer B draft', dirty: true });
  });

  it('ignores a reload response after navigation to another note', async () => {
    await mount(); await open(a.id);
    const reload = deferred<{ note: UiNote }>();
    mockApi.note.mockImplementation((id: string) => id === a.id ? reload.promise : Promise.resolve({ note: b }));
    props('test-editor').onReload(); await flush();
    await open(b.id); await edit('newer B draft');
    reload.resolve({ note: a }); await flush();
    expect(props('test-editor')).toMatchObject({ note: b, body: 'newer B draft', dirty: true });
  });

  it('invalidates note loads when the vault changes', async () => {
    const old = deferred<{ note: UiNote }>();
    mockApi.note.mockReturnValue(old.promise);
    await mount(); await open(a.id);
    props('test-sidebar').onView('settings'); await flush();
    props('test-settings').onVaultPathDraftChange('/synthetic/other'); await flush();
    props('test-settings').onOpenVault(); await flush();
    old.resolve({ note: a }); await flush();
    expect(props('test-editor')).toMatchObject({ note: null, dirty: false, loading: false });
  });

  it('keeps section navigation separate from the selected note', async () => {
    await mount(); await open(a.id);
    props('test-sidebar').onView('settings'); await flush();
    expect(props('test-sidebar')).toMatchObject({ view: 'settings', selectedId: a.id });
    expect(props('test-settings').status).toEqual(status);
    props('test-sidebar').onView('databases'); await flush();
    expect(props('test-sidebar')).toMatchObject({ view: 'databases', selectedId: a.id });
    expect(props('test-databases').selectedId).toBe(null);
  });

  it('locks vault navigation while backup or restore API work is active', async () => {
    await mount();
    props('test-sidebar').onView('settings'); await flush();
    props('test-settings').onVaultWorkChange(true); await flush();
    expect(props('test-sidebar').navigationLocked).toBe(true);
    props('test-sidebar').onOpenAnotherVault(); await flush();
    expect(mockApi.pickVault).not.toHaveBeenCalled();
    expect(props('test-settings').error).toContain('Wait for current vault work');
    props('test-settings').onVaultWorkChange(false); await flush();
    expect(props('test-sidebar').navigationLocked).toBe(false);
  });

  it('ignores an old vault note-list response after switching roots', async () => {
    const stale = deferred<{ notes: UiNoteSummary[] }>();
    const nextSummary: UiNoteSummary = {
      id: b.id, title: 'Other vault note', path: 'notes/other.md',
      updatedAt: '2026-10-25T12:00:00Z', aliases: [], icon: null,
    };
    const oldSummary: UiNoteSummary = {
      id: a.id, title: 'Old vault note', path: 'notes/old.md',
      updatedAt: '2026-10-25T12:00:00Z', aliases: [], icon: null,
    };
    await mount();
    mockApi.notes.mockReturnValueOnce(stale.promise);
    props('test-sidebar').onRetry();
    await flush();

    const nextStatus: UiVaultStatus = {
      vault: { name: 'Other vault', path: '/synthetic/other' },
      counts: { notes: 1, databases: 0, issues: 0 },
      health: { issues: [] },
      sync: { status: 'not-connected', label: 'Not connected', detail: 'Local only' },
    };
    mockApi.pickVault.mockResolvedValue({ canceled: false, status: nextStatus });
    mockApi.notes.mockResolvedValue({ notes: [nextSummary] });
    props('test-sidebar').onOpenAnotherVault();
    await flush();
    expect(props('test-sidebar')).toMatchObject({ status: nextStatus, notes: [nextSummary] });

    stale.resolve({ notes: [oldSummary] });
    await flush();
    expect(props('test-sidebar').notes).toEqual([nextSummary]);
  });
});

describe('autosave completion', () => {
  it.each(['success', 'failure'])('resumes the new note after the old save completes with %s', async (outcome) => {
    const old = deferred<{ note: UiNote }>();
    mockApi.saveNote.mockImplementation((id: string, input: { body: string }) => id === a.id ? old.promise : Promise.resolve({ note: makeNote(id, input.body) }));
    await mount(); await open(a.id); await edit('A edit'); await debounce();
    await open(b.id); await edit('B edit'); await debounce();
    expect(mockApi.saveNote).toHaveBeenCalledTimes(1);
    if (outcome === 'success') old.resolve({ note: makeNote(a.id, 'A edit') }); else old.reject(new Error('A failed'));
    await flush(); await debounce();
    expect(mockApi.saveNote).toHaveBeenCalledTimes(2);
    expect(mockApi.saveNote).toHaveBeenLastCalledWith(b.id, expect.objectContaining({ body: 'B edit', baseHash: b.contentHash }));
    expect(props('test-editor')).toMatchObject({ body: 'B edit', dirty: false, saveState: 'saved', error: null });
  });

  it('keeps newer edits and saves them against the first response hash', async () => {
    const first = deferred<{ note: UiNote }>();
    mockApi.saveNote.mockImplementationOnce(() => first.promise);
    await mount(); await open(a.id); await edit('first draft'); await debounce();
    await edit('newer draft'); await debounce();
    expect(mockApi.saveNote).toHaveBeenCalledTimes(1);
    first.resolve({ note: makeNote(a.id, 'first draft', 'first-saved-hash') }); await flush();
    expect(props('test-editor')).toMatchObject({ body: 'newer draft', dirty: true });
    await debounce();
    expect(mockApi.saveNote).toHaveBeenLastCalledWith(a.id, expect.objectContaining({ body: 'newer draft', baseHash: 'first-saved-hash' }));
  });

  it('retains an active save failure without automatically retrying it', async () => {
    mockApi.saveNote.mockRejectedValue(new Error('disk failed'));
    await mount(); await open(a.id); await edit('unsaved draft'); await debounce();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 10); await flush();
    expect(mockApi.saveNote).toHaveBeenCalledTimes(1);
    expect(props('test-editor')).toMatchObject({ body: 'unsaved draft', dirty: true, saveState: 'error', error: 'disk failed' });
  });

  it('cancels the previous draft timer while another note is loading', async () => {
    await mount(); await open(a.id); await edit('discarded A edit');
    const loading = deferred<{ note: UiNote }>();
    mockApi.note.mockReturnValue(loading.promise);
    await open(b.id); await debounce();
    expect(mockApi.saveNote).not.toHaveBeenCalled();
    loading.resolve({ note: b }); await flush();
  });

  it('saves and reloads a long title without truncating it', async () => {
    const longTitle = 'A carefully worded title for a long Markdown note '.repeat(3).trim();
    let saved = makeNote(a.id);
    mockApi.note.mockImplementation(async () => ({ note: saved }));
    mockApi.saveNote.mockImplementation(async (id: string, input: { title: string; body: string }) => {
      saved = { ...makeNote(id, input.body, 'long-title-saved'), title: input.title };
      return { note: saved };
    });

    await mount(); await open(a.id);
    props('test-editor').onTitleChange(longTitle); await flush(); await debounce();
    expect(mockApi.saveNote).toHaveBeenLastCalledWith(a.id, expect.objectContaining({ title: longTitle }));
    props('test-editor').onReload(); await flush();
    expect(props('test-editor').title).toBe(longTitle);
  });

  it('persists the full-width editor preference through section navigation and reload', async () => {
    await mount(); await open(a.id);
    expect(props('test-editor').fullWidth).toBe(false);
    props('test-editor').onToggleWidth(); await flush();
    expect(props('test-editor').fullWidth).toBe(true);
    expect(storedPreferences.get('nodus-editor-width')).toBe('full');

    props('test-sidebar').onView('settings'); await flush();
    props('test-sidebar').onView('notes'); await flush();
    expect(props('test-editor').fullWidth).toBe(true);

    hooks.dispose(); hooks.reset();
    await mount();
    expect(props('test-editor').fullWidth).toBe(true);
  });

  it('opens row actions for a different note without changing selection or the dirty draft', async () => {
    await mount(); await open(a.id); await edit('unsaved draft');
    props('test-sidebar').onRenameNote(b.id); await flush();
    expect(mockApi.note).toHaveBeenLastCalledWith(b.id);
    expect(props('test-sidebar').selectedId).toBe(a.id);
    expect(props('test-editor')).toMatchObject({ note: a, body: 'unsaved draft', dirty: true });
    expect(props('test-rename')).toMatchObject({ open: true, value: b.path });
  });

  it('opens the existing delete confirmation for another row without discarding the active draft', async () => {
    await mount(); await open(a.id); await edit('unsaved draft');
    props('test-sidebar').onDeleteNote(b.id); await flush();
    expect(mockApi.note).toHaveBeenLastCalledWith(b.id);
    expect(props('test-sidebar').selectedId).toBe(a.id);
    expect(props('test-editor')).toMatchObject({ note: a, body: 'unsaved draft', dirty: true });
    expect(props('test-delete')).toMatchObject({ open: true, title: b.title, path: b.path });
  });
});
