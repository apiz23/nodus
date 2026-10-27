import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, delimiter, dirname, isAbsolute, resolve, sep } from 'node:path';
import type { DatabaseDefinition } from '../database/schema.js';
import { createNote, type Note } from '../domain/note.js';
import { isUuidV4 } from '../domain/ids.js';
import { parseNote } from '../format/note-format.js';
import { FileSystemVault } from '../storage/fs/vault.js';
import { isStorageError } from '../storage/errors.js';
import { isInsideRoot } from '../storage/fs/safe-path.js';
import {
  createBackup,
  previewRestore,
  restoreBackup,
  validateBackup,
  type BackupManifest,
  type BackupReport,
  type ImportReport,
  type RestorePreview,
} from '../storage/index.js';
import { createBacklinkIndex, type BacklinkIndex } from '../links/backlinks.js';
import type {
  UiApiErrorBody,
  UiDatabase,
  UiDeleteNoteInput,
  UiHealthIssue,
  UiMoveNoteInput,
  UiNote,
  UiNoteSummary,
  UiSaveNoteInput,
  UiSearchResult,
  UiVaultPickResult,
  UiVaultStatus,
  UiBacklinksResponse,
} from './dto.js';
import { pickFolder } from './folder-picker.js';
import { applyPageIcon, normalizePageIcon, readPageIcon } from './page-icon.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_BODY_CHARS = 1_000_000;
const MAX_TITLE_CHARS = 200;
const NOW = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface LocalApiOptions {
  /** Initial vault before the user selects another folder. */
  vaultPath: string;
  /** Injectable clock for tests. */
  now?: () => string;
  /** Injectable native folder picker for tests. */
  folderPicker?: () => Promise<string | null>;
}

export type NextFunction = (error?: unknown) => void;

class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Creates a localhost API middleware. It has no relay routes or relay admin
 * token. Vault switching accepts only absolute, existing directories inside
 * the `NODUS_VAULT_ROOTS` allow-list.
 */
export function createLocalApiMiddleware(
  options: LocalApiOptions,
): (req: IncomingMessage, res: ServerResponse, next: NextFunction) => void {
  let activeVaultPath = resolve(options.vaultPath);
  const clock = options.now ?? NOW;
  const chooseFolder = options.folderPicker ?? pickFolder;
  let vaultPromise: Promise<FileSystemVault> | undefined;
  const backlinkIndex = createBacklinkIndex();

  const getVault = (): Promise<FileSystemVault> => {
    if (vaultPromise === undefined) {
      vaultPromise = FileSystemVault.open(activeVaultPath).catch((error: unknown) => {
        vaultPromise = undefined;
        throw error;
      });
    }
    return vaultPromise;
  };

  const switchVault = async (selected: string): Promise<UiVaultStatus> => {
    const selectedPath = resolve(selected);
    let info;
    try {
      info = await stat(selectedPath);
    } catch {
      throw new ApiError(400, 'INVALID_VAULT', 'The selected folder does not exist.');
    }
    if (!info.isDirectory()) {
      throw new ApiError(400, 'INVALID_VAULT', 'The selected path is not a folder.');
    }

    const nextVault = await FileSystemVault.open(selectedPath);
    activeVaultPath = nextVault.root;
    vaultPromise = Promise.resolve(nextVault);
    backlinkIndex.markDirty();
    return buildStatus(nextVault);
  };

  const chooseVault = async (): Promise<UiVaultPickResult> => {
    const selected = await chooseFolder();
    if (selected === null) return { canceled: true };
    return { canceled: false, status: await switchVault(selected) };
  };

  const openVault = async (selected: string): Promise<UiVaultStatus> => {
    if (!isAbsolute(selected)) {
      throw new ApiError(400, 'INVALID_VAULT', 'Vault path must be absolute.');
    }
    await assertVaultAllowed(selected, activeVaultPath);
    return switchVault(selected);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!/^\/api(?:\/|$)/.test(url.pathname)) {
      throw new ApiError(404, 'NOT_FOUND', 'Unknown API route');
    }

    checkOrigin(req);

    const method = req.method ?? 'GET';
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (method === 'GET' && path === '/api/status') {
      return sendJson(res, 200, await buildStatus(await getVault()));
    }

    if (method === 'POST' && path === '/api/vault/pick') {
      return sendJson(res, 200, await chooseVault());
    }

    if (method === 'POST' && path === '/api/vault/open') {
      const body = await readJson(req);
      return sendJson(res, 200, await openVault(requireString(body.path, 'path')));
    }

    if (method === 'GET' && path === '/api/notes') {
      return sendJson(res, 200, { notes: await listNoteSummaries(await getVault()) });
    }

    if (method === 'POST' && path === '/api/notes') {
      const body = await readJson(req);
      return sendJson(res, 201, await createLocalNote(await getVault(), body, clock, backlinkIndex));
    }

    const noteMatch = /^\/api\/notes\/([^/]+)$/.exec(path);
    if (noteMatch !== null) {
      const id = decodeURIComponent(noteMatch[1] ?? '');
      if (method === 'GET') {
        return sendJson(res, 200, await readLocalNote(await getVault(), id));
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        return sendJson(res, 200, await saveLocalNote(await getVault(), id, body, clock, backlinkIndex));
      }
      if (method === 'DELETE') {
        const body = await readJson(req);
        return sendJson(res, 200, await deleteLocalNote(await getVault(), id, body, backlinkIndex));
      }
    }

    const moveMatch = /^\/api\/notes\/([^/]+)\/move$/.exec(path);
    if (method === 'POST' && moveMatch !== null) {
      const id = decodeURIComponent(moveMatch[1] ?? '');
      const body = await readJson(req);
      return sendJson(res, 200, await moveLocalNote(await getVault(), id, body, backlinkIndex));
    }

    const backlinksMatch = /^\/api\/notes\/([^/]+)\/backlinks$/.exec(path);
    if (method === 'GET' && backlinksMatch !== null) {
      const id = decodeURIComponent(backlinksMatch[1] ?? '');
      return sendJson(res, 200, await backlinksForNote(await getVault(), id, backlinkIndex));
    }

    if (method === 'GET' && path === '/api/search') {
      return sendJson(res, 200, {
        results: await searchNotes(await getVault(), url.searchParams.get('q') ?? ''),
      });
    }

    if (method === 'GET' && path === '/api/databases') {
      return sendJson(res, 200, { databases: await listDatabases(await getVault()) });
    }

    if (method === 'POST' && path === '/api/backup') {
      const body = await readJson(req);
      return sendJson(res, 201, await createVaultBackup(await getVault(), body));
    }

    if (method === 'POST' && path === '/api/backup/validate') {
      const body = await readJson(req);
      return sendJson(res, 200, await validateVaultBackup(await getVault(), body));
    }

    if (method === 'POST' && path === '/api/restore/preview') {
      const body = await readJson(req);
      return sendJson(res, 200, await previewVaultRestore(await getVault(), body));
    }

    if (method === 'POST' && path === '/api/restore') {
      const body = await readJson(req);
      return sendJson(res, 200, await restoreVaultBackup(await getVault(), body));
    }

    throw new ApiError(404, 'NOT_FOUND', `Unknown route ${method} ${path}`);
  };

  return (req, res, next) => {
    const url = req.url ?? '/';
    if (!/^\/api(?:\/|$)/.test(url)) {
      next();
      return;
    }

    handle(req, res).catch((error: unknown) => {
      sendError(res, error);
    });
  };
}

async function buildStatus(vault: FileSystemVault): Promise<UiVaultStatus> {
  const health = await vault.checkHealth();
  return {
    vault: {
      name: basename(vault.root),
      path: vault.root,
    },
    counts: {
      notes: health.notes.length,
      databases: health.databases.length,
      issues: health.issues.length,
    },
    health: {
      issues: health.issues.map(
        (issue): UiHealthIssue => ({
          code: issue.code,
          path: issue.path,
          message: issue.message,
        }),
      ),
    },
    sync: {
      status: 'not-connected',
      label: 'Not connected',
      detail:
        'Not connected to a relay. An experimental Phase 4 sync client exists but is not wired into the UI; this workspace is local only.',
    },
  };
}

async function listNoteSummaries(vault: FileSystemVault): Promise<UiNoteSummary[]> {
  const notes = await vault.listNoteDetails();
  return notes
    .map((note) => ({
      id: note.id,
      title: note.title,
      path: note.path,
      updatedAt: note.updatedAt,
      aliases: [...note.aliases],
      icon: readPageIcon(note.extraFrontmatter),
    }))
    .sort((left, right) => {
      const byTime = right.updatedAt.localeCompare(left.updatedAt);
      return byTime === 0 ? left.title.localeCompare(right.title) : byTime;
    });
}

async function readLocalNote(vault: FileSystemVault, id: string): Promise<{ note: UiNote }> {
  const { note, hash } = await vault.readNoteWithHash(id);
  return { note: toUiNote(note, hash) };
}

async function createLocalNote(
  vault: FileSystemVault,
  body: Record<string, unknown>,
  clock: () => string,
  backlinkIndex: BacklinkIndex,
): Promise<{ note: UiNote }> {
  const title = normalizeTitle(body.title);
  const now = clock();
  const id = randomUUID();
  const path = await uniqueNotePath(vault, slugify(title));

  const note = createNote({ id, title, path, body: '', now });
  await vault.createNote(note);
  backlinkIndex.markDirty();

  const stored = await vault.readNoteWithHash(id);
  return { note: toUiNote(stored.note, stored.hash) };
}

async function saveLocalNote(
  vault: FileSystemVault,
  id: string,
  body: Record<string, unknown>,
  clock: () => string,
  backlinkIndex: BacklinkIndex,
): Promise<{ note: UiNote }> {
  const title = normalizeTitle(body.title, false);
  const content = requireString(body.body, 'body');
  if (content.length > MAX_BODY_CHARS) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', `Note body exceeds ${MAX_BODY_CHARS} characters`);
  }
  const baseHash = requireHash(body.baseHash);

  const current = await vault.readNoteWithHash(id);
  let extraFrontmatter = current.note.extraFrontmatter;
  if ('icon' in body) {
    const normalized = normalizePageIcon(body.icon);
    if (!normalized.ok) {
      throw new ApiError(400, 'INVALID_INPUT', normalized.message);
    }
    extraFrontmatter = applyPageIcon(current.note.extraFrontmatter, normalized.value);
  }

  const updated: Note = {
    ...current.note,
    title,
    body: content,
    updatedAt: clock(),
    extraFrontmatter,
  };
  try {
    await vault.replaceNote(updated, { expectedHash: baseHash });
  } catch (error) {
    throw toStaleApiError(error, 'saving');
  }
  backlinkIndex.markDirty();

  const stored = await vault.readNoteWithHash(id);
  return { note: toUiNote(stored.note, stored.hash) };
}

async function moveLocalNote(
  vault: FileSystemVault,
  id: string,
  body: Record<string, unknown>,
  backlinkIndex: BacklinkIndex,
): Promise<{ note: UiNote }> {
  const path = requireString(body.path, 'path');
  const baseHash = requireHash(body.baseHash);

  let moved: Note;
  try {
    moved = await vault.moveNote(id, path, { expectedHash: baseHash });
  } catch (error) {
    throw toStaleApiError(error, 'renaming');
  }
  backlinkIndex.markDirty();
  const nextRaw = await vault.readNoteWithHash(moved.id);
  return { note: toUiNote(nextRaw.note, nextRaw.hash) };
}

async function deleteLocalNote(
  vault: FileSystemVault,
  id: string,
  body: Record<string, unknown>,
  backlinkIndex: BacklinkIndex,
): Promise<{ deleted: true }> {
  const baseHash = requireHash(body.baseHash);
  try {
    await vault.deleteNote(id, { expectedHash: baseHash });
  } catch (error) {
    throw toStaleApiError(error, 'deleting');
  }
  backlinkIndex.markDirty();
  return { deleted: true };
}

/**
 * Maps the core `STALE_WRITE` failure onto the unchanged HTTP 409 shape the
 * UI already understands, including `currentHash`.
 */
function toStaleApiError(error: unknown, verb: string): unknown {
  if (isStorageError(error) && error.code === 'STALE_WRITE') {
    return new ApiError(
      409,
      'STALE_WRITE',
      `This note changed on disk after you opened it. Reload it before ${verb}.`,
      { currentHash: error.details?.currentHash },
    );
  }
  return error;
}

async function backlinksForNote(
  vault: FileSystemVault,
  rawId: string,
  backlinkIndex: BacklinkIndex,
): Promise<UiBacklinksResponse> {
  if (!isUuidV4(rawId)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Note ID must be a lowercase UUID v4');
  }
  // Validates the target exists (404 otherwise).
  await vault.readNote(rawId);

  const notes = await vault.listNoteDetails();
  const backlinks = backlinkIndex.getBacklinks(rawId, notes);
  return { backlinks };
}

async function searchNotes(vault: FileSystemVault, rawQuery: string): Promise<UiSearchResult[]> {
  const query = normalizeSearch(rawQuery);
  if (query === '') return [];

  const notes = await vault.listNoteDetails();
  const results: UiSearchResult[] = [];

  for (const note of notes) {
    const title = normalizeSearch(note.title);
    const path = normalizeSearch(note.path);
    const body = normalizeSearch(note.body);
    if (!title.includes(query) && !path.includes(query) && !body.includes(query)) continue;

    results.push({
      id: note.id,
      title: note.title,
      path: note.path,
      updatedAt: note.updatedAt,
      aliases: [...note.aliases],
      icon: readPageIcon(note.extraFrontmatter),
      snippet: makeSnippet(note.title, note.path, note.body, rawQuery),
    });
  }

  return results
    .sort((left, right) => {
      const leftRank = searchResultRank(left, query);
      const rightRank = searchResultRank(right, query);
      if (leftRank !== rightRank) return leftRank - rightRank;
      const titleOrder = left.title.localeCompare(right.title);
      return titleOrder !== 0 ? titleOrder : left.path.localeCompare(right.path);
    })
    .slice(0, 50);
}

/**
 * Deterministic ranking tiers: exact title, title prefix, title contains,
 * path contains, then body-only. Lower sorts first.
 */
function searchRank(title: string, query: string): number {
  const normalized = normalizeSearch(title);
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 1;
  if (normalized.includes(query)) return 2;
  return 3;
}

function searchResultRank(result: UiSearchResult, query: string): number {
  const titleRank = searchRank(result.title, query);
  if (titleRank < 3) return titleRank;
  return normalizeSearch(result.path).includes(query) ? 3 : 4;
}

async function listDatabases(vault: FileSystemVault): Promise<UiDatabase[]> {
  const summaries = await vault.listDatabases();
  const databases = await Promise.all(summaries.map((summary) => vault.readDatabase(summary.id)));
  return databases
    .map(toUiDatabase)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function toUiDatabase(database: DatabaseDefinition): UiDatabase {
  return {
    id: database.id,
    name: database.name,
    path: `databases/${database.id}.json`,
    properties: database.properties.map((property) => ({
      id: property.id,
      name: property.name,
      type: property.type,
      ...(property.options === undefined
        ? {}
        : { options: property.options.map((option) => ({ id: option.id, name: option.name })) }),
    })),
  };
}

function toUiNote(note: Note, contentHash: string): UiNote {
  return {
    id: note.id,
    title: note.title,
    path: note.path,
    body: note.body,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    tags: [...note.tags],
    aliases: [...note.aliases],
    metadataKeys: Object.keys(note.extraFrontmatter).sort(),
    icon: readPageIcon(note.extraFrontmatter),
    contentHash,
  };
}

/**
 * Resolves a backup source directory: allow-list and vault-exclusion checks
 * first (`assertBackupTargetAllowed`, no duplicated path logic), then
 * existence, so a missing directory is a 404 rather than a corruption error.
 */
async function requireBackupSource(dir: string, vault: FileSystemVault): Promise<string> {
  const source = await assertBackupTargetAllowed(dir, vault.root);
  try {
    await stat(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ApiError(404, 'NOT_FOUND', 'Backup directory was not found.');
    }
    throw error;
  }
  return source;
}

async function createVaultBackup(
  vault: FileSystemVault,
  body: Record<string, unknown>,
): Promise<BackupReport> {
  const target = await assertBackupTargetAllowed(
    requireString(body.targetDir, 'targetDir'),
    vault.root,
  );
  return createBackup(vault, target);
}

async function validateVaultBackup(
  vault: FileSystemVault,
  body: Record<string, unknown>,
): Promise<{ manifest: BackupManifest; counts: { notes: number; databases: number } }> {
  const source = await requireBackupSource(requireString(body.dir, 'dir'), vault);
  const validation = await validateBackup(source);
  return {
    manifest: validation.manifest,
    counts: { notes: validation.notes.length, databases: validation.databases.length },
  };
}

async function previewVaultRestore(
  vault: FileSystemVault,
  body: Record<string, unknown>,
): Promise<RestorePreview> {
  const source = await requireBackupSource(requireString(body.dir, 'dir'), vault);
  return previewRestore(source, vault);
}

async function restoreVaultBackup(
  vault: FileSystemVault,
  body: Record<string, unknown>,
): Promise<ImportReport> {
  if ('destination' in body) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      'destination is not accepted; restores target the active vault',
    );
  }
  const overwrite = body.overwrite;
  if (overwrite !== undefined && typeof overwrite !== 'boolean') {
    throw new ApiError(400, 'INVALID_INPUT', 'overwrite must be a boolean');
  }
  const source = await requireBackupSource(requireString(body.dir, 'dir'), vault);
  return restoreBackup(source, vault.root, { overwrite: overwrite === true });
}

async function uniqueNotePath(vault: FileSystemVault, slug: string): Promise<string> {
  const notes = await vault.listNotes();
  const existing = new Set(notes.map((note) => foldPath(note.path)));
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? '' : `-${index}`;
    const path = `notes/${slug}${suffix}.md`;
    if (!existing.has(foldPath(path))) return path;
  }
  throw new ApiError(409, 'CONFLICT', 'Could not find a free note path');
}

function normalizeTitle(value: unknown, allowDefault = true): string {
  if (value === undefined && allowDefault) return 'Untitled note';
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_INPUT', 'title must be a string');
  }
  const title = value.trim();
  if (title === '') {
    if (allowDefault) return 'Untitled note';
    throw new ApiError(400, 'INVALID_INPUT', 'title must not be empty');
  }
  if (title.length > MAX_TITLE_CHARS) {
    throw new ApiError(400, 'INVALID_INPUT', `title exceeds ${MAX_TITLE_CHARS} characters`);
  }
  return title;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_INPUT', `${field} must be a string`);
  }
  return value;
}

function requireHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new ApiError(400, 'INVALID_INPUT', 'baseHash must be a lowercase SHA-256 hex digest');
  }
  return value;
}

function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'note';
}

function normalizeSearch(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

function makeSnippet(title: string, path: string, body: string, query: string): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  const index = normalizeSearch(compact).indexOf(normalizeSearch(query));
  if (index === -1) {
    if (normalizeSearch(title).includes(normalizeSearch(query))) return `Title: ${title}`;
    if (normalizeSearch(path).includes(normalizeSearch(query))) return `Path: ${path}`;
    return compact.slice(0, 140) || title;
  }
  const start = Math.max(0, index - 45);
  const end = Math.min(compact.length, index + query.length + 90);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

function foldPath(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

/**
 * Allowed roots for POST /api/vault/open, from `NODUS_VAULT_ROOTS`
 * (path-delimiter separated). When unset, the only root is the parent
 * directory of the current vault; the user's home directory is NOT allowed
 * unless listed. Roots are resolved with realpath, so symlinks inside the
 * environment are followed, and symlink escapes are rejected by containment.
 */
async function allowedVaultRoots(currentVaultPath: string): Promise<string[]> {
  const raw = process.env.NODUS_VAULT_ROOTS;
  const entries =
    raw === undefined || raw.trim() === ''
      ? [dirname(currentVaultPath)]
      : raw
          .split(delimiter)
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '');

  const roots: string[] = [];
  for (const entry of entries) {
    try {
      roots.push(await realpath(resolve(entry)));
    } catch {
      // A root that no longer exists cannot admit anything; skip it.
    }
  }
  return roots;
}

function isWithin(root: string, target: string): boolean {
  const sameCase = process.platform === 'win32';
  const normalizedRoot = sameCase ? root.toLowerCase() : root;
  const normalizedTarget = sameCase ? target.toLowerCase() : target;
  const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(prefix);
}

/**
 * Rejects vault paths outside the allow-list. The target is resolved with
 * realpath first, so a symlink pointing outside the roots cannot pass.
 */
async function assertVaultAllowed(selected: string, currentVaultPath: string): Promise<void> {
  let real: string;
  try {
    real = await realpath(resolve(selected));
  } catch {
    throw new ApiError(400, 'INVALID_VAULT', 'The selected folder does not exist.');
  }

  const roots = await allowedVaultRoots(currentVaultPath);
  if (!roots.some((root) => isWithin(root, real))) {
    throw new ApiError(
      403,
      'VAULT_NOT_ALLOWED',
      `The folder "${selected}" is outside the allowed vault roots. Set NODUS_VAULT_ROOTS (a path-delimiter separated list) to allow more roots.`,
      { allowedRoots: roots },
    );
  }
}

/**
 * Allowed roots for backup and export destinations, from `NODUS_BACKUP_ROOTS`
 * (path-delimiter separated). When unset or empty, the only allowed root is
 * the parent directory of the current vault — the same default as
 * `NODUS_VAULT_ROOTS`. Roots are resolved with realpath; a root that no longer
 * exists cannot admit anything and is skipped.
 */
async function allowedBackupRoots(currentVaultPath: string): Promise<string[]> {
  const raw = process.env.NODUS_BACKUP_ROOTS;
  const entries =
    raw === undefined || raw.trim() === ''
      ? [dirname(resolve(currentVaultPath))]
      : raw
          .split(delimiter)
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '');

  const roots: string[] = [];
  for (const entry of entries) {
    try {
      roots.push(await realpath(resolve(entry)));
    } catch {
      continue;
    }
  }
  return roots;
}

/**
 * Validates a backup or export destination for the active vault, mirroring
 * `assertVaultAllowed`. Rules, in order:
 *
 * 1. The path must be absolute.
 * 2. It must be outside the active vault. Containment uses realpath on the
 *    nearest existing ancestor, so a symlinked parent resolving into the
 *    vault is rejected.
 * 3. It must be inside a `NODUS_BACKUP_ROOTS` root (see
 *    `allowedBackupRoots` for the default), with the same realpath handling,
 *    so a symlinked parent that escapes the roots cannot admit a new
 *    directory outside them.
 * 4. If the destination already exists, it must be a directory.
 *
 * Nonexistent destinations are allowed; backups are created by the storage
 * layer. Returns the resolved destination.
 */
export async function assertBackupTargetAllowed(
  selected: string,
  activeVaultPath: string,
): Promise<string> {
  if (!isAbsolute(selected)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Backup target must be an absolute path.');
  }
  const target = resolve(selected);

  if (await isInsideRoot(activeVaultPath, target)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Backup target must be outside the vault.');
  }

  const roots = await allowedBackupRoots(activeVaultPath);
  let allowed = false;
  for (const root of roots) {
    if (await isInsideRoot(root, target)) {
      allowed = true;
      break;
    }
  }
  if (!allowed) {
    throw new ApiError(
      403,
      'BACKUP_TARGET_NOT_ALLOWED',
      'The backup target is outside the allowed backup roots. Set NODUS_BACKUP_ROOTS (a path-delimiter separated list) to allow more roots.',
      { allowedRoots: roots },
    );
  }

  try {
    const info = await stat(target);
    if (!info.isDirectory()) {
      throw new ApiError(400, 'INVALID_INPUT', 'Backup target exists and is not a directory.');
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOTDIR') {
      throw new ApiError(400, 'INVALID_INPUT', 'Backup target path traverses a file, not a directory.');
    }
    if (code !== 'ENOENT') throw error;
  }

  return target;
}

/** Origins the local UI is served from in dev (5173) and preview (4173). */
const DEFAULT_ALLOWED_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
];

function allowedOrigins(): string[] {
  const override = process.env.NODUS_ALLOWED_ORIGINS;
  if (override === undefined || override.trim() === '') return DEFAULT_ALLOWED_ORIGINS;
  const parsed = override
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS;
}

function checkOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  if (!allowedOrigins().includes(origin)) {
    throw new ApiError(403, 'FORBIDDEN', 'This local API only accepts requests from the local UI');
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = req.headers['content-type'] ?? '';
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request body must be application/json');
  }

  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_BODY_BYTES) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    chunks.push(buffer);
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body is not valid UTF-8 text');
  }
  if (text.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, error: unknown): void {
  if (res.writableEnded) return;

  if (error instanceof ApiError) {
    const body: UiApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(typeof error.details?.currentHash === 'string'
          ? { currentHash: error.details.currentHash }
          : {}),
      },
    };
    sendJson(res, error.status, body);
    return;
  }

  if (isStorageError(error)) {
    sendJson(res, storageStatus(error.code), storageErrorBody(error));
    return;
  }

  console.error('[nodus-ui] Local API failure:', error instanceof Error ? error.message : error);
  sendJson(res, 500, {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The local vault operation failed. Check the terminal for details.',
    },
  } satisfies UiApiErrorBody);
}

/**
 * Builds the storage-error response body. Exported so the exact wire shape —
 * `code` and `message` plus additive detail keys, never anything else — is
 * unit-testable. `PARTIAL_WRITE` carries `details.paths` (files already
 * written); backup/content validation carries `details.issues`.
 */
export function storageErrorBody(error: {
  code: string;
  message: string;
  details?: { paths?: string[]; issues?: string[] };
}): UiApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details?.paths === undefined ? {} : { paths: error.details.paths }),
      ...(error.details?.issues === undefined ? {} : { issues: error.details.issues }),
    },
  };
}

/**
 * HTTP status for a storage error code. `CORRUPT_BACKUP` and
 * `UNSUPPORTED_VERSION` are unprocessable content (422); `PARTIAL_WRITE` is a
 * failed server-side operation (500) whose body names the written paths.
 */
export function storageStatus(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
    case 'DUPLICATE_ID':
      return 409;
    case 'UNSAFE_PATH':
    case 'INVALID_INPUT':
      return 400;
    case 'INVALID_CONTENT':
    case 'UNSUPPORTED_VERSION':
    case 'CORRUPT_BACKUP':
      return 422;
    case 'PARTIAL_WRITE':
      return 500;
    default:
      return 500;
  }
}
