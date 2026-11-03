import { describe, expect, it } from 'vitest';
import { clearSearchHistory, readSearchPreferences, recordSearchHistory, removeSearchDefinition, removeSearchHistory, saveSearchDefinition, SEARCH_PREFERENCES_KEY, type SearchPreferencesStorage } from '../ui/src/searchPersistence.js';

class MemoryStorage implements SearchPreferencesStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('vault-scoped saved searches and history', () => {
  it('saves, updates, renames, restores and deletes named definitions without storing results', () => {
    const storage = new MemoryStorage();
    const saved = saveSearchDefinition(storage, '/vault/a', 'Planning', 'tag:research', [], 'and')!;
    expect(saved).not.toBeNull();
    expect(saveSearchDefinition(storage, '/vault/a', 'planning', 'other', [], 'and')).toBeNull();
    const renamed = saveSearchDefinition(storage, '/vault/a', 'Weekly', 'tag:weekly', [], 'or', saved.id)!;
    expect(renamed.id).toBe(saved.id);
    expect(readSearchPreferences(storage, '/vault/a').saved[0]?.query).toBe('tag:weekly');
    expect(readSearchPreferences(storage, '/vault/b').saved).toEqual([]);
    expect(storage.getItem(SEARCH_PREFERENCES_KEY)).not.toContain('results');
    removeSearchDefinition(storage, '/vault/a', saved.id);
    expect(readSearchPreferences(storage, '/vault/a').saved).toEqual([]);
  });

  it('records completed query history, deduplicates, bounds it, and supports removal and clearing', () => {
    const storage = new MemoryStorage();
    recordSearchHistory(storage, '/vault/a', '  tag:work ', [], 'and', '2026-01-01T00:00:00Z');
    recordSearchHistory(storage, '/vault/a', 'tag:work', [], 'and', '2026-01-02T00:00:00Z');
    expect(readSearchPreferences(storage, '/vault/a').history).toHaveLength(1);
    expect(readSearchPreferences(storage, '/vault/a').history[0]?.searchedAt).toBe('2026-01-02T00:00:00Z');
    for (let i = 0; i < 30; i++) recordSearchHistory(storage, '/vault/a', `query ${i}`, [], 'and');
    expect(readSearchPreferences(storage, '/vault/a').history).toHaveLength(20);
    removeSearchHistory(storage, '/vault/a', 0);
    expect(readSearchPreferences(storage, '/vault/a').history).toHaveLength(19);
    clearSearchHistory(storage, '/vault/a');
    expect(readSearchPreferences(storage, '/vault/a').history).toEqual([]);
  });

  it('recovers malformed preference data without throwing and treats storage failure as optional', () => {
    const storage = new MemoryStorage();
    storage.values.set(SEARCH_PREFERENCES_KEY, '{broken');
    expect(readSearchPreferences(storage, '/vault/a')).toEqual({ saved: [], history: [] });
    const unavailable: SearchPreferencesStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(saveSearchDefinition(unavailable, '/vault/a', 'x', 'q', [], 'and')).toBeNull();
  });
});
