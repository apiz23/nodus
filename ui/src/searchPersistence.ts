import type { NoteFilter, NoteFilterLogic } from '../../src/search/note-filters.js';

export const SEARCH_PREFERENCES_KEY = 'nodus-search-preferences-v1';
export const SEARCH_HISTORY_LIMIT = 20;
export interface SearchDefinition { id: string; name: string; query: string; filters: NoteFilter[]; logic: NoteFilterLogic; updatedAt: string }
export interface SearchHistoryEntry { query: string; filters: NoteFilter[]; logic: NoteFilterLogic; searchedAt: string }
export interface SearchPreferencesStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
interface VaultPreferences { saved: SearchDefinition[]; history: SearchHistoryEntry[] }
interface Store { version: 1; vaults: Record<string, VaultPreferences> }

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function validFilter(value: unknown): value is NoteFilter {
  if (!record(value)) return false;
  if (value.type === 'tag') return ['contains', 'does-not-contain', 'contains-all'].includes(String(value.operator)) && (typeof value.value === 'string' || Array.isArray(value.value));
  return value.type === 'property' && typeof value.propertyId === 'string' && typeof value.operator === 'string';
}
function safeFilters(value: unknown): NoteFilter[] { return Array.isArray(value) ? value.filter(validFilter).slice(0, 20) : []; }
function safeDefinition(value: unknown): SearchDefinition | null {
  if (!record(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || !value.name.trim() || typeof value.query !== 'string') return null;
  if (value.logic !== 'and' && value.logic !== 'or') return null;
  return { id: value.id, name: value.name.trim().slice(0, 80), query: value.query.slice(0, 500), filters: safeFilters(value.filters), logic: value.logic,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString() };
}
function safeHistory(value: unknown): SearchHistoryEntry | null {
  if (!record(value) || typeof value.query !== 'string' || !value.query.trim() || (value.logic !== 'and' && value.logic !== 'or')) return null;
  return { query: value.query.slice(0, 500), filters: safeFilters(value.filters), logic: value.logic,
    searchedAt: typeof value.searchedAt === 'string' ? value.searchedAt : new Date(0).toISOString() };
}
function read(storage: SearchPreferencesStorage): Store {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SEARCH_PREFERENCES_KEY) ?? 'null');
    if (!record(parsed) || parsed.version !== 1 || !record(parsed.vaults)) return { version: 1, vaults: {} };
    return { version: 1, vaults: parsed.vaults as Record<string, VaultPreferences> };
  } catch { return { version: 1, vaults: {} }; }
}
function current(storage: SearchPreferencesStorage, vault: string): VaultPreferences {
  const candidate = read(storage).vaults[vault];
  if (!record(candidate)) return { saved: [], history: [] };
  return { saved: Array.isArray(candidate.saved) ? candidate.saved.map(safeDefinition).filter((item): item is SearchDefinition => item !== null).slice(0, 50) : [],
    history: Array.isArray(candidate.history) ? candidate.history.map(safeHistory).filter((item): item is SearchHistoryEntry => item !== null).slice(0, SEARCH_HISTORY_LIMIT) : [] };
}
function write(storage: SearchPreferencesStorage, vault: string, preferences: VaultPreferences): boolean {
  if (!vault) return false;
  try { const store = read(storage); store.vaults[vault] = preferences; storage.setItem(SEARCH_PREFERENCES_KEY, JSON.stringify(store)); return true; }
  catch { return false; }
}

export function readSearchPreferences(storage: SearchPreferencesStorage, vault: string): VaultPreferences { return current(storage, vault); }
export function saveSearchDefinition(storage: SearchPreferencesStorage, vault: string, name: string, query: string, filters: readonly NoteFilter[], logic: NoteFilterLogic, id: string = crypto.randomUUID()): SearchDefinition | null {
  const trimmed = name.trim();
  const existing = current(storage, vault);
  if (!trimmed || existing.saved.some((item) => item.name.toLowerCase() === trimmed.toLowerCase() && item.id !== id)) return null;
  const definition: SearchDefinition = { id, name: trimmed, query: query.slice(0, 500), filters: [...filters], logic, updatedAt: new Date().toISOString() };
  const next = existing.saved.filter((item) => item.id !== id);
  next.unshift(definition);
  return write(storage, vault, { ...existing, saved: next.slice(0, 50) }) ? definition : null;
}
export function removeSearchDefinition(storage: SearchPreferencesStorage, vault: string, id: string): boolean {
  const existing = current(storage, vault); return write(storage, vault, { ...existing, saved: existing.saved.filter((item) => item.id !== id) });
}
export function recordSearchHistory(storage: SearchPreferencesStorage, vault: string, query: string, filters: readonly NoteFilter[], logic: NoteFilterLogic, searchedAt = new Date().toISOString()): void {
  if (!query.trim() && !filters.length) return;
  const existing = current(storage, vault);
  const key = JSON.stringify([query.trim(), filters, logic]);
  const history = [{ query, filters: [...filters], logic, searchedAt }, ...existing.history.filter((item) => JSON.stringify([item.query.trim(), item.filters, item.logic]) !== key)].slice(0, SEARCH_HISTORY_LIMIT);
  write(storage, vault, { ...existing, history });
}
export function removeSearchHistory(storage: SearchPreferencesStorage, vault: string, index: number): boolean {
  const existing = current(storage, vault); return write(storage, vault, { ...existing, history: existing.history.filter((_, i) => i !== index) });
}
export function clearSearchHistory(storage: SearchPreferencesStorage, vault: string): boolean {
  const existing = current(storage, vault); return write(storage, vault, { ...existing, history: [] });
}
