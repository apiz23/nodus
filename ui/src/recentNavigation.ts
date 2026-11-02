/**
 * Recent-note navigation persisted in localStorage, reusing the same
 * best-effort UI preference pattern as theme, sidebar width, and editor width.
 *
 * Records are keyed by vault identity, use stable note IDs, and are reconciled
 * against the current note list before display so deleted notes disappear and
 * moved/renamed notes keep their updated title and path.
 */

export const RECENT_NOTES_STORAGE_KEY = 'nodus-recent-notes-v1';
export const RECENT_NOTES_LIMIT = 12;

export interface RecentNote {
  id: string;
  title: string;
  path: string;
  openedAt: string;
}

export interface RecentNotesStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

interface StoredRecentNotes {
  version: 1;
  vaults: Record<string, RecentNote[]>;
}

export interface RecentNoteInput {
  id: string;
  title: string;
  path: string;
  openedAt?: string;
}

export interface RecentNoteSummary {
  id: string;
  title: string;
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validEntry(value: unknown): RecentNote | null {
  if (!isRecord(value)) return null;
  const { id, title, path, openedAt } = value;
  if (typeof id !== 'string' || id.trim() === '') return null;
  if (typeof title !== 'string') return null;
  if (typeof path !== 'string') return null;
  if (typeof openedAt !== 'string' || Number.isNaN(Date.parse(openedAt))) return null;
  return { id, title, path, openedAt };
}

function sanitizeEntries(value: unknown): RecentNote[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: RecentNote[] = [];
  for (const candidate of value) {
    const entry = validEntry(candidate);
    if (entry === null || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
    if (entries.length >= RECENT_NOTES_LIMIT) break;
  }
  return entries;
}

function readStore(storage: RecentNotesStorage): StoredRecentNotes {
  try {
    const raw = storage.getItem(RECENT_NOTES_STORAGE_KEY);
    if (raw === null || raw === '') return { version: 1, vaults: {} };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.vaults)) {
      return { version: 1, vaults: {} };
    }
    return { version: 1, vaults: parsed.vaults as Record<string, RecentNote[]> };
  } catch {
    return { version: 1, vaults: {} };
  }
}

function writeStore(storage: RecentNotesStorage, store: StoredRecentNotes): boolean {
  try {
    if (Object.keys(store.vaults).length === 0 && storage.removeItem !== undefined) {
      storage.removeItem(RECENT_NOTES_STORAGE_KEY);
      return true;
    }
    storage.setItem(RECENT_NOTES_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    // Preferences are best effort. A full or unavailable storage must never
    // block navigation or surface an error into the workspace.
    return false;
  }
}

/** Read and validate recent notes for one vault. Corrupt data returns []. */
export function readRecentNotes(storage: RecentNotesStorage, vaultKey: string): RecentNote[] {
  if (vaultKey === '') return [];
  const store = readStore(storage);
  return sanitizeEntries(store.vaults[vaultKey]);
}

/** Record a successfully opened note, newest first, with a bounded history. */
export function recordRecentNote(
  storage: RecentNotesStorage,
  vaultKey: string,
  note: RecentNoteInput,
): RecentNote[] {
  if (vaultKey === '') return [];
  const store = readStore(storage);
  const current = sanitizeEntries(store.vaults[vaultKey]);
  const entry: RecentNote = {
    id: note.id,
    title: note.title,
    path: note.path,
    openedAt: note.openedAt ?? new Date().toISOString(),
  };
  const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, RECENT_NOTES_LIMIT);
  store.vaults = { ...store.vaults, [vaultKey]: next };
  return writeStore(storage, store) ? next : [];
}

/** Remove a deleted note from history without touching other vaults. */
export function removeRecentNote(
  storage: RecentNotesStorage,
  vaultKey: string,
  noteId: string,
): RecentNote[] {
  if (vaultKey === '') return [];
  const store = readStore(storage);
  const next = sanitizeEntries(store.vaults[vaultKey]).filter((entry) => entry.id !== noteId);
  const vaults = { ...store.vaults };
  if (next.length === 0) delete vaults[vaultKey];
  else vaults[vaultKey] = next;
  store.vaults = vaults;
  writeStore(storage, store);
  return next;
}

/** Clear recent notes for one vault only. */
export function clearRecentNotes(storage: RecentNotesStorage, vaultKey: string): RecentNote[] {
  if (vaultKey === '') return [];
  const store = readStore(storage);
  const next = { ...store.vaults };
  delete next[vaultKey];
  store.vaults = next;
  writeStore(storage, store);
  return [];
}

/**
 * Reconcile stored entries against the current note list.
 * Deleted notes are omitted; moved or renamed notes take current metadata.
 */
export function resolveRecentNotes(
  entries: readonly RecentNote[],
  notes: readonly RecentNoteSummary[],
): RecentNote[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const result: RecentNote[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    const note = byId.get(entry.id);
    if (note === undefined) continue;
    seen.add(entry.id);
    result.push({ ...entry, title: note.title, path: note.path });
  }
  return result;
}
