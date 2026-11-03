import type { GraphTraversalMode } from '../../src/links/graph-paths.js';
import type { StorageLike } from './graph-saved-views.js';

export const GRAPH_PATH_HISTORY_VERSION = 1;
export const GRAPH_PATH_HISTORY_LIMIT = 20;

export interface GraphPathHistoryEntry {
  id: string;
  fromId: string;
  toId: string;
  mode: GraphTraversalMode;
  length: number;
  visitedAt: string;
}

export function graphPathHistoryStorageKey(vaultKey: string): string {
  return `nodus.graph-path-history.v${GRAPH_PATH_HISTORY_VERSION}:${vaultKey}`;
}

export function parseGraphPathHistory(raw: string | null): GraphPathHistoryEntry[] {
  if (raw === null || raw.trim() === '') return [];
  let envelope: unknown;
  try { envelope = JSON.parse(raw); } catch { return []; }
  if (!isRecord(envelope) || envelope.version !== GRAPH_PATH_HISTORY_VERSION || !Array.isArray(envelope.entries)) return [];
  const seen = new Set<string>();
  const entries: GraphPathHistoryEntry[] = [];
  for (const value of envelope.entries) {
    if (!isRecord(value)
      || typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128
      || typeof value.fromId !== 'string' || value.fromId.length === 0 || value.fromId.length > 128
      || typeof value.toId !== 'string' || value.toId.length === 0 || value.toId.length > 128
      || (value.mode !== 'directed' && value.mode !== 'undirected')
      || typeof value.length !== 'number' || !Number.isInteger(value.length) || value.length < 0 || value.length > 100
      || typeof value.visitedAt !== 'string' || Number.isNaN(Date.parse(value.visitedAt))) continue;
    const key = `${value.fromId}\0${value.toId}\0${value.mode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ id: value.id, fromId: value.fromId, toId: value.toId, mode: value.mode, length: value.length, visitedAt: value.visitedAt });
  }
  return entries.sort((left, right) => right.visitedAt.localeCompare(left.visitedAt) || left.id.localeCompare(right.id)).slice(0, GRAPH_PATH_HISTORY_LIMIT);
}

export function pruneGraphPathHistory(entries: readonly GraphPathHistoryEntry[], noteIds: ReadonlySet<string>): GraphPathHistoryEntry[] {
  return entries.filter((entry) => noteIds.has(entry.fromId) && noteIds.has(entry.toId));
}

export function loadGraphPathHistory(storage: StorageLike, vaultKey: string): GraphPathHistoryEntry[] {
  try { return parseGraphPathHistory(storage.getItem(graphPathHistoryStorageKey(vaultKey))); }
  catch { return []; }
}

export function writeGraphPathHistory(storage: StorageLike, vaultKey: string, entries: readonly GraphPathHistoryEntry[]): void {
  storage.setItem(graphPathHistoryStorageKey(vaultKey), JSON.stringify({ version: GRAPH_PATH_HISTORY_VERSION, entries: entries.slice(0, GRAPH_PATH_HISTORY_LIMIT) }));
}

export function recordGraphPathHistory(
  entries: readonly GraphPathHistoryEntry[],
  input: { fromId: string; toId: string; mode: GraphTraversalMode; length: number },
  now = new Date().toISOString(),
): GraphPathHistoryEntry[] {
  const key = `${input.fromId}\0${input.toId}\0${input.mode}`;
  const remaining = entries.filter((entry) => `${entry.fromId}\0${entry.toId}\0${entry.mode}` !== key);
  return [{ id: crypto.randomUUID(), ...input, visitedAt: now }, ...remaining].slice(0, GRAPH_PATH_HISTORY_LIMIT);
}

export function clearGraphPathHistory(): GraphPathHistoryEntry[] {
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
