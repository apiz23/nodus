export const WORKSPACE_PREFERENCES_KEY = 'nodus-workspace-preferences-v1';
export const LEGACY_THEME_KEY = 'nodus-ui-theme';
export const LEGACY_EDITOR_WIDTH_KEY = 'nodus-editor-width';
export const LEGACY_SIDEBAR_WIDTH_KEY = 'nodus-sidebar-width';

export type WorkspaceTheme = 'light' | 'dark';
export type EditorLayout = 'live' | 'source' | 'preview' | 'split';
export type SidebarSectionId = 'discovery' | 'graph' | 'insights' | 'organization' | 'databases' | 'templates';
export type WorkspacePresetId = 'writing' | 'research' | 'knowledge' | 'database' | 'minimal';

export interface WorkspacePreferences {
  sidebar: {
    collapsed: boolean;
    width: number;
    order: SidebarSectionId[];
    hidden: SidebarSectionId[];
  };
  editor: {
    width: 'comfortable' | 'full';
    mode: 'live' | 'source';
    layout: EditorLayout;
    splitRatio: number;
  };
  panels: {
    backlinks: boolean;
    relationBacklinks: boolean;
    relatedNotes: boolean;
  };
}

export interface WorkspacePresetUndo {
  preset: WorkspacePresetId;
  previous: WorkspacePreferences;
}

export interface WorkspaceLoadResult {
  preferences: WorkspacePreferences;
  theme: WorkspaceTheme;
  undo: WorkspacePresetUndo | null;
  issue?: string;
  migrated: boolean;
}

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SIDEBAR_SECTIONS: readonly SidebarSectionId[] = [
  'discovery', 'graph', 'insights', 'organization', 'databases', 'templates',
];

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  sidebar: { collapsed: false, width: 240, order: [...SIDEBAR_SECTIONS], hidden: [] },
  editor: { width: 'comfortable', mode: 'live', layout: 'live', splitRatio: 0.5 },
  panels: { backlinks: true, relationBacklinks: true, relatedNotes: true },
};

export const WORKSPACE_PRESETS: ReadonlyArray<{
  id: WorkspacePresetId;
  name: string;
  description: string;
  changes: string[];
}> = [
  { id: 'writing', name: 'Writing', description: 'A quieter note-writing layout.', changes: ['Collapse the sidebar to its icon rail', 'Use a comfortable editor width', 'Hide linked-note panels'] },
  { id: 'research', name: 'Research', description: 'Write beside the rendered note and keep related context close.', changes: ['Show the full navigation sidebar', 'Split the Markdown editor and preview', 'Show backlinks and related-note panels'] },
  { id: 'knowledge', name: 'Knowledge management', description: 'Keep link context visible while moving between notes.', changes: ['Show all navigation sections', 'Keep the editor at a comfortable width', 'Show backlinks, relation backlinks, and related notes'] },
  { id: 'database', name: 'Database', description: 'Keep notes and database navigation close, with fewer other sections.', changes: ['Show All Notes and Databases navigation', 'Hide other optional navigation sections', 'Keep note context panels available'] },
  { id: 'minimal', name: 'Minimal', description: 'Reduce navigation and editor distractions.', changes: ['Collapse the sidebar to its icon rail', 'Show full writing width', 'Hide linked-note panels'] },
];

interface StoredWorkspace {
  preferences: WorkspacePreferences;
  undo: WorkspacePresetUndo | null;
}
interface PreferenceStore {
  version: 1;
  global: { theme: WorkspaceTheme };
  workspaces: Record<string, StoredWorkspace>;
  /** Unscoped legacy dimensions are assigned once, to the first opened vault. */
  pendingLegacyWorkspace?: Pick<WorkspacePreferences, 'sidebar' | 'editor'>;
}
type StoreRead =
  | { kind: 'missing' }
  | { kind: 'valid'; store: PreferenceStore; issue?: string }
  | { kind: 'invalid'; issue: string }
  | { kind: 'future'; issue: string };

export function normalizeWorkspacePreferences(value: unknown): { preferences: WorkspacePreferences; issue?: string } {
  const issues: string[] = [];
  const root = record(value) ? value : {};
  const sidebar = record(root.sidebar) ? root.sidebar : {};
  const editor = record(root.editor) ? root.editor : {};
  const panels = record(root.panels) ? root.panels : {};

  const width = typeof sidebar.width === 'number' && Number.isFinite(sidebar.width) && sidebar.width >= 200 && sidebar.width <= 480
    ? Math.round(sidebar.width) : DEFAULT_WORKSPACE_PREFERENCES.sidebar.width;
  if (sidebar.width !== undefined && width === DEFAULT_WORKSPACE_PREFERENCES.sidebar.width && sidebar.width !== width) issues.push('sidebar width');

  const order = validSectionList(sidebar.order);
  if (order === null) issues.push('sidebar order');
  const hidden = Array.isArray(sidebar.hidden)
    ? [...new Set(sidebar.hidden.filter(isSidebarSectionId))]
    : [...DEFAULT_WORKSPACE_PREFERENCES.sidebar.hidden];
  if (sidebar.hidden !== undefined && !Array.isArray(sidebar.hidden)) issues.push('sidebar visibility');

  const editorLayout: EditorLayout = editor.layout === 'source' || editor.layout === 'preview' || editor.layout === 'split' || editor.layout === 'live'
    ? editor.layout : DEFAULT_WORKSPACE_PREFERENCES.editor.layout;
  if (editor.layout !== undefined && editorLayout !== editor.layout) issues.push('editor layout');
  const editorWidth = editor.width === 'full' || editor.width === 'comfortable'
    ? editor.width : DEFAULT_WORKSPACE_PREFERENCES.editor.width;
  if (editor.width !== undefined && editorWidth !== editor.width) issues.push('editor width');
  const editorMode = editor.mode === 'source' || editor.mode === 'live' ? editor.mode : DEFAULT_WORKSPACE_PREFERENCES.editor.mode;
  if (editor.mode !== undefined && editorMode !== editor.mode) issues.push('editor mode');
  const splitRatio = typeof editor.splitRatio === 'number' && Number.isFinite(editor.splitRatio) && editor.splitRatio >= 0.35 && editor.splitRatio <= 0.65
    ? editor.splitRatio : DEFAULT_WORKSPACE_PREFERENCES.editor.splitRatio;
  if (editor.splitRatio !== undefined && splitRatio === DEFAULT_WORKSPACE_PREFERENCES.editor.splitRatio && editor.splitRatio !== splitRatio) issues.push('split ratio');

  for (const key of ['collapsed'] as const) if (sidebar[key] !== undefined && typeof sidebar[key] !== 'boolean') issues.push('sidebar collapsed state');
  for (const key of ['backlinks', 'relationBacklinks', 'relatedNotes'] as const) if (panels[key] !== undefined && typeof panels[key] !== 'boolean') issues.push('panel visibility');

  const normalized: WorkspacePreferences = {
    sidebar: {
      collapsed: typeof sidebar.collapsed === 'boolean' ? sidebar.collapsed : DEFAULT_WORKSPACE_PREFERENCES.sidebar.collapsed,
      width,
      order: order ?? [...DEFAULT_WORKSPACE_PREFERENCES.sidebar.order],
      hidden: hidden.filter((id) => (order ?? DEFAULT_WORKSPACE_PREFERENCES.sidebar.order).includes(id)),
    },
    editor: { width: editorWidth, mode: editorMode, layout: editorLayout, splitRatio },
    panels: {
      backlinks: typeof panels.backlinks === 'boolean' ? panels.backlinks : DEFAULT_WORKSPACE_PREFERENCES.panels.backlinks,
      relationBacklinks: typeof panels.relationBacklinks === 'boolean' ? panels.relationBacklinks : DEFAULT_WORKSPACE_PREFERENCES.panels.relationBacklinks,
      relatedNotes: typeof panels.relatedNotes === 'boolean' ? panels.relatedNotes : DEFAULT_WORKSPACE_PREFERENCES.panels.relatedNotes,
    },
  };
  return { preferences: normalized, ...(issues.length ? { issue: `Some invalid workspace settings were replaced with defaults: ${[...new Set(issues)].join(', ')}.` } : {}) };
}

export function loadWorkspacePreferences(storage: PreferenceStorage | null, vaultIdentity: string): WorkspaceLoadResult {
  if (!storage) return { preferences: cloneDefaults(), theme: 'light', undo: null, issue: 'Browser preference storage is unavailable. Changes apply only for this session.', migrated: false };
  const read = readStore(storage);
  if (read.kind === 'future') return { preferences: cloneDefaults(), theme: readLegacyTheme(storage), undo: null, issue: read.issue, migrated: false };
  if (read.kind === 'invalid') {
    const migrated = legacyWorkspace(storage);
    return { preferences: migrated, theme: readLegacyTheme(storage), undo: null, issue: read.issue, migrated: false };
  }
  if (read.kind === 'missing') {
    const preferences = legacyWorkspace(storage);
    const store: PreferenceStore = { version: 1, global: { theme: readLegacyTheme(storage) }, workspaces: { [vaultIdentity]: { preferences, undo: null } } };
    try {
      storage.setItem(WORKSPACE_PREFERENCES_KEY, JSON.stringify(store));
      return { preferences, theme: store.global.theme, undo: null, migrated: true };
    } catch {
      return { preferences, theme: store.global.theme, undo: null, issue: 'Could not save migrated workspace preferences. Changes are available for this session.', migrated: true };
    }
  }

  const entry = read.store.workspaces[vaultIdentity];
  if (entry !== undefined) {
    const normalized = normalizeWorkspacePreferences(entry.preferences);
    const undo = normalizeUndo(entry.undo);
    return { preferences: normalized.preferences, theme: read.store.global.theme, undo,
      ...(read.issue ?? normalized.issue ? { issue: [read.issue, normalized.issue].filter(Boolean).join(' ') } : {}), migrated: false };
  }

  if (read.store.pendingLegacyWorkspace !== undefined) {
    const normalized = normalizeWorkspacePreferences(read.store.pendingLegacyWorkspace);
    const store = { ...read.store, workspaces: { ...read.store.workspaces, [vaultIdentity]: { preferences: normalized.preferences, undo: null } } };
    delete store.pendingLegacyWorkspace;
    try {
      storage.setItem(WORKSPACE_PREFERENCES_KEY, JSON.stringify(store));
      return { preferences: normalized.preferences, theme: store.global.theme, undo: null, ...(normalized.issue ? { issue: normalized.issue } : {}), migrated: true };
    } catch {
      return { preferences: normalized.preferences, theme: store.global.theme, undo: null, issue: 'Could not finish migrating the old layout settings. Changes are available for this session.', migrated: true };
    }
  }
  return { preferences: cloneDefaults(), theme: read.store.global.theme, undo: null, ...(read.issue ? { issue: read.issue } : {}), migrated: false };
}

export function readWorkspaceTheme(storage: PreferenceStorage | null): WorkspaceTheme {
  if (!storage) return 'light';
  const read = readStore(storage);
  return read.kind === 'valid' ? read.store.global.theme : readLegacyTheme(storage);
}

export function saveGlobalTheme(storage: PreferenceStorage | null, theme: WorkspaceTheme): boolean {
  if (!storage) return false;
  const read = readStore(storage);
  if (read.kind === 'future') return false;
  const store = read.kind === 'valid' ? read.store : createStore(storage);
  try { storage.setItem(WORKSPACE_PREFERENCES_KEY, JSON.stringify({ ...store, global: { theme } })); return true; }
  catch { return false; }
}

export function saveWorkspacePreferences(storage: PreferenceStorage | null, vaultIdentity: string, preferences: WorkspacePreferences, undo: WorkspacePresetUndo | null = null): boolean {
  if (!storage || !vaultIdentity) return false;
  const normalized = normalizeWorkspacePreferences(preferences).preferences;
  const read = readStore(storage);
  if (read.kind === 'future') return false;
  const store = read.kind === 'valid' ? read.store : createStore(storage);
  const next: PreferenceStore = { ...store, workspaces: { ...store.workspaces, [vaultIdentity]: { preferences: normalized, undo } } };
  delete next.pendingLegacyWorkspace;
  try { storage.setItem(WORKSPACE_PREFERENCES_KEY, JSON.stringify(next)); return true; }
  catch { return false; }
}

export function makeWorkspacePreset(current: WorkspacePreferences, preset: WorkspacePresetId): { preferences: WorkspacePreferences; undo: WorkspacePresetUndo } {
  const next = clonePreferences(current);
  switch (preset) {
    case 'writing':
      next.sidebar.collapsed = true;
      next.sidebar.width = 240;
      next.editor.width = 'comfortable';
      next.editor.layout = 'live';
      next.panels = { backlinks: false, relationBacklinks: false, relatedNotes: false };
      break;
    case 'research':
      next.sidebar.collapsed = false;
      next.sidebar.width = 300;
      next.sidebar.hidden = [];
      next.editor.width = 'comfortable';
      next.editor.layout = 'split';
      next.editor.splitRatio = 0.5;
      next.panels = { backlinks: true, relationBacklinks: true, relatedNotes: true };
      break;
    case 'knowledge':
      next.sidebar.collapsed = false;
      next.sidebar.width = 300;
      next.sidebar.hidden = [];
      next.editor.width = 'comfortable';
      next.editor.layout = 'live';
      next.panels = { backlinks: true, relationBacklinks: true, relatedNotes: true };
      break;
    case 'database':
      next.sidebar.collapsed = false;
      next.sidebar.width = 280;
      next.sidebar.hidden = SIDEBAR_SECTIONS.filter((id) => id !== 'databases');
      next.editor.layout = 'live';
      break;
    case 'minimal':
      next.sidebar.collapsed = true;
      next.sidebar.hidden = [...SIDEBAR_SECTIONS];
      next.editor.width = 'full';
      next.editor.layout = 'live';
      next.panels = { backlinks: false, relationBacklinks: false, relatedNotes: false };
      break;
  }
  const preferences = normalizeWorkspacePreferences(next).preferences;
  return { preferences, undo: { preset, previous: clonePreferences(current) } };
}

export function restoreWorkspacePreset(undo: WorkspacePresetUndo): WorkspacePreferences {
  return normalizeWorkspacePreferences(undo.previous).preferences;
}

export function clearWorkspacePreferences(storage: PreferenceStorage | null, vaultIdentity: string): boolean {
  return saveWorkspacePreferences(storage, vaultIdentity, cloneDefaults(), null);
}

function readStore(storage: PreferenceStorage): StoreRead {
  let raw: string | null;
  try { raw = storage.getItem(WORKSPACE_PREFERENCES_KEY); }
  catch { return { kind: 'invalid', issue: 'Browser preference storage could not be read.' }; }
  if (raw === null) return { kind: 'missing' };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return { kind: 'invalid', issue: 'Saved workspace preferences were malformed. Defaults are available.' }; }
  if (!record(parsed)) return { kind: 'invalid', issue: 'Saved workspace preferences were malformed. Defaults are available.' };
  if (parsed.version !== 1) return { kind: 'future', issue: 'These workspace preferences were saved by a newer Nodus version and were left untouched.' };
  if (!record(parsed.global) || !record(parsed.workspaces)) return { kind: 'invalid', issue: 'Saved workspace preferences were incomplete. Defaults are available.' };
  const workspaces: Record<string, StoredWorkspace> = {};
  let issue: string | undefined;
  for (const [identity, candidate] of Object.entries(parsed.workspaces)) {
    if (!record(candidate)) { issue = 'Some invalid workspace records were ignored.'; continue; }
    const normalized = normalizeWorkspacePreferences(candidate.preferences);
    workspaces[identity] = { preferences: normalized.preferences, undo: normalizeUndo(candidate.undo) };
    if (normalized.issue) issue = normalized.issue;
  }
  const theme: WorkspaceTheme = parsed.global.theme === 'dark' || parsed.global.theme === 'light' ? parsed.global.theme : readLegacyTheme(storage);
  let pendingLegacyWorkspace: PreferenceStore['pendingLegacyWorkspace'];
  if (parsed.pendingLegacyWorkspace !== undefined) {
    const normalized = normalizeWorkspacePreferences(parsed.pendingLegacyWorkspace);
    pendingLegacyWorkspace = { sidebar: normalized.preferences.sidebar, editor: normalized.preferences.editor };
    if (normalized.issue) issue = normalized.issue;
  }
  return { kind: 'valid', store: { version: 1, global: { theme }, workspaces, ...(pendingLegacyWorkspace ? { pendingLegacyWorkspace } : {}) }, ...(issue ? { issue } : {}) };
}

function createStore(storage: PreferenceStorage): PreferenceStore {
  const legacy = legacyWorkspace(storage);
  return { version: 1, global: { theme: readLegacyTheme(storage) }, workspaces: {}, pendingLegacyWorkspace: { sidebar: legacy.sidebar, editor: legacy.editor } };
}

function legacyWorkspace(storage: PreferenceStorage): WorkspacePreferences {
  let width = DEFAULT_WORKSPACE_PREFERENCES.sidebar.width;
  let editorWidth: 'comfortable' | 'full' = DEFAULT_WORKSPACE_PREFERENCES.editor.width;
  try {
    const raw = Number(storage.getItem(LEGACY_SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= 200 && raw <= 480) width = Math.round(raw);
    if (storage.getItem(LEGACY_EDITOR_WIDTH_KEY) === 'full') editorWidth = 'full';
  } catch { /* Defaults remain available if old preference keys cannot be read. */ }
  return { ...cloneDefaults(), sidebar: { ...DEFAULT_WORKSPACE_PREFERENCES.sidebar, width }, editor: { ...DEFAULT_WORKSPACE_PREFERENCES.editor, width: editorWidth } };
}

function readLegacyTheme(storage: PreferenceStorage): WorkspaceTheme {
  try { return storage.getItem(LEGACY_THEME_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

function normalizeUndo(value: unknown): WorkspacePresetUndo | null {
  if (!record(value) || !isWorkspacePresetId(value.preset)) return null;
  return { preset: value.preset, previous: normalizeWorkspacePreferences(value.previous).preferences };
}

function validSectionList(value: unknown): SidebarSectionId[] | null {
  if (!Array.isArray(value) || value.some((id) => !isSidebarSectionId(id))) return null;
  return [...new Set(value as SidebarSectionId[]), ...SIDEBAR_SECTIONS.filter((id) => !value.includes(id))];
}
function isSidebarSectionId(value: unknown): value is SidebarSectionId { return typeof value === 'string' && SIDEBAR_SECTIONS.includes(value as SidebarSectionId); }
function isWorkspacePresetId(value: unknown): value is WorkspacePresetId { return value === 'writing' || value === 'research' || value === 'knowledge' || value === 'database' || value === 'minimal'; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function cloneDefaults(): WorkspacePreferences { return clonePreferences(DEFAULT_WORKSPACE_PREFERENCES); }
function clonePreferences(value: WorkspacePreferences): WorkspacePreferences {
  return { sidebar: { ...value.sidebar, order: [...value.sidebar.order], hidden: [...value.sidebar.hidden] }, editor: { ...value.editor }, panels: { ...value.panels } };
}
