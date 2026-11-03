import type { GraphTraversalMode } from '../../src/links/graph-paths.js';

export const GRAPH_VIEWS_STORAGE_VERSION = 1;

export interface GraphViewport {
  x: number;
  y: number;
  scale: number;
}

export interface SavedGraphViewConfig {
  query: string;
  folder: string | null;
  clusterId: string | null;
  focusId: string | null;
  selectedId: string | null;
  showIsolated: boolean;
  showUnresolved: boolean;
  pathMode: GraphTraversalMode;
  viewport: GraphViewport;
}

export interface SavedGraphView {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  config: SavedGraphViewConfig;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function graphViewsStorageKey(vaultKey: string): string {
  return `nodus.graph-views.v${GRAPH_VIEWS_STORAGE_VERSION}:${vaultKey}`;
}

/** Parse stored graph views, dropping malformed records and unsupported envelopes. */
export function parseSavedGraphViews(raw: string | null): SavedGraphView[] {
  if (raw === null || raw.trim() === '') return [];
  let envelope: unknown;
  try { envelope = JSON.parse(raw); } catch { return []; }
  if (!isRecord(envelope) || envelope.version !== GRAPH_VIEWS_STORAGE_VERSION || !Array.isArray(envelope.views)) return [];
  const seen = new Set<string>();
  const views: SavedGraphView[] = [];
  for (const candidate of envelope.views) {
    const view = parseView(candidate);
    if (view === undefined || seen.has(view.id)) continue;
    seen.add(view.id);
    views.push(view);
  }
  return views.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function serializeSavedGraphViews(views: readonly SavedGraphView[]): string {
  return JSON.stringify({
    version: GRAPH_VIEWS_STORAGE_VERSION,
    views: views.map((view) => ({
      id: view.id,
      name: view.name,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      config: normalizeConfig(view.config),
    })),
  });
}

export function loadSavedGraphViews(storage: StorageLike, vaultKey: string): SavedGraphView[] {
  try { return parseSavedGraphViews(storage.getItem(graphViewsStorageKey(vaultKey))); }
  catch { return []; }
}

export function writeSavedGraphViews(storage: StorageLike, vaultKey: string, views: readonly SavedGraphView[]): void {
  storage.setItem(graphViewsStorageKey(vaultKey), serializeSavedGraphViews(views));
}

export function createSavedGraphView(name: string, config: SavedGraphViewConfig, now = new Date().toISOString()): SavedGraphView {
  return {
    id: crypto.randomUUID(),
    name: normalizeName(name),
    createdAt: now,
    updatedAt: now,
    config: normalizeConfig(config),
  };
}

export function updateSavedGraphView(view: SavedGraphView, input: { name?: string; config?: SavedGraphViewConfig }, now = new Date().toISOString()): SavedGraphView {
  return {
    ...view,
    ...(input.name === undefined ? {} : { name: normalizeName(input.name) }),
    ...(input.config === undefined ? {} : { config: normalizeConfig(input.config) }),
    updatedAt: now,
  };
}

function parseView(value: unknown): SavedGraphView | undefined {
  if (!isRecord(value)
    || typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128
    || typeof value.name !== 'string' || value.name.trim() === '' || value.name.length > 80
    || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))
    || !isRecord(value.config)) return undefined;
  const config = parseConfig(value.config);
  if (config === undefined) return undefined;
  return {
    id: value.id,
    name: value.name.trim(),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    config,
  };
}

function parseConfig(value: Record<string, unknown>): SavedGraphViewConfig | undefined {
  if (typeof value.query !== 'string' || value.query.length > 500
    || !nullableString(value.folder) || !nullableString(value.clusterId)
    || !nullableString(value.focusId) || !nullableString(value.selectedId)
    || typeof value.showIsolated !== 'boolean' || typeof value.showUnresolved !== 'boolean'
    || (value.pathMode !== 'directed' && value.pathMode !== 'undirected')
    || !isRecord(value.viewport)
    || !finite(value.viewport.x) || !finite(value.viewport.y) || !finite(value.viewport.scale)) return undefined;
  return {
    query: value.query,
    folder: value.folder,
    clusterId: value.clusterId,
    focusId: value.focusId,
    selectedId: value.selectedId,
    showIsolated: value.showIsolated,
    showUnresolved: value.showUnresolved,
    pathMode: value.pathMode,
    viewport: {
      x: value.viewport.x,
      y: value.viewport.y,
      scale: Math.max(0.5, Math.min(2.5, value.viewport.scale)),
    },
  };
}

function normalizeConfig(config: SavedGraphViewConfig): SavedGraphViewConfig {
  return {
    query: config.query.slice(0, 500),
    folder: config.folder,
    clusterId: config.clusterId,
    focusId: config.focusId,
    selectedId: config.selectedId,
    showIsolated: config.showIsolated,
    showUnresolved: config.showUnresolved,
    pathMode: config.pathMode,
    viewport: {
      x: Number.isFinite(config.viewport.x) ? config.viewport.x : 0,
      y: Number.isFinite(config.viewport.y) ? config.viewport.y : 0,
      scale: Number.isFinite(config.viewport.scale) ? Math.max(0.5, Math.min(2.5, config.viewport.scale)) : 1,
    },
  };
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (normalized === '') throw new Error('A graph view name is required.');
  if (normalized.length > 80) throw new Error('A graph view name must be 80 characters or fewer.');
  return normalized;
}

function nullableString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 128);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
