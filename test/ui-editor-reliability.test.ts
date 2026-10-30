import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiNote, UiNoteSummary, UiVaultStatus } from '../src/ui-server/dto.js';
import { AUTOSAVE_DELAY_MS } from '../ui/src/scheduleAutosave.js';
import { ApiError } from '../ui/src/api.js';

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
  search: vi.fn(), deleteNote: vi.fn(),
}));
const mockJournal = vi.hoisted(() => ({
  list: vi.fn(), write: vi.fn(), adopt: vi.fn(), clearThrough: vi.fn(), deleteNote: vi.fn(),
  pruneMissing: vi.fn(), allowNote: vi.fn(),
}));
let storedPreferences = new Map<string, string>();
let shortcutEvents = new EventTarget();
let visibilityEvents = new EventTarget();
let visibilityState = 'visible';
const confirmDiscard = vi.fn<() => boolean>();

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: hooks.useState, useRef: hooks.useRef, useEffect: hooks.useEffect, useMemo: hooks.useMemo,
}));
vi.mock('@/components/ui/button', () => ({ Button: 'test-button' }));
vi.mock('@/lib/utils', () => ({ cn: (...parts: unknown[]) => parts.filter(Boolean).join(' ') }));
vi.mock('../ui/src/api', () => ({ api: mockApi, ApiError: class extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
} }));
vi.mock('../ui/src/Editor', () => ({ Editor: 'test-editor' }));
vi.mock('../ui/src/Sidebar', () => ({ Sidebar: 'test-sidebar' }));
vi.mock('../ui/src/SettingsView', () => ({ SettingsView: 'test-settings' }));
vi.mock('../ui/src/CommandPalette', () => ({ CommandPalette: 'test-palette' }));
vi.mock('../ui/src/DatabasesView', () => ({ DatabasesView: 'test-databases' }));
vi.mock('../ui/src/BacklinksPanel', () => ({ BacklinksPanel: 'test-backlinks' }));
vi.mock('../ui/src/NoteDialogs', () => ({ DeleteDialog: 'test-delete', RenameDialog: 'test-rename' }));
vi.mock('../ui/src/editor/DraftRecoveryDialog', () => ({ DraftRecoveryDialog: 'test-recovery-dialog' }));
vi.mock('../ui/src/editor/ConflictResolutionDialog', () => ({ ConflictResolutionDialog: 'test-conflict-dialog' }));
vi.mock('../ui/src/editor/ExternalChangeDialog', () => ({ ExternalChangeDialog: 'test-external-dialog', ExternalChangeNotice: 'test-external-notice' }));
vi.mock('../ui/src/draftRecoveryJournal', () => ({ IndexedDbDraftJournal: class {
  list(...args: unknown[]) { return mockJournal.list(...args); }
  write(...args: unknown[]) { return mockJournal.write(...args); }
  adopt(...args: unknown[]) { return mockJournal.adopt(...args); }
  clearThrough(...args: unknown[]) { return mockJournal.clearThrough(...args); }
  deleteNote(...args: unknown[]) { return mockJournal.deleteNote(...args); }
  pruneMissing(...args: unknown[]) { return mockJournal.pruneMissing(...args); }
  allowNote(...args: unknown[]) { return mockJournal.allowNote(...args); }
} }));

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
const recoveredDraft = {
  vaultIdentity: status.vault.path, noteId: a.id, writerId: 'previous-session', revision: 9,
  title: 'Recovered title', body: 'Draft with ![image](../attachments/saved.png)', icon: '📌', iconTouched: true,
  baseHash: a.contentHash, updatedAt: '2026-10-25T12:30:00.000Z',
};

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

function shortcut(key: string, modifier: 'ctrlKey' | 'metaKey' = 'ctrlKey', target = new ShortcutElement(), prevented = false, isComposing = false, keyCode = 0): KeyboardEvent {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperties(event, {
    key: { value: key }, ctrlKey: { value: modifier === 'ctrlKey' }, metaKey: { value: modifier === 'metaKey' },
    target: { value: target }, isComposing: { value: isComposing }, keyCode: { value: keyCode },
  });
  if (prevented) event.preventDefault();
  shortcutEvents.dispatchEvent(event);
  return event as KeyboardEvent;
}

function compositionEvent(type: 'compositionstart' | 'compositionend'): void {
  (globalThis as unknown as { document: { dispatchEvent(event: Event): boolean } }).document.dispatchEvent(new Event(type));
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
  mockApi.deleteNote.mockResolvedValue({ deleted: true });
  mockJournal.list.mockResolvedValue([]);
  mockJournal.write.mockResolvedValue(undefined);
  mockJournal.adopt.mockResolvedValue(undefined);
  mockJournal.clearThrough.mockResolvedValue(undefined);
  mockJournal.deleteNote.mockResolvedValue(undefined);
  mockJournal.pruneMissing.mockResolvedValue(undefined);
  mockJournal.allowNote.mockResolvedValue(undefined);
  shortcutEvents = new EventTarget();
  visibilityEvents = new EventTarget();
  visibilityState = 'visible';
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
  vi.stubGlobal('document', {
    documentElement: { classList: { toggle: () => {} }, dataset: {} },
    get visibilityState() { return visibilityState; },
    addEventListener: visibilityEvents.addEventListener.bind(visibilityEvents),
    removeEventListener: visibilityEvents.removeEventListener.bind(visibilityEvents),
    dispatchEvent: visibilityEvents.dispatchEvent.bind(visibilityEvents),
    getElementById: () => null,
  });
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

  it.each([
    ['Japanese composition', 'あ'],
    ['Chinese composition', '中'],
    ['legacy IME process key', 'Process'],
  ])('does not run global shortcuts during %s', async (_label, key) => {
    await mount(); await open(a.id); await edit(`${key} input in progress`);
    compositionEvent('compositionstart');
    const editorTarget = new ShortcutElement('div', ['[aria-label="Editor"]'], true);
    const save = shortcut('s', 'ctrlKey', editorTarget, false, true);
    const create = shortcut('n', 'metaKey', new ShortcutElement(), false, true);
    const legacy = shortcut('s', 'ctrlKey', editorTarget, false, false, 229);
    expect(save.defaultPrevented).toBe(false);
    expect(create.defaultPrevented).toBe(false);
    expect(legacy.defaultPrevented).toBe(false);
    expect(mockApi.saveNote).not.toHaveBeenCalled();
    expect(mockApi.createNote).not.toHaveBeenCalled();
    expect(props('test-editor')).toMatchObject({ body: `${key} input in progress`, dirty: true });
    compositionEvent('compositionend');
    shortcut('s', 'ctrlKey', editorTarget); await flush();
    expect(mockApi.saveNote).toHaveBeenCalledOnce();
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

describe('durable draft recovery integration', () => {
  it('journals dirty content by vault and stable note ID without copying attachment bytes', async () => {
    await mount(); await open(a.id);
    await edit('Text ![diagram](../attachments/diagram.png)');
    const entry = mockJournal.write.mock.calls.at(-1)?.[0];
    expect(entry).toMatchObject({
      vaultIdentity: status.vault.path, noteId: a.id, title: a.title, baseHash: a.contentHash,
      body: 'Text ![diagram](../attachments/diagram.png)', iconTouched: false,
    });
    expect(entry).not.toHaveProperty('attachmentBytes');
  });

  it('offers a recovered draft after a simulated fresh app load and restores it without writing Markdown', async () => {
    mockJournal.list.mockResolvedValue([recoveredDraft]);
    await mount(); await open(a.id);
    expect(props('test-recovery-dialog').entries).toEqual([recoveredDraft]);
    expect(props('test-editor')).toMatchObject({ note: a, body: a.body, dirty: false });
    expect(mockApi.saveNote).not.toHaveBeenCalled();

    await props('test-recovery-dialog').onRecover(recoveredDraft); await flush();
    expect(mockJournal.adopt).toHaveBeenCalledWith(recoveredDraft, expect.objectContaining({
      vaultIdentity: status.vault.path, noteId: a.id, writerId: expect.any(String), body: recoveredDraft.body,
    }));
    expect(props('test-editor')).toMatchObject({
      note: a, title: recoveredDraft.title, body: recoveredDraft.body, icon: recoveredDraft.icon,
      dirty: true, saveState: 'idle',
    });
    expect(mockApi.saveNote).not.toHaveBeenCalled();
  });

  it('retains the journal entry base hash when recovering a draft based on older disk content', async () => {
    mockJournal.list.mockResolvedValue([{ ...recoveredDraft, baseHash: 'old-disk-hash' }]);
    await mount(); await open(a.id);
    expect(props('test-recovery-dialog').diskHash).toBe(a.contentHash);
    await props('test-recovery-dialog').onRecover({ ...recoveredDraft, baseHash: 'old-disk-hash' }); await flush();
    shortcut('s');
    expect(mockApi.saveNote).toHaveBeenCalledWith(a.id, expect.objectContaining({ baseHash: 'old-disk-hash' }));
  });

  it('clears only the saved revision after success and preserves the entry after failed or stale saves', async () => {
    await mount(); await open(a.id); await edit('saved draft');
    shortcut('s'); await flush();
    expect(mockJournal.clearThrough).toHaveBeenCalledWith(status.vault.path, a.id, expect.any(String), expect.any(Number));

    mockJournal.clearThrough.mockClear();
    mockApi.saveNote.mockRejectedValue(new Error('This note changed on disk after you opened it.'));
    await edit('conflicting draft'); shortcut('s'); await flush();
    expect(props('test-editor')).toMatchObject({ body: 'conflicting draft', dirty: true, saveState: 'error' });
    expect(mockJournal.clearThrough).not.toHaveBeenCalled();
  });

  it('discards only the selected recovery row and keeps note and vault keys isolated', async () => {
    const otherNote = { ...recoveredDraft, noteId: b.id, writerId: 'other-note' };
    const otherVault = { ...recoveredDraft, vaultIdentity: '/another/vault', writerId: 'other-vault' };
    const allEntries = [recoveredDraft, otherNote, otherVault];
    mockJournal.list.mockImplementation(async (vaultIdentity: string, noteId: string) => allEntries.filter((entry) => entry.vaultIdentity === vaultIdentity && entry.noteId === noteId));
    await mount(); await open(a.id);
    const dialog = props('test-recovery-dialog');
    expect(dialog.entries).toEqual([recoveredDraft]);
    expect(mockJournal.list).toHaveBeenLastCalledWith(status.vault.path, a.id);
    await dialog.onDiscard(recoveredDraft); await flush();
    expect(mockJournal.clearThrough).toHaveBeenCalledWith(status.vault.path, a.id, 'previous-session', 9);
    expect(props('test-recovery-dialog').entries).toEqual([]);
    await open(b.id);
    expect(props('test-recovery-dialog').entries).toEqual([otherNote]);
    expect(mockJournal.list).toHaveBeenLastCalledWith(status.vault.path, b.id);
  });

  it('does not associate a pending write with the next note', async () => {
    const pending = deferred<void>();
    mockJournal.write.mockReturnValue(pending.promise);
    await mount(); await open(a.id); await edit('A journal');
    await open(b.id); await edit('B journal');
    expect(mockJournal.write.mock.calls.some(([entry]) => entry.noteId === a.id && entry.body === 'A journal')).toBe(true);
    expect(mockJournal.write.mock.calls.some(([entry]) => entry.noteId === b.id && entry.body === 'B journal')).toBe(true);
    pending.resolve(); await flush();
  });

  it('keeps editing available when IndexedDB reads or writes fail', async () => {
    mockJournal.write.mockRejectedValue(new Error('quota exceeded'));
    await mount(); await open(a.id); await edit('Still editable'); await flush();
    expect(props('test-editor')).toMatchObject({ body: 'Still editable', dirty: true });
    expect(mockJournal.write).toHaveBeenCalled();
  });

  it('does not offer a recovery draft when the stable note ID no longer exists', async () => {
    mockApi.notes.mockResolvedValue({ notes: [a] });
    mockApi.note.mockRejectedValue(new Error('Note not found'));
    mockJournal.list.mockResolvedValue([recoveredDraft]);
    await mount();
    expect(props('test-recovery-dialog').entries).toEqual([]);
    expect(mockJournal.list).not.toHaveBeenCalled();
  });

  it('keeps an identical recovery row visible if its cleanup transaction fails', async () => {
    const identical = { ...recoveredDraft, title: a.title, body: a.body, icon: a.icon };
    mockJournal.list.mockResolvedValue([identical]);
    mockJournal.clearThrough.mockRejectedValue(new Error('database busy'));
    await mount(); await open(a.id);
    expect(props('test-recovery-dialog').entries).toEqual([identical]);
  });

  it('clears every recovery writer when a note is deleted', async () => {
    await mount(); await open(a.id);
    props('test-sidebar').onDeleteNote(a.id); await flush();
    props('test-delete').onConfirm(); await flush();
    expect(mockApi.deleteNote).toHaveBeenCalledWith(a.id, { baseHash: a.contentHash });
    expect(mockJournal.deleteNote).toHaveBeenCalledWith(status.vault.path, a.id);
  });

  it('keeps vault journals isolated when switching vaults', async () => {
    await mount(); await open(a.id); await edit('Old vault draft');
    props('test-sidebar').onView('settings'); await flush();
    props('test-settings').onVaultPathDraftChange('/synthetic/other'); await flush();
    props('test-settings').onOpenVault(); await flush();
    expect(mockJournal.clearThrough).toHaveBeenCalledWith(status.vault.path, a.id, expect.any(String), expect.any(Number));
    expect(mockJournal.list).not.toHaveBeenCalledWith('/synthetic/other', a.id);
    expect(props('test-editor')).toMatchObject({ note: null, dirty: false });
  });
});

describe('stale-write conflict recovery', () => {
  const disk = makeNote(a.id, 'Latest disk body', 'latest-disk-hash');

  async function enterConflict() {
    mockApi.note.mockResolvedValueOnce({ note: a }).mockResolvedValueOnce({ note: disk });
    await mount(); await open(a.id); await edit('Local draft with ![image](assets/diagram.png)');
    mockApi.saveNote.mockRejectedValueOnce(new ApiError(409, 'STALE_WRITE', 'Changed on disk'));
    shortcut('s'); await flush();
  }

  it('retrieves and compares the latest disk version while preserving the local journal and blocking repeated autosaves', async () => {
    await enterConflict();
    expect(mockApi.note).toHaveBeenLastCalledWith(a.id);
    expect(props('test-conflict-dialog').conflict).toMatchObject({
      noteId: a.id, baseHash: a.contentHash, baseNote: a, diskNote: disk,
      draft: { body: 'Local draft with ![image](assets/diagram.png)' }, deleted: false,
    });
    expect(props('test-editor')).toMatchObject({ body: 'Local draft with ![image](assets/diagram.png)', dirty: true });
    expect(mockJournal.clearThrough).not.toHaveBeenCalled();
    shortcut('s'); await flush();
    expect(mockApi.saveNote).toHaveBeenCalledOnce();
  });

  it('uses the disk version only after selection and then clears the accepted recovery revision', async () => {
    await enterConflict();
    await props('test-conflict-dialog').onUseDisk(); await flush();
    expect(props('test-editor')).toMatchObject({ note: disk, title: disk.title, body: disk.body, dirty: false });
    expect(props('test-conflict-dialog').conflict).toBeNull();
    expect(mockJournal.clearThrough).toHaveBeenCalledWith(status.vault.path, a.id, expect.any(String), expect.any(Number));
  });

  it('requires the resolution action to save against the reviewed disk hash', async () => {
    await enterConflict();
    const dialog = props('test-conflict-dialog');
    await dialog.onSaveOverDisk(); await flush();
    expect(mockApi.saveNote).toHaveBeenLastCalledWith(a.id, expect.objectContaining({
      body: 'Local draft with ![image](assets/diagram.png)', baseHash: disk.contentHash,
    }));
    expect(props('test-conflict-dialog').conflict).toBeNull();
  });

  it('shows a new conflict instead of retrying when disk changes again during explicit resolution', async () => {
    const newer = makeNote(a.id, 'Changed again', 'second-disk-hash');
    await enterConflict();
    mockApi.note.mockResolvedValueOnce({ note: newer });
    mockApi.saveNote.mockRejectedValueOnce(new ApiError(409, 'STALE_WRITE', 'Changed again'));
    await props('test-conflict-dialog').onSaveOverDisk(); await flush();
    expect(mockApi.saveNote).toHaveBeenCalledTimes(2);
    expect(props('test-conflict-dialog').conflict.diskNote).toEqual(newer);
    expect(props('test-conflict-dialog').conflict.draft.body).toContain('Local draft');
    expect(mockJournal.clearThrough).not.toHaveBeenCalled();
  });

  it('handles a deleted note separately and keeps the draft available', async () => {
    mockApi.note.mockResolvedValueOnce({ note: a });
    await mount(); await open(a.id); await edit('Keep after delete');
    mockApi.saveNote.mockRejectedValueOnce(new ApiError(409, 'STALE_WRITE', 'Changed on disk'));
    mockApi.note.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'Deleted'));
    shortcut('s'); await flush();
    expect(props('test-conflict-dialog').conflict).toMatchObject({ deleted: true, diskNote: null });
    expect(props('test-editor')).toMatchObject({ body: 'Keep after delete', dirty: true });
    expect(mockJournal.clearThrough).not.toHaveBeenCalled();
  });

  it('preserves the recovery entry when a conflict resolution save fails', async () => {
    await enterConflict();
    mockApi.saveNote.mockRejectedValueOnce(new Error('disk busy'));
    await props('test-conflict-dialog').onSaveOverDisk(); await flush();
    expect(props('test-conflict-dialog').conflict.error).toBe('disk busy');
    expect(props('test-editor')).toMatchObject({ body: 'Local draft with ![image](assets/diagram.png)', dirty: true });
    expect(mockJournal.clearThrough).not.toHaveBeenCalled();
  });

  it('creates a separate note with the same attachment references and only then retires the original recovery copy', async () => {
    await enterConflict();
    const copy = makeNote('synthetic-copy', 'Local draft with ![image](assets/diagram.png)', 'copy-hash');
    mockApi.createNote.mockResolvedValueOnce({ note: copy });
    await props('test-conflict-dialog').onSaveSeparate(); await flush();
    expect(mockApi.createNote).toHaveBeenCalledWith(expect.objectContaining({
      folder: 'notes', body: 'Local draft with ![image](assets/diagram.png)', icon: null,
    }));
    expect(props('test-editor')).toMatchObject({ note: copy, body: copy.body, dirty: false });
    expect(mockJournal.clearThrough).toHaveBeenCalled();
  });

  it('leaves the conflict behind when note creation fails and drops dialog state on note navigation', async () => {
    await enterConflict();
    mockApi.createNote.mockRejectedValueOnce(new Error('path collision'));
    await props('test-conflict-dialog').onSaveSeparate(); await flush();
    expect(props('test-conflict-dialog').conflict.error).toContain('path collision');
    expect(mockJournal.clearThrough).not.toHaveBeenCalled();
    await open(b.id);
    expect(props('test-conflict-dialog').conflict).toBeNull();
  });

  it('does not carry an open conflict into another vault', async () => {
    await enterConflict();
    props('test-sidebar').onView('settings'); await flush();
    props('test-settings').onVaultPathDraftChange('/synthetic/other'); await flush();
    props('test-settings').onOpenVault(); await flush();
    expect(props('test-conflict-dialog').conflict).toBeNull();
    expect(props('test-editor')).toMatchObject({ note: null, dirty: false });
    expect(mockApi.note).not.toHaveBeenCalledWith(a.id, '/synthetic/other');
  });
});

describe('external note change checks', () => {
  const latest = makeNote(a.id, 'External edit', 'external-hash');

  it('checks a clean note when the browser becomes visible and offers compare then explicit reload', async () => {
    await mount(); await open(a.id);
    mockApi.note.mockResolvedValueOnce({ note: latest });
    visibilityEvents.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(props('test-external-notice')).toMatchObject({ note: latest, error: null });
    expect(props('test-editor')).toMatchObject({ note: a, body: a.body, dirty: false });

    props('test-external-notice').onCompare(); await flush();
    expect(props('test-external-dialog')).toMatchObject({ open: true, current: a, latest });
    mockApi.note.mockResolvedValueOnce({ note: latest });
    await props('test-external-dialog').onReload(); await flush();
    expect(props('test-editor')).toMatchObject({ note: latest, body: latest.body, dirty: false });
    expect(props('test-external-notice').note).toBeNull();
  });

  it('checks on window focus and coalesces focus plus visibility events', async () => {
    await mount(); await open(a.id);
    mockApi.note.mockResolvedValueOnce({ note: latest });
    shortcutEvents.dispatchEvent(new Event('focus'));
    visibilityEvents.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(mockApi.note).toHaveBeenCalledTimes(2); // initial open plus one coalesced check
    expect(props('test-external-notice').note).toEqual(latest);
  });

  it('announces a failed external check and supports an explicit retry', async () => {
    await mount(); await open(a.id);
    mockApi.note.mockRejectedValueOnce(new Error('local API unavailable'));
    shortcutEvents.dispatchEvent(new Event('focus'));
    await flush();
    expect(props('test-external-notice').error).toContain('local API unavailable');
    mockApi.note.mockResolvedValueOnce({ note: latest });
    await props('test-external-notice').onRetry(); await flush();
    expect(props('test-external-notice')).toMatchObject({ error: null, note: latest });
  });

  it('preserves dirty drafts and opens conflict comparison instead of replacing them', async () => {
    await mount(); await open(a.id); await edit('Local edit kept');
    mockApi.note.mockResolvedValueOnce({ note: latest });
    visibilityEvents.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(props('test-conflict-dialog').conflict).toMatchObject({ diskNote: latest, draft: { body: 'Local edit kept' } });
    expect(props('test-editor')).toMatchObject({ body: 'Local edit kept', dirty: true });
    expect(mockApi.saveNote).not.toHaveBeenCalled();
    expect(mockJournal.write).toHaveBeenCalled();
  });

  it('does not check again while a conflict is unresolved', async () => {
    await mount(); await open(a.id); await edit('Local edit');
    mockApi.saveNote.mockRejectedValueOnce(new ApiError(409, 'STALE_WRITE', 'Changed'));
    mockApi.note.mockResolvedValueOnce({ note: latest });
    shortcut('s'); await flush();
    const noteCalls = mockApi.note.mock.calls.length;
    visibilityEvents.dispatchEvent(new Event('visibilitychange'));
    shortcutEvents.dispatchEvent(new Event('focus'));
    await flush();
    expect(mockApi.note).toHaveBeenCalledTimes(noteCalls);
    expect(props('test-conflict-dialog').conflict.diskNote).toEqual(latest);
  });

  it('ignores a slow check after switching to another note', async () => {
    const pending = deferred<{ note: UiNote }>();
    await mount(); await open(a.id);
    mockApi.note.mockReturnValueOnce(pending.promise);
    shortcutEvents.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    await open(b.id);
    pending.resolve({ note: latest }); await flush();
    expect(props('test-editor')).toMatchObject({ note: b, body: b.body });
    expect(props('test-external-notice').note).toBeNull();
  });

  it('ignores an older same-note check after explicit reload has applied its revision', async () => {
    const pending = deferred<{ note: UiNote }>();
    await mount(); await open(a.id);
    mockApi.note.mockResolvedValueOnce({ note: latest });
    visibilityEvents.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(props('test-external-notice').note).toEqual(latest);

    vi.advanceTimersByTime(901);
    mockApi.note.mockReturnValueOnce(pending.promise);
    shortcutEvents.dispatchEvent(new Event('focus'));
    await Promise.resolve();

    mockApi.note.mockResolvedValueOnce({ note: latest });
    await props('test-external-notice').onReload();
    await flush();
    expect(props('test-editor')).toMatchObject({ note: latest, body: latest.body, dirty: false });

    pending.resolve({ note: latest });
    await flush();
    expect(props('test-external-notice').note).toBeNull();
  });

  it('turns a noticed external update into a conflict before saving a new local edit', async () => {
    await mount(); await open(a.id);
    mockApi.note.mockResolvedValueOnce({ note: latest });
    visibilityEvents.dispatchEvent(new Event('visibilitychange')); await flush();
    await edit('New local edit');
    shortcut('s'); await flush();
    expect(props('test-conflict-dialog').conflict).toMatchObject({ diskNote: latest, draft: { body: 'New local edit' } });
    expect(mockApi.saveNote).not.toHaveBeenCalled();
  });
});
