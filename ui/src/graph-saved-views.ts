import type { GraphTraversalMode } from '../../src/links/graph-paths.js';

export const GRAPH_VIEWS_STORAGE_VERSION = 1;
export const GRAPH_VIEWS_EXPORT_FORMAT = 'nodus-graph-views';
export const GRAPH_VIEWS_EXPORT_VERSION = 1;
export const DEFAULT_GRAPH_RENDER_LIMIT = 200;

export interface GraphViewport {
  x: number;
  y: number;
  scale: number;
}

export interface GraphPoint {
  x: number;
  y: number;
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
  /** Optional manual node positions from this session. */
  nodePositions: Record<string, GraphPoint>;
  /** Maximum rendered graph nodes for this saved view. */
  renderLimit: number;
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

export interface GraphViewReferenceSets {
  noteIds: ReadonlySet<string>;
  folderPaths: ReadonlySet<string>;
  clusterIds: ReadonlySet<string>;
}

export interface ParsedGraphViewsImport {
  views: SavedGraphView[];
  issues: string[];
}

export type GraphViewImportStrategy = 'replace' | 'skip' | 'rename';

export interface GraphViewMergeResult {
  views: SavedGraphView[];
  added: number;
  replaced: number;
  skipped: number;
  renamed: number;
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

/** Portable JSON uses a named envelope and never includes a vault path. */
export function serializeGraphViewsExport(views: readonly SavedGraphView[], exportedAt = new Date().toISOString()): string {
  return `${JSON.stringify({
    format: GRAPH_VIEWS_EXPORT_FORMAT,
    version: GRAPH_VIEWS_EXPORT_VERSION,
    exportedAt,
    views: views.map((view) => ({
      id: view.id,
      name: view.name,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      config: normalizeConfig(view.config),
    })),
  }, null, 2)}\n`;
}

/** Accept the portable envelope and the legacy local-storage envelope. */
export function parseGraphViewsImport(raw: string): ParsedGraphViewsImport {
  let envelope: unknown;
  try { envelope = JSON.parse(raw); }
  catch { return { views: [], issues: ['The file is not valid JSON.'] }; }
  if (!isRecord(envelope) || !Array.isArray(envelope.views)) {
    return { views: [], issues: ['The file must contain a views array.'] };
  }
  const portable = envelope.format === GRAPH_VIEWS_EXPORT_FORMAT;
  const legacy = envelope.format === undefined && envelope.version === GRAPH_VIEWS_STORAGE_VERSION && envelope.exportedAt === undefined;
  if (!portable && !legacy) return { views: [], issues: ['The file format is not a supported Nodus graph-view export.'] };
  const version = portable ? envelope.version : envelope.version;
  if (version !== GRAPH_VIEWS_EXPORT_VERSION) return { views: [], issues: [`Graph-view export version ${String(version)} is not supported.`] };
  const issues: string[] = [];
  const views: SavedGraphView[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  envelope.views.forEach((value, index) => {
    const view = parseView(value);
    if (view === undefined) { issues.push(`View ${index + 1} is malformed and was ignored.`); return; }
    if (ids.has(view.id)) { issues.push(`View ${index + 1} repeats ID ${view.id} and was ignored.`); return; }
    const foldedName = view.name.toLocaleLowerCase();
    if (names.has(foldedName)) { issues.push(`View ${index + 1} repeats name "${view.name}" and was ignored.`); return; }
    ids.add(view.id);
    names.add(foldedName);
    views.push(view);
  });
  return { views, issues };
}

export function validateGraphViewReferences(view: SavedGraphView, references: GraphViewReferenceSets): string[] {
  const issues: string[] = [];
  if (view.config.folder !== null && !references.folderPaths.has(view.config.folder)) issues.push(`Folder "${view.config.folder}" is not present in this vault.`);
  if (view.config.clusterId !== null && view.config.clusterId !== '__isolated__' && !references.clusterIds.has(view.config.clusterId)) issues.push('The selected cluster is not present in this vault.');
  if (view.config.focusId !== null && !references.noteIds.has(view.config.focusId)) issues.push('The saved focus note is not present in this vault.');
  if (view.config.selectedId !== null && !references.noteIds.has(view.config.selectedId)) issues.push('The saved selected note is not present in this vault.');
  return issues;
}

/** Clear references that do not exist in the destination vault while preserving view settings. */
export function sanitizeGraphViewReferences(view: SavedGraphView, references: GraphViewReferenceSets): SavedGraphView {
  return {
    ...view,
    config: {
      ...view.config,
      folder: view.config.folder !== null && references.folderPaths.has(view.config.folder) ? view.config.folder : null,
      clusterId: view.config.clusterId !== null && (view.config.clusterId === '__isolated__' || references.clusterIds.has(view.config.clusterId)) ? view.config.clusterId : null,
      focusId: view.config.focusId !== null && references.noteIds.has(view.config.focusId) ? view.config.focusId : null,
      selectedId: view.config.selectedId !== null && references.noteIds.has(view.config.selectedId) ? view.config.selectedId : null,
      nodePositions: Object.fromEntries(Object.entries(view.config.nodePositions).filter(([id]) => references.noteIds.has(id))),
    },
  };
}

export function mergeImportedGraphViews(
  existing: readonly SavedGraphView[],
  imported: readonly SavedGraphView[],
  strategy: GraphViewImportStrategy,
  now = new Date().toISOString(),
): GraphViewMergeResult {
  let views = [...existing];
  let added = 0;
  let replaced = 0;
  let skipped = 0;
  let renamed = 0;
  for (const incoming of imported) {
    const idConflict = views.some((view) => view.id === incoming.id);
    const nameConflict = views.some((view) => foldName(view.name) === foldName(incoming.name));
    if (strategy === 'skip' && (idConflict || nameConflict)) { skipped += 1; continue; }
    if (strategy === 'replace' && (idConflict || nameConflict)) {
      views = views.filter((view) => view.id !== incoming.id && foldName(view.name) !== foldName(incoming.name));
      views.push({ ...incoming, updatedAt: now });
      replaced += 1;
      continue;
    }
    if (strategy === 'rename' && (idConflict || nameConflict)) {
      views.push({ ...incoming, id: crypto.randomUUID(), name: uniqueName(incoming.name, views), updatedAt: now });
      renamed += 1;
      continue;
    }
    views.push(incoming);
    added += 1;
  }
  return {
    views: views.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    added, replaced, skipped, renamed,
  };
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
    || (value.renderLimit !== undefined && (!isInteger(value.renderLimit) || value.renderLimit < 50 || value.renderLimit > 1000))
    || (value.nodePositions !== undefined && !validPositions(value.nodePositions))
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
    nodePositions: value.nodePositions === undefined ? {} : normalizePositions(value.nodePositions),
    renderLimit: value.renderLimit === undefined ? DEFAULT_GRAPH_RENDER_LIMIT : value.renderLimit,
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
    nodePositions: normalizePositions(config.nodePositions),
    renderLimit: isInteger(config.renderLimit) ? Math.max(50, Math.min(1000, config.renderLimit)) : DEFAULT_GRAPH_RENDER_LIMIT,
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

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function validPositions(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length > 2000) return false;
  return Object.values(value).every((position) => isRecord(position) && finite(position.x) && finite(position.y));
}

function normalizePositions(value: Record<string, unknown>): Record<string, GraphPoint> {
  return Object.fromEntries(Object.entries(value).slice(0, 2000).flatMap(([id, position]) => {
    if (id.length === 0 || id.length > 128 || !isRecord(position) || !finite(position.x) || !finite(position.y)) return [];
    return [[id, { x: position.x, y: position.y }]];
  }));
}

function foldName(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase();
}

function uniqueName(base: string, views: readonly SavedGraphView[]): string {
  const names = new Set(views.map((view) => foldName(view.name)));
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? ' (imported)' : ` (imported ${index})`;
    const candidate = `${base}${suffix}`.slice(0, 80);
    if (!names.has(foldName(candidate))) return candidate;
  }
  return `${base.slice(0, 64)} (imported ${crypto.randomUUID().slice(0, 8)})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
