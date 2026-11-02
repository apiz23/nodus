import { describe, expect, it, vi } from 'vitest';
import {
  dedupeCommands,
  executeCommand,
  groupCommands,
  scoreCommand,
  searchCommands,
  type CommandLike,
} from '../ui/src/commands.js';
import {
  findShortcutConflicts,
  isTextEntryDescriptor,
  matchShortcut,
  shortcutLabel,
  shortcutsByGroup,
  shouldHandleShortcut,
  SHORTCUTS,
  type ShortcutContext,
} from '../ui/src/shortcuts.js';
import {
  RECENT_NOTES_LIMIT,
  RECENT_NOTES_STORAGE_KEY,
  clearRecentNotes,
  readRecentNotes,
  recordRecentNote,
  removeRecentNote,
  resolveRecentNotes,
  type RecentNote,
  type RecentNotesStorage,
} from '../ui/src/recentNavigation.js';

function command(id: string, title: string, category: CommandLike['category'] = 'Notes', keywords = ''): CommandLike {
  return { id, title, category, keywords };
}

class MemoryStorage implements RecentNotesStorage {
  data = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const context: ShortcutContext = {
  composing: false,
  defaultPrevented: false,
  busy: false,
  modalOpen: false,
  paletteOpen: false,
  insidePalette: false,
  searchInput: false,
  textEntry: false,
  inEditor: false,
};

describe('command registry and search', () => {
  it('keeps the first registration and drops duplicate ids', () => {
    const first = command('new-note', 'New note');
    const duplicate = command('new-note', 'Create note');
    expect(dedupeCommands([first, duplicate])).toEqual([first]);
  });

  it('ranks exact title matches before prefix, title tokens, and keyword matches', () => {
    const commands = [
      command('keyword', 'Preferences', 'Navigation', 'settings'),
      command('contains', 'Workspace settings', 'Navigation'),
      command('prefix', 'Settings and vault', 'Navigation'),
      command('exact', 'Settings', 'Navigation'),
    ];
    expect(searchCommands(commands, 'settings').map((item) => item.id)).toEqual([
      'exact', 'prefix', 'contains', 'keyword',
    ]);
    expect(scoreCommand(commands[0]!, 'settings')).toBe(4);
  });

  it('matches every query token across name, keywords, and category', () => {
    const commands = [
      command('graph', 'Local graph', 'Navigation', 'links connections'),
      command('theme', 'Use dark theme', 'Appearance', 'appearance color'),
      command('db', 'Reading list', 'Databases', 'records'),
    ];
    expect(searchCommands(commands, 'graph links').map((item) => item.id)).toEqual(['graph']);
    expect(searchCommands(commands, 'dark appearance').map((item) => item.id)).toEqual(['theme']);
    expect(searchCommands(commands, 'database reading').map((item) => item.id)).toEqual(['db']);
    expect(searchCommands(commands, 'nothing-here')).toEqual([]);
  });

  it('hides empty-state-only commands from the default list but keeps them searchable', () => {
    const commands = [
      command('before', 'Visible'),
      { ...command('folder', 'Open folder: Notes', 'Folders'), showInEmpty: false },
    ];
    expect(searchCommands(commands, '').map((item) => item.id)).toEqual(['before']);
    expect(searchCommands(commands, 'folder').map((item) => item.id)).toEqual(['folder']);
  });

  it('groups commands by category in first-seen order', () => {
    const groups = groupCommands([
      command('a', 'A', 'Navigation'),
      command('b', 'B', 'Notes'),
      command('c', 'C', 'Navigation'),
    ]);
    expect(groups.map((group) => [group.category, group.commands.map((item) => item.id)])).toEqual([
      ['Navigation', ['a', 'c']],
      ['Notes', ['b']],
    ]);
  });

  it('normalizes command execution success and failure', async () => {
    await expect(executeCommand({ run: () => {} })).resolves.toEqual({ ok: true });
    await expect(executeCommand({ run: async () => { throw new Error('Vault is busy.'); } })).resolves.toEqual({
      ok: false, error: 'Vault is busy.',
    });
    await expect(executeCommand({ run: () => { throw new Error(''); } })).resolves.toEqual({
      ok: false, error: 'The command could not be completed.',
    });
  });
});

describe('shortcut registry', () => {
  it('has no conflicting default bindings', () => {
    expect(findShortcutConflicts()).toEqual([]);
  });

  it('detects duplicate bindings, including modifier differences', () => {
    const conflicts = findShortcutConflicts([
      { ...SHORTCUTS[0]!, id: 'new-note', label: 'One' },
      { ...SHORTCUTS[0]!, id: 'save-note', label: 'Two' },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.ids).toEqual(['new-note', 'save-note']);
  });

  it('labels platform-specific modifiers and keys', () => {
    expect(shortcutLabel({ mod: true, key: 'k' }, 'mac')).toBe('⌘K');
    expect(shortcutLabel({ mod: true, key: 'k' }, 'other')).toBe('Ctrl+K');
    expect(shortcutLabel({ mod: true, shift: true, key: 'h' }, 'mac')).toBe('⌘⇧H');
    expect(shortcutLabel({ mod: true, shift: true, key: 'h' }, 'other')).toBe('Ctrl+Shift+H');
    expect(shortcutLabel({ mod: true, key: '/' }, 'other')).toBe('Ctrl+/');
  });

  it('matches shortcuts by key and exact shift/alt modifiers', () => {
    expect(matchShortcut({ key: 'k', metaKey: true }, 'mac')).toBe('command-palette');
    expect(matchShortcut({ key: 'k', ctrlKey: true }, 'other')).toBe('command-palette');
    expect(matchShortcut({ key: 'K', ctrlKey: true }, 'other')).toBe('command-palette');
    expect(matchShortcut({ key: 'h', ctrlKey: true, shiftKey: true }, 'other')).toBe('recent-notes');
    expect(matchShortcut({ key: 'h', ctrlKey: true }, 'other')).toBeNull();
    expect(matchShortcut({ key: 's', ctrlKey: true, altKey: true }, 'other')).toBeNull();
    expect(matchShortcut({ key: 's' }, 'other')).toBeNull();
  });

  it('does not collide with editor formatting shortcuts', () => {
    const editorCombos = [
      { key: 'b' }, { key: 'i' }, { key: 'x', shiftKey: true }, { key: 'e' },
      { key: 'c', shiftKey: true }, { key: 'k', shiftKey: true },
      { key: '1', altKey: true }, { key: '6', altKey: true }, { key: '7', shiftKey: true }, { key: '8', shiftKey: true },
    ];
    for (const combo of editorCombos) {
      expect(matchShortcut({ ...combo, ctrlKey: true }, 'other')).toBeNull();
    }
    expect(matchShortcut({ key: 'k', ctrlKey: true }, 'other')).toBe('command-palette');
  });

  it('groups shortcuts for the reference UI in stable order', () => {
    const sections = shortcutsByGroup('other');
    expect(sections.map((section) => section.group)).toEqual(['Workspace', 'Notes', 'Help']);
    expect(sections[0]?.items[0]?.label).toBe('Ctrl+K');
    expect(sections[2]?.items[0]?.label).toBe('Ctrl+/');
  });
});

describe('shortcut focus policy', () => {
  it('blocks new-note while typing but allows save in the editor', () => {
    expect(shouldHandleShortcut('new-note', { ...context, textEntry: true })).toBe(false);
    expect(shouldHandleShortcut('save-note', { ...context, textEntry: true, inEditor: true })).toBe(true);
    expect(shouldHandleShortcut('save-note', { ...context, textEntry: true })).toBe(false);
  });

  it('keeps the command palette available from the editor and sidebar search', () => {
    expect(shouldHandleShortcut('command-palette', { ...context, textEntry: true, inEditor: true })).toBe(true);
    expect(shouldHandleShortcut('command-palette', { ...context, textEntry: true, searchInput: true })).toBe(true);
    expect(shouldHandleShortcut('command-palette', { ...context, textEntry: true })).toBe(false);
  });

  it('allows recent notes from the editor and the shortcut reference from any text field', () => {
    expect(shouldHandleShortcut('recent-notes', { ...context, textEntry: true, inEditor: true })).toBe(true);
    expect(shouldHandleShortcut('recent-notes', { ...context, textEntry: true })).toBe(false);
    expect(shouldHandleShortcut('shortcut-reference', { ...context, textEntry: true })).toBe(true);
  });

  it('only toggles the palette while it is open and blocks modal/busy/composing states', () => {
    expect(shouldHandleShortcut('command-palette', { ...context, paletteOpen: true })).toBe(true);
    expect(shouldHandleShortcut('save-note', { ...context, paletteOpen: true })).toBe(false);
    expect(shouldHandleShortcut('save-note', { ...context, modalOpen: true })).toBe(false);
    expect(shouldHandleShortcut('save-note', { ...context, busy: true })).toBe(false);
    expect(shouldHandleShortcut('save-note', { ...context, composing: true })).toBe(false);
    expect(shouldHandleShortcut('save-note', { ...context, defaultPrevented: true })).toBe(false);
    expect(shouldHandleShortcut('command-palette', { ...context, defaultPrevented: true, insidePalette: true })).toBe(true);
  });

  it('classifies text entry without suppressing global shortcuts for buttons', () => {
    expect(isTextEntryDescriptor({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextEntryDescriptor({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTextEntryDescriptor({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntryDescriptor({ tagName: 'SELECT' })).toBe(true);
    expect(isTextEntryDescriptor({ tagName: 'DIV', contentEditable: true })).toBe(true);
    expect(isTextEntryDescriptor({ tagName: 'DIV', role: 'textbox' })).toBe(true);
    expect(isTextEntryDescriptor({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextEntryDescriptor({ tagName: 'BUTTON', type: 'button' })).toBe(false);
    expect(isTextEntryDescriptor(null)).toBe(false);
  });
});

describe('recent-note navigation persistence', () => {
  const note = (id: string, title = id, path = `notes/${id}.md`) => ({ id, title, path });

  it('records newest first, deduplicates by stable note id, and caps the history', () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < RECENT_NOTES_LIMIT + 3; index += 1) {
      recordRecentNote(storage, '/vault', note(`note-${index}`), );
    }
    recordRecentNote(storage, '/vault', note('note-4', 'Updated title'));
    const entries = readRecentNotes(storage, '/vault');
    expect(entries).toHaveLength(RECENT_NOTES_LIMIT);
    expect(entries[0]?.id).toBe('note-4');
    expect(entries[0]?.title).toBe('Updated title');
    expect(entries.filter((entry) => entry.id === 'note-4')).toHaveLength(1);
    expect(entries.at(-1)?.id).toBe('note-3');
  });

  it('isolates vaults and supports removing or clearing one vault', () => {
    const storage = new MemoryStorage();
    recordRecentNote(storage, '/vault-a', note('a'));
    recordRecentNote(storage, '/vault-b', note('b'));
    expect(readRecentNotes(storage, '/vault-a').map((entry) => entry.id)).toEqual(['a']);
    expect(readRecentNotes(storage, '/vault-b').map((entry) => entry.id)).toEqual(['b']);
    removeRecentNote(storage, '/vault-a', 'a');
    expect(readRecentNotes(storage, '/vault-a')).toEqual([]);
    expect(readRecentNotes(storage, '/vault-b').map((entry) => entry.id)).toEqual(['b']);
    clearRecentNotes(storage, '/vault-b');
    expect(readRecentNotes(storage, '/vault-b')).toEqual([]);
    expect(storage.getItem(RECENT_NOTES_STORAGE_KEY)).toBeNull();
  });

  it('reconciles moved notes by id and omits deleted destinations', () => {
    const entries: RecentNote[] = [
      { id: 'moved', title: 'Old', path: 'notes/old.md', openedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'deleted', title: 'Gone', path: 'notes/gone.md', openedAt: '2026-01-01T00:00:00.000Z' },
    ];
    expect(resolveRecentNotes(entries, [note('moved', 'New title', 'archive/new.md')])).toEqual([
      { id: 'moved', title: 'New title', path: 'archive/new.md', openedAt: '2026-01-02T00:00:00.000Z' },
    ]);
  });

  it('recovers from malformed JSON, unknown versions, and invalid entries', () => {
    const storage = new MemoryStorage();
    storage.setItem(RECENT_NOTES_STORAGE_KEY, '{not json');
    expect(readRecentNotes(storage, '/vault')).toEqual([]);

    storage.setItem(RECENT_NOTES_STORAGE_KEY, JSON.stringify({ version: 2, vaults: {} }));
    expect(readRecentNotes(storage, '/vault')).toEqual([]);

    storage.setItem(RECENT_NOTES_STORAGE_KEY, JSON.stringify({
      version: 1,
      vaults: {
        '/vault': [
          { id: '', title: 'Missing id', path: 'notes/a.md', openedAt: '2026-01-01T00:00:00.000Z' },
          { id: 'bad-date', title: 'Bad date', path: 'notes/b.md', openedAt: 'not-a-date' },
          { id: 'good', title: 'Good', path: 'notes/c.md', openedAt: '2026-01-01T00:00:00.000Z' },
        ],
      },
    }));
    expect(readRecentNotes(storage, '/vault').map((entry) => entry.id)).toEqual(['good']);
  });

  it('does not throw when preference storage is unavailable or full', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(() => recordRecentNote(storage, '/vault', note('a'))).not.toThrow();
    expect(readRecentNotes(storage, '/vault')).toEqual([]);
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: vi.fn(),
    };
    expect(readRecentNotes(throwing, '/vault')).toEqual([]);
    expect(recordRecentNote(throwing, '/vault', note('a'))).toEqual([]);
  });
});
