import { describe, expect, it } from 'vitest';
import {
  clearGraphPathHistory,
  graphPathHistoryStorageKey,
  loadGraphPathHistory,
  parseGraphPathHistory,
  pruneGraphPathHistory,
  recordGraphPathHistory,
  writeGraphPathHistory,
} from '../ui/src/graph-path-history.js';
import type { StorageLike } from '../ui/src/graph-saved-views.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function storage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe('graph path history', () => {
  it('records, deduplicates, bounds, and scopes history by vault', () => {
    let history = recordGraphPathHistory([], { fromId: A, toId: B, mode: 'directed', length: 1 }, '2026-11-03T00:00:00Z');
    history = recordGraphPathHistory(history, { fromId: A, toId: B, mode: 'directed', length: 1 }, '2026-11-03T01:00:00Z');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromId: A, toId: B, length: 1, visitedAt: '2026-11-03T01:00:00Z' });
    for (let index = 0; index < 25; index += 1) history = recordGraphPathHistory(history, { fromId: A, toId: C, mode: index % 2 === 0 ? 'directed' : 'undirected', length: index });
    expect(history.length).toBeLessThanOrEqual(20);

    const store = storage();
    writeGraphPathHistory(store, '/vault/one', history);
    expect(loadGraphPathHistory(store, '/vault/one')).toHaveLength(history.length);
    expect(loadGraphPathHistory(store, '/vault/two')).toEqual([]);
    expect(graphPathHistoryStorageKey('/vault/one')).not.toBe(graphPathHistoryStorageKey('/vault/two'));
  });

  it('survives renames/moves by ID, prunes deleted notes, and recovers malformed data', () => {
    let history = recordGraphPathHistory([], { fromId: A, toId: B, mode: 'directed', length: 2 }, '2026-11-03T00:00:00Z');
    history = recordGraphPathHistory(history, { fromId: B, toId: C, mode: 'undirected', length: 1 }, '2026-11-03T00:01:00Z');
    expect(pruneGraphPathHistory(history, new Set([A, B, C]))).toHaveLength(2);
    expect(pruneGraphPathHistory(history, new Set([A, C]))).toHaveLength(0);
    expect(parseGraphPathHistory('{bad')).toEqual([]);
    expect(parseGraphPathHistory(JSON.stringify({ version: 99, entries: history }))).toEqual([]);
    expect(parseGraphPathHistory(JSON.stringify({ version: 1, entries: [history[0], { ...history[0] }, { id: 'bad' }] }))).toHaveLength(1);
    expect(clearGraphPathHistory()).toEqual([]);
  });
});
