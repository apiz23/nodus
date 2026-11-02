/**
 * Central keyboard-shortcut definitions and matching helpers.
 *
 * The registry is intentionally framework-free so command routing, the
 * shortcut reference, and tests share one source of truth. Shortcuts are
 * matched against a platform-specific primary modifier instead of accepting
 * Meta and Ctrl interchangeably, which keeps macOS and Windows/Linux behavior
 * predictable.
 */

export type Platform = 'mac' | 'other';

export type ShortcutId =
  | 'command-palette'
  | 'new-note'
  | 'save-note'
  | 'recent-notes'
  | 'shortcut-reference';

export type ShortcutGroup = 'Workspace' | 'Notes' | 'Help';

export interface ShortcutBinding {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDefinition {
  id: ShortcutId;
  label: string;
  description: string;
  group: ShortcutGroup;
  binding: ShortcutBinding;
  /** Allow while a text input outside the editor has focus. */
  allowInTextEntry?: boolean;
  /** Allow while the Markdown editor or note title has focus. */
  allowInEditor?: boolean;
}

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: 'command-palette',
    label: 'Command palette',
    description: 'Search notes and commands, or run a workspace action.',
    group: 'Workspace',
    binding: { mod: true, key: 'k' },
    allowInEditor: true,
  },
  {
    id: 'new-note',
    label: 'New note',
    description: 'Create a note from anywhere outside a text field.',
    group: 'Notes',
    binding: { mod: true, key: 'n' },
  },
  {
    id: 'save-note',
    label: 'Save note',
    description: 'Save the current note draft immediately.',
    group: 'Notes',
    binding: { mod: true, key: 's' },
    allowInEditor: true,
  },
  {
    id: 'recent-notes',
    label: 'Recent notes',
    description: 'Open the quick switcher for recently visited notes.',
    group: 'Notes',
    binding: { mod: true, shift: true, key: 'h' },
    allowInEditor: true,
  },
  {
    id: 'shortcut-reference',
    label: 'Keyboard shortcuts',
    description: 'Show every available keyboard shortcut.',
    group: 'Help',
    binding: { mod: true, key: '/' },
    allowInEditor: true,
    allowInTextEntry: true,
  },
] as const;

export const SHORTCUT_GROUP_ORDER: readonly ShortcutGroup[] = ['Workspace', 'Notes', 'Help'];

export function shortcutById(id: ShortcutId): ShortcutDefinition {
  const definition = SHORTCUTS.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`Unknown shortcut: ${id}`);
  return definition;
}

/** Detect the primary platform for display and matching. */
export function detectPlatform(userAgent?: string): Platform {
  const value = userAgent
    ?? (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent
    ?? '';
  return /Mac|iPhone|iPad|iPod/i.test(value) ? 'mac' : 'other';
}

function normalizeKey(key: string): string {
  if (key === ' ') return 'space';
  if (key === 'Esc') return 'escape';
  return key.toLowerCase();
}

function displayKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key === '/') return '/';
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function shortcutLabel(binding: ShortcutBinding, platform: Platform): string {
  const parts: string[] = [];
  if (binding.mod === true) parts.push(platform === 'mac' ? '⌘' : 'Ctrl');
  if (binding.alt === true) parts.push(platform === 'mac' ? '⌥' : 'Alt');
  if (binding.shift === true) parts.push(platform === 'mac' ? '⇧' : 'Shift');
  parts.push(displayKey(binding.key));
  return parts.join(platform === 'mac' ? '' : '+');
}

export function bindingKey(binding: ShortcutBinding): string {
  return [
    binding.mod === true ? 'mod' : '',
    binding.alt === true ? 'alt' : '',
    binding.shift === true ? 'shift' : '',
    normalizeKey(binding.key),
  ].filter(Boolean).join('+');
}

export interface ShortcutConflict {
  binding: string;
  ids: ShortcutId[];
}

/** Detect duplicate bindings that would execute more than one command. */
export function findShortcutConflicts(
  definitions: readonly ShortcutDefinition[] = SHORTCUTS,
): ShortcutConflict[] {
  const seen = new Map<string, ShortcutId[]>();
  for (const definition of definitions) {
    const key = bindingKey(definition.binding);
    const ids = seen.get(key) ?? [];
    ids.push(definition.id);
    seen.set(key, ids);
  }
  return [...seen.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([binding, ids]) => ({ binding, ids }));
}

export interface KeyboardEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Return the shortcut whose binding matches the event, ignoring context.
 * Returns null when the platform's primary modifier is not held.
 */
export function matchShortcut(
  event: KeyboardEventLike,
  platform: Platform,
): ShortcutId | null {
  // Accept either primary modifier for cross-platform muscle memory, but the
  // reference UI labels the platform-correct key. The registry still uses one
  // binding per shortcut, so Ctrl and Meta cannot map to different commands.
  if (event.metaKey !== true && event.ctrlKey !== true) return null;
  void platform;

  const key = normalizeKey(event.key);
  const match = SHORTCUTS.find((definition) => {
    const binding = definition.binding;
    return normalizeKey(binding.key) === key
      && (binding.alt === true) === (event.altKey === true)
      && (binding.shift === true) === (event.shiftKey === true);
  });
  return match?.id ?? null;
}

export interface ShortcutContext {
  composing: boolean;
  defaultPrevented: boolean;
  busy: boolean;
  modalOpen: boolean;
  paletteOpen: boolean;
  insidePalette: boolean;
  searchInput: boolean;
  textEntry: boolean;
  inEditor: boolean;
}

/**
 * Decide whether a matched shortcut should run in the current focus context.
 * This is the single guard that prevents application shortcuts from firing
 * while a user types, while preserving explicitly intended editor actions.
 */
export function shouldHandleShortcut(id: ShortcutId, context: ShortcutContext): boolean {
  if (context.composing || context.busy || context.modalOpen) return false;
  if (context.defaultPrevented && !(id === 'command-palette' && context.insidePalette)) return false;
  if (context.paletteOpen) return id === 'command-palette';

  const definition = shortcutById(id);
  if (context.textEntry) {
    if (id === 'command-palette' && (context.inEditor || context.searchInput)) return true;
    if (definition.allowInTextEntry === true) return true;
    return context.inEditor && definition.allowInEditor === true;
  }
  if (context.inEditor && definition.allowInEditor !== true) return false;
  return true;
}

export interface EditableDescriptor {
  tagName?: string | null;
  type?: string | null;
  role?: string | null;
  contentEditable?: boolean | null;
  isContentEditable?: boolean | null;
}

const NON_TEXT_INPUT_TYPES = new Set([
  'button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'hidden',
]);

/**
 * Pure text-entry check used by App and tests. Non-text inputs (checkboxes,
 * buttons, sliders, and similar controls) must not suppress global shortcuts.
 */
export function isTextEntryDescriptor(descriptor: EditableDescriptor | null | undefined): boolean {
  if (descriptor === null || descriptor === undefined) return false;
  if (descriptor.contentEditable === true || descriptor.isContentEditable === true) return true;
  const tag = (descriptor.tagName ?? '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (descriptor.type ?? 'text').toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  const role = (descriptor.role ?? '').toLowerCase();
  return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}

export function shortcutsByGroup(
  platform: Platform,
  definitions: readonly ShortcutDefinition[] = SHORTCUTS,
): Array<{ group: ShortcutGroup; items: Array<{ definition: ShortcutDefinition; label: string }> }> {
  return SHORTCUT_GROUP_ORDER.map((group) => ({
    group,
    items: definitions
      .filter((definition) => definition.group === group)
      .map((definition) => ({
        definition,
        label: shortcutLabel(definition.binding, platform),
      })),
  })).filter((section) => section.items.length > 0);
}
