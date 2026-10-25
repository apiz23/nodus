import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, isAbsolute, resolve } from 'node:path';
import type { DatabaseDefinition } from '../database/schema.js';
import { createNote, type Note } from '../domain/note.js';
import { parseNote } from '../format/note-format.js';
import { FileSystemVault } from '../storage/fs/vault.js';
import { assertInsideRoot, assertNotSymlink, resolveInsideRoot } from '../storage/fs/safe-path.js';
import { isStorageError } from '../storage/errors.js';
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
 * token. Vault switching accepts only absolute, existing directories.
 */
export function createLocalApiMiddleware(
  options: LocalApiOptions,
): (req: IncomingMessage, res: ServerResponse, next: NextFunction) => void {
  let activeVaultPath = resolve(options.vaultPath);
  const clock = options.now ?? NOW;
  const chooseFolder = options.folderPicker ?? pickFolder;
  let vaultPromise: Promise<FileSystemVault> | undefined;

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
      return sendJson(res, 201, await createLocalNote(await getVault(), body, clock));
    }

    const noteMatch = /^\/api\/notes\/([^/]+)$/.exec(path);
    if (noteMatch !== null) {
      const id = decodeURIComponent(noteMatch[1] ?? '');
      if (method === 'GET') {
        return sendJson(res, 200, await readLocalNote(await getVault(), id));
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        return sendJson(res, 200, await saveLocalNote(await getVault(), id, body, clock));
      }
      if (method === 'DELETE') {
        const body = await readJson(req);
        return sendJson(res, 200, await deleteLocalNote(await getVault(), id, body));
      }
    }

    const moveMatch = /^\/api\/notes\/([^/]+)\/move$/.exec(path);
    if (method === 'POST' && moveMatch !== null) {
      const id = decodeURIComponent(moveMatch[1] ?? '');
      const body = await readJson(req);
      return sendJson(res, 200, await moveLocalNote(await getVault(), id, body));
    }

    if (method === 'GET' && path === '/api/search') {
      return sendJson(res, 200, {
        results: await searchNotes(await getVault(), url.searchParams.get('q') ?? ''),
      });
    }

    if (method === 'GET' && path === '/api/databases') {
      return sendJson(res, 200, { databases: await listDatabases(await getVault()) });
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
      detail: 'Phase 4 sync client is not implemented. This workspace is local only.',
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
  const note = await vault.readNote(id);
  const raw = await readRawNote(vault, note);
  return { note: toUiNote(note, raw.hash) };
}

async function createLocalNote(
  vault: FileSystemVault,
  body: Record<string, unknown>,
  clock: () => string,
): Promise<{ note: UiNote }> {
  const title = normalizeTitle(body.title);
  const now = clock();
  const id = randomUUID();
  const path = await uniqueNotePath(vault, slugify(title));

  const note = createNote({ id, title, path, body: '', now });
  await vault.createNote(note);

  const stored = await vault.readNote(id);
  const raw = await readRawNote(vault, stored);
  return { note: toUiNote(stored, raw.hash) };
}

async function saveLocalNote(
  vault: FileSystemVault,
  id: string,
  body: Record<string, unknown>,
  clock: () => string,
): Promise<{ note: UiNote }> {
  const title = normalizeTitle(body.title, false);
  const content = requireString(body.body, 'body');
  if (content.length > MAX_BODY_CHARS) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', `Note body exceeds ${MAX_BODY_CHARS} characters`);
  }
  const baseHash = requireHash(body.baseHash);

  const current = await vault.readNote(id);
  const raw = await readRawNote(vault, current);
  if (raw.hash !== baseHash) {
    throw new ApiError(
      409,
      'STALE_WRITE',
      'This note changed on disk after you opened it. Reload it before saving.',
      { currentHash: raw.hash },
    );
  }

  let extraFrontmatter = current.extraFrontmatter;
  if ('icon' in body) {
    const normalized = normalizePageIcon(body.icon);
    if (!normalized.ok) {
      throw new ApiError(400, 'INVALID_INPUT', normalized.message);
    }
    extraFrontmatter = applyPageIcon(current.extraFrontmatter, normalized.value);
  }

  const updated: Note = {
    ...current,
    title,
    body: content,
    updatedAt: clock(),
    extraFrontmatter,
  };
  await vault.replaceNote(updated);

  const stored = await vault.readNote(id);
  const nextRaw = await readRawNote(vault, stored);
  return { note: toUiNote(stored, nextRaw.hash) };
}

async function moveLocalNote(
  vault: FileSystemVault,
  id: string,
  body: Record<string, unknown>,
): Promise<{ note: UiNote }> {
  const path = requireString(body.path, 'path');
  const baseHash = requireHash(body.baseHash);
  const current = await vault.readNote(id);
  const raw = await readRawNote(vault, current);
  if (raw.hash !== baseHash) {
    throw new ApiError(
      409,
      'STALE_WRITE',
      'This note changed on disk after you opened it. Reload it before renaming.',
      { currentHash: raw.hash },
    );
  }

  const moved = await vault.moveNote(id, path);
  const nextRaw = await readRawNote(vault, moved);
  return { note: toUiNote(moved, nextRaw.hash) };
}

async function deleteLocalNote(
  vault: FileSystemVault,
  id: string,
  body: Record<string, unknown>,
): Promise<{ deleted: true }> {
  const baseHash = requireHash(body.baseHash);
  const current = await vault.readNote(id);
  const raw = await readRawNote(vault, current);
  if (raw.hash !== baseHash) {
    throw new ApiError(
      409,
      'STALE_WRITE',
      'This note changed on disk after you opened it. Reload it before deleting.',
      { currentHash: raw.hash },
    );
  }
  await vault.deleteNote(id);
  return { deleted: true };
}

async function searchNotes(vault: FileSystemVault, rawQuery: string): Promise<UiSearchResult[]> {
  const query = normalizeSearch(rawQuery);
  if (query === '') return [];

  const entries = await vault.snapshot();
  const results: UiSearchResult[] = [];

  for (const entry of entries) {
    if (entry.kind !== 'note') continue;
    const note = parseNote(entry.text, entry.path);
    const title = normalizeSearch(note.title);
    const body = normalizeSearch(note.body);
    if (!title.includes(query) && !body.includes(query)) continue;

    results.push({
      id: note.id,
      title: note.title,
      path: note.path,
      updatedAt: note.updatedAt,
      aliases: [...note.aliases],
      icon: readPageIcon(note.extraFrontmatter),
      snippet: makeSnippet(note.title, note.body, rawQuery),
    });
  }

  return results
    .sort((left, right) => {
      const leftTitle = normalizeSearch(left.title).includes(query) ? 0 : 1;
      const rightTitle = normalizeSearch(right.title).includes(query) ? 0 : 1;
      if (leftTitle !== rightTitle) return leftTitle - rightTitle;
      return left.title.localeCompare(right.title);
    })
    .slice(0, 50);
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

async function readRawNote(
  vault: FileSystemVault,
  note: Note,
): Promise<{ text: string; hash: string }> {
  const absolute = resolveInsideRoot(vault.root, note.path);
  await assertInsideRoot(vault.root, absolute, note.path);
  await assertNotSymlink(absolute, note.path);
  const text = await readFile(absolute, 'utf8');
  return { text, hash: sha256(text) };
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

function makeSnippet(title: string, body: string, query: string): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  const index = normalizeSearch(compact).indexOf(normalizeSearch(query));
  if (index === -1) return compact.slice(0, 140) || title;
  const start = Math.max(0, index - 45);
  const end = Math.min(compact.length, index + query.length + 90);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

function foldPath(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function checkOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  if (
    !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin)
  ) {
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

  const text = Buffer.concat(chunks).toString('utf8');
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
    const body: UiApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
      },
    };
    sendJson(res, storageStatus(error.code), body);
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

function storageStatus(code: string): number {
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
      return 422;
    default:
      return 500;
  }
}
