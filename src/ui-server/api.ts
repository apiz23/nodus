import { compatibleRelationTarget, projectRelations } from '../database/relations.js';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, delimiter, dirname, isAbsolute, resolve, sep } from 'node:path';
import {
  DATABASE_FORMAT,
  DATABASE_FORMAT_VERSION,
  parseDatabase,
  type DatabaseDefinition,
} from '../database/schema.js';
import { DATABASE_VIEW_FORMAT, DATABASE_VIEW_VERSION, diagnoseDatabaseView, parseDatabaseView, validateViewReferences } from '../database/database-view.js';
import { createNote, type Note } from '../domain/note.js';
import { isUuidV4 } from '../domain/ids.js';
import { parseNote } from '../format/note-format.js';
import { FileSystemVault, sha256Hex } from '../storage/fs/vault.js';
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
import { backlinksByTarget } from '../links/backlinks.js';
import { buildLinkIndex, type LinkIndex } from '../links/link-index.js';
import { graphFromLinkIndex } from '../links/graph.js';
import { createSnapshotCache } from '../indexing/snapshot-cache.js';
import { buildSearchIndex, normalizeSearch, searchIndex } from '../search/search-index.js';
type BacklinkIndex = { markDirty(): void };
import type {
  UiApiErrorBody,
  UiDatabase,
  UiDatabaseRowsResponse,
  UiDatabaseView,
  UiDatabaseViewsResponse,
  UiDeleteNoteInput,
  UiHealthIssue,
  UiMoveNoteInput,
  UiNote,
  UiNoteSummary,
  UiNotePropertiesResponse,
  UiSaveNoteInput,
  UiVaultPickResult,
  UiVaultStatus,
  UiBacklinksResponse,
} from './dto.js';
import { pickFolder } from './folder-picker.js';
import { applyPageIcon, normalizePageIcon, readPageIcon } from './page-icon.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
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
  const buildKnowledgeIndex = (notes: Note[]) => ({ links: buildLinkIndex(notes), search: buildSearchIndex(notes) });
  const indexes = new Map<FileSystemVault, ReturnType<typeof createSnapshotCache<ReturnType<typeof buildKnowledgeIndex>>>>();
  const indexFor = (vault: FileSystemVault) => {
    let index = indexes.get(vault);
    if (!index) { index = createSnapshotCache(() => vault.snapshotNotes(), buildKnowledgeIndex); indexes.set(vault, index); }
    return index;
  };
  const backlinkIndex = { markDirty() { for (const index of indexes.values()) index.markDirty(); } };

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
    indexes.clear();
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

    if (method === 'GET' && path === '/api/assets/image') {
      const imagePath = url.searchParams.get('path');
      if (imagePath === null || imagePath.length > 260) throw new ApiError(400, 'INVALID_INPUT', 'Invalid image path.');
      const image = await (await getVault()).readImage(imagePath);
      res.writeHead(200, {
        'Content-Type': image.contentType,
        'Content-Length': image.bytes.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      res.end(image.bytes);
      return;
    }

    if (method === 'GET' && path === '/api/attachments') {
      return sendJson(res, 200, { attachments: await (await getVault()).listAttachments() });
    }

    if (method === 'GET' && path === '/api/attachments/open') {
      const attachmentPath = url.searchParams.get('path');
      if (attachmentPath === null || attachmentPath.length > 260) throw new ApiError(400, 'INVALID_INPUT', 'Invalid attachment path.');
      const { attachment, bytes } = await (await getVault()).readAttachment(attachmentPath);
      res.writeHead(200, {
        'Content-Type': attachment.contentType,
        'Content-Length': bytes.length,
        'Content-Disposition': `inline; filename="${attachment.name.replace(/["\\\r\n]/g, '_')}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      res.end(bytes);
      return;
    }

    if (method === 'POST' && path === '/api/attachments') {
      const name = url.searchParams.get('name');
      if (name === null) throw new ApiError(400, 'INVALID_INPUT', 'Attachment filename is required.');
      const bytes = await readBinary(req, MAX_ATTACHMENT_BYTES);
      const attachment = await (await getVault()).createAttachment(name, bytes);
      return sendJson(res, 201, { attachment });
    }

    if (method === 'DELETE' && path === '/api/attachments') {
      const body = await readJson(req);
      requireAllowedKeys(body, ['path', 'confirmReferenced'], 'request');
      if (body.confirmReferenced !== undefined && typeof body.confirmReferenced !== 'boolean') throw new ApiError(400, 'INVALID_INPUT', 'confirmReferenced must be a boolean.');
      await (await getVault()).deleteAttachment(requireString(body.path, 'path'), body.confirmReferenced === true);
      return sendJson(res, 200, { deleted: true });
    }

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

    if (method === 'GET' && path === '/api/folders') {
      return sendJson(res, 200, { folders: await (await getVault()).listFolders() });
    }

    if (method === 'GET' && path === '/api/folders/impact') {
      const folderPath = requireString(url.searchParams.get('path'), 'path');
      return sendJson(res, 200, { impact: await (await getVault()).inspectFolder(folderPath) });
    }

    if (method === 'POST' && path === '/api/folders') {
      const body = await readJson(req);
      requireAllowedKeys(body, ['path'], 'request');
      const vault = await getVault();
      await vault.createFolder(requireString(body.path, 'path'));
      backlinkIndex.markDirty();
      return sendJson(res, 201, { path: body.path });
    }

    if (method === 'POST' && path === '/api/folders/move') {
      const body = await readJson(req);
      requireAllowedKeys(body, ['fromPath', 'toPath'], 'request');
      const vault = await getVault();
      await vault.moveFolder(requireString(body.fromPath, 'fromPath'), requireString(body.toPath, 'toPath'));
      backlinkIndex.markDirty();
      return sendJson(res, 200, { path: body.toPath });
    }

    if (method === 'DELETE' && path === '/api/folders') {
      const body = await readJson(req);
      requireAllowedKeys(body, ['path', 'token'], 'request');
      const vault = await getVault();
      const noteIds = await vault.deleteFolder(requireString(body.path, 'path'), requireString(body.token, 'token'));
      backlinkIndex.markDirty();
      return sendJson(res, 200, { deleted: true, noteIds });
    }

    if (method === 'POST' && path === '/api/notes') {
      const body = await readJson(req);
      return sendJson(res, 201, await createLocalNote(await getVault(), body, clock, backlinkIndex));
    }

    if (method === 'GET' && path === '/api/discovery') {
      const { links: index } = await indexFor(await getVault()).get(url.searchParams.get('refresh') === 'true');
      return sendJson(res, 200, {
        unresolved: index.links.filter((link) => link.resolution.status === 'unresolved'),
        ambiguous: index.links.filter((link) => link.resolution.status === 'ambiguous'),
        orphans: index.orphanNotes,
      });
    }
    if (method === 'GET' && path === '/api/graph') {
      const { links } = await indexFor(await getVault()).get(url.searchParams.get('refresh') === 'true');
      return sendJson(res, 200, graphFromLinkIndex(links));
    }
    if (method === 'POST' && path === '/api/discovery/create') {
      const body = await readJson(req);
      const target = requireString(body.target, 'target').trim();
      if (!target || /[\[\]|\r\n]/.test(target)) throw new ApiError(400, 'INVALID_INPUT', 'Invalid wiki-link target.');
      const vault = await getVault();
      const title = normalizeTitle(isUuidV4(target) ? 'Recovered note' : target, false);
      const candidate = createNote({ id: isUuidV4(target) ? target : randomUUID(), title,
        path: await uniqueNotePath(vault, slugify(title)), body: '', now: clock() });
      const note = await vault.createNoteForLink(target, candidate);
      backlinkIndex.markDirty();
      return sendJson(res, 200, await readLocalNote(vault, note.id));
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

    const notePropertiesMatch = /^\/api\/notes\/([^/]+)\/properties$/.exec(path);
    if (notePropertiesMatch !== null) {
      const id = decodeURIComponent(notePropertiesMatch[1] ?? '');
      if (method === 'GET') {
        return sendJson(res, 200, await readLocalNoteProperties(await getVault(), id));
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        const result = await setLocalNoteProperty(await getVault(), id, body, clock);
        backlinkIndex.markDirty();
        return sendJson(res, 200, result);
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
      if (!isUuidV4(id)) throw new ApiError(400, 'INVALID_INPUT', 'Note ID must be a lowercase UUID v4');
      const cache = indexFor(await getVault());
      const refresh = url.searchParams.get('refresh') === 'true';
      let snapshot = await cache.get(refresh);
      // A note opened from disk may have been added externally since this snapshot.
      // Recheck a missing target once before reporting a real 404.
      if (!refresh && !snapshot.links.notes.some((note) => note.id === id)) snapshot = await cache.get(true);
      return sendJson(res, 200, await backlinksForNote(id, snapshot.links));
    }

    if (method === 'GET' && path === '/api/search') {
      return sendJson(res, 200, {
        results: normalizeSearch(url.searchParams.get('q') ?? '') === '' ? [] : searchIndex(
          (await indexFor(await getVault()).get(url.searchParams.get('refresh') === 'true')).search, url.searchParams.get('q') ?? ''),
      });
    }

    if (method === 'GET' && path === '/api/databases') {
      return sendJson(res, 200, { databases: await listDatabases(await getVault()) });
    }

    if (method === 'POST' && path === '/api/databases') {
      const body = await readJson(req);
      return sendJson(res, 201, await createLocalDatabase(await getVault(), body));
    }

    const databaseMatch = /^\/api\/databases\/([^/]+)$/.exec(path);
    if (method === 'PUT' && databaseMatch !== null) {
      const id = decodeURIComponent(databaseMatch[1] ?? '');
      const body = await readJson(req);
      return sendJson(res, 200, await replaceLocalDatabase(await getVault(), id, body));
    }

    const databaseRowsMatch = /^\/api\/databases\/([^/]+)\/rows$/.exec(path);
    if (method === 'POST' && databaseRowsMatch !== null) {
      const body = await readJson(req);
      requireAllowedKeys(body, ['noteId', 'baseHash', 'confirmCreate'], 'request');
      const databaseId = requireUuid(decodeURIComponent(databaseRowsMatch[1] ?? ''), 'databaseId');
      const noteId = requireUuid(body.noteId, 'noteId');
      if (body.confirmCreate !== true) throw new ApiError(409, 'CONFIRMATION_REQUIRED', 'Explicitly confirm adding this note to the database.');
      const vault = await getVault();
      let result;
      try { result = await vault.setNoteProperty(noteId, { databaseId, membershipOnly: true, confirmCreate: true }, { expectedHash: requireHash(body.baseHash), now: clock() }); }
      catch (error) { throw toStaleApiError(error, 'adding database membership'); }
      if (!result.ok) throw new ApiError(422, 'STRUCTURED_DATA_INVALID', 'Membership was not changed.', 'issues' in result ? { structuredDataIssues: result.issues } : undefined);
      backlinkIndex.markDirty();
      return sendJson(res, 200, await readLocalNoteProperties(vault, noteId));
    }
    if (method === 'GET' && databaseRowsMatch !== null) {
      const expectedSchemaHash = url.searchParams.get('schemaHash') ?? undefined;
      return sendJson(
        res,
        200,
        await listDatabaseRows(await getVault(), decodeURIComponent(databaseRowsMatch[1] ?? ''), expectedSchemaHash),
      );
    }

    const databaseViewsMatch = /^\/api\/databases\/([^/]+)\/views$/.exec(path);
    if (databaseViewsMatch !== null) {
      const databaseId = requireUuid(decodeURIComponent(databaseViewsMatch[1] ?? ''), 'database ID');
      if (method === 'GET') return sendJson(res, 200, await listDatabaseViews(await getVault(), databaseId));
      if (method === 'POST') {
        const body = await readJson(req);
        return sendJson(res, 201, await createLocalDatabaseView(await getVault(), databaseId, body));
      }
    }

    const duplicateViewMatch = /^\/api\/databases\/([^/]+)\/views\/([^/]+)\/duplicate$/.exec(path);
    if (method === 'POST' && duplicateViewMatch !== null) {
      const databaseId = requireUuid(decodeURIComponent(duplicateViewMatch[1] ?? ''), 'database ID');
      const viewId = requireUuid(decodeURIComponent(duplicateViewMatch[2] ?? ''), 'view ID');
      const body = await readJson(req);
      requireAllowedKeys(body, ['id', 'name', 'baseHash'], 'request');
      const id = requireUuid(body.id, 'new view ID');
      const vault = await getVault();
      try { await vault.duplicateDatabaseView(databaseId, viewId, id, requireString(body.name, 'name'), { expectedHash: requireHash(body.baseHash) }); }
      catch (error) { throw toViewStaleApiError(error); }
      const saved = (await listDatabaseViews(vault, databaseId)).views.find((item) => item.view.id === id);
      return sendJson(res, 201, { view: saved });
    }

    const databaseViewMatch = /^\/api\/databases\/([^/]+)\/views\/([^/]+)$/.exec(path);
    if (databaseViewMatch !== null) {
      const databaseId = requireUuid(decodeURIComponent(databaseViewMatch[1] ?? ''), 'database ID');
      const viewId = requireUuid(decodeURIComponent(databaseViewMatch[2] ?? ''), 'view ID');
      if (method === 'GET') {
        const view = (await listDatabaseViews(await getVault(), databaseId)).views.find((item) => item.view.id === viewId);
        if (!view) throw new ApiError(404, 'NOT_FOUND', 'Saved view was not found.');
        return sendJson(res, 200, { view });
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        return sendJson(res, 200, await replaceLocalDatabaseView(await getVault(), databaseId, viewId, body));
      }
      if (method === 'DELETE') {
        const body = await readJson(req);
        return sendJson(res, 200, await deleteLocalDatabaseView(await getVault(), databaseId, viewId, body));
      }
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
      try { return sendJson(res, 200, await restoreVaultBackup(await getVault(), body)); }
      finally { backlinkIndex.markDirty(); }
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

async function readLocalNoteProperties(
  vault: FileSystemVault,
  id: string,
): Promise<UiNotePropertiesResponse> {
  const entries = await vault.snapshot();
  const entry = entries.find((entry) => entry.kind === 'note' && entry.id === id);
  if (!entry) throw new ApiError(404, 'NOT_FOUND', 'Note was not found.');
  const schemas = new Map(entries.filter((entry) => entry.kind === 'database').map((entry) => [entry.id, parseDatabase(entry.text)]));
  const notes = entries.filter((entry) => entry.kind === 'note').map((entry) => parseNote(entry.text, entry.path));
  const graph = projectRelations(notes, schemas);
  return { noteId: id, path: entry.path, contentHash: sha256Hex(entry.rawBytes ?? Buffer.from(entry.text, 'utf8')),
    rows: [...(graph.rows.get(id)?.values() ?? [])].map(({ noteId, path, databaseId, values }) => ({ noteId, path, databaseId, values })), issues: graph.diagnostics.filter((issue) => issue.noteId === id) };

}

async function setLocalNoteProperty(
  vault: FileSystemVault,
  id: string,
  body: Record<string, unknown>,
  clock: () => string,
): Promise<UiNotePropertiesResponse> {
  const databaseId = requireUuid(body.databaseId, 'databaseId');
  const propertyId = requireUuid(body.propertyId, 'propertyId');
  const baseHash = requireHash(body.baseHash);
  if (body.remove !== undefined && body.remove !== true) throw new ApiError(400, 'INVALID_INPUT', 'remove must be true when clearing a property');
  if (body.remove === true && Object.hasOwn(body, 'value')) throw new ApiError(400, 'INVALID_INPUT', 'Send either value or remove: true, not both');
  if (body.confirmCreate !== undefined && typeof body.confirmCreate !== 'boolean') {
    throw new ApiError(400, 'INVALID_INPUT', 'confirmCreate must be a boolean');
  }

  let result;
  try { result = await vault.setNoteProperty(id, {
    databaseId, propertyId, value: body.value,
    ...(body.remove === true ? { remove: true } : {}),
    ...(body.confirmCreate === undefined ? {} : { confirmCreate: body.confirmCreate }),
  }, { expectedHash: baseHash, now: clock() }); }
  catch (error) { throw toStaleApiError(error, 'updating structured data'); }
  if (!result.ok) {
    if ('confirmationRequired' in result) {
      throw new ApiError(
        409,
        'CONFIRMATION_REQUIRED',
        'Adding this note to a database creates structured metadata. Retry with confirmCreate: true to confirm.',
      );
    }
    throw new ApiError(
      422,
      'STRUCTURED_DATA_INVALID',
      'Structured data was not changed because the note or requested value has validation issues.',
      { structuredDataIssues: result.issues },
    );
  }

  return readLocalNoteProperties(vault, id);
}

async function listDatabaseRows(
  vault: FileSystemVault,
  databaseId: string,
  expectedSchemaHash?: string,
): Promise<UiDatabaseRowsResponse> {
  if (!isUuidV4(databaseId)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Database ID must be a lowercase UUID v4');
  }

  // One root-locked snapshot gives membership, property values, and hashes from
  // the same vault revision without a client-side request per note.
  const entries = await vault.snapshot();
  const schemaEntry = entries.find((entry) => entry.kind === 'database' && entry.id === databaseId);
  if (schemaEntry === undefined) throw new ApiError(404, 'NOT_FOUND', 'Database was not found.');
  const schemaHash = sha256Hex(schemaEntry.rawBytes ?? Buffer.from(schemaEntry.text, 'utf8'));
  if (expectedSchemaHash !== undefined) {
    if (!/^[0-9a-f]{64}$/.test(expectedSchemaHash)) {
      throw new ApiError(400, 'INVALID_INPUT', 'Schema hash must be a lowercase SHA-256 value.');
    }
    if (expectedSchemaHash !== schemaHash) {
      throw new ApiError(409, 'SCHEMA_CHANGED', 'Database schema changed before rows could be loaded.', { currentHash: schemaHash });
    }
  }

  const schemas = new Map<string, DatabaseDefinition>();
  for (const entry of entries) {
    if (entry.kind === 'database') schemas.set(entry.id, parseDatabase(entry.text));
  }

  const notes = entries.filter((entry) => entry.kind === 'note').map((entry) => parseNote(entry.text, entry.path));
  const graph = projectRelations(notes, schemas);
  const hashes = new Map(entries.filter((entry) => entry.kind === 'note').map((entry) => [entry.id, sha256Hex(entry.rawBytes ?? Buffer.from(entry.text, 'utf8'))]));
  const rows = notes.flatMap((note) => {
    const row = graph.rows.get(note.id)?.get(databaseId);
    return row ? [{ ...row, title: note.title, updatedAt: note.updatedAt, contentHash: hashes.get(note.id)! }] : [];
  });
  const diagnostics = graph.diagnostics;

  const relationCandidates: NonNullable<UiDatabaseRowsResponse['relationCandidates']> = {};
  for (const property of schemas.get(databaseId)!.properties) if (property.type === 'relation') {
    relationCandidates[property.relation!.databaseId] = notes.filter((note) => compatibleRelationTarget(graph.rows.get(note.id)?.get(property.relation!.databaseId))).map((note) => ({ id: note.id, title: note.title, path: note.path, status: 'resolved' }));
  }
  return { databaseId, schemaHash, rows, diagnostics, relationCandidates };
}

async function createLocalNote(
  vault: FileSystemVault,
  body: Record<string, unknown>,
  clock: () => string,
  backlinkIndex: BacklinkIndex,
): Promise<{ note: UiNote }> {
  const title = normalizeTitle(body.title);
  const content = body.body === undefined ? '' : requireString(body.body, 'body');
  if (content.length > MAX_BODY_CHARS) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', `Note body exceeds ${MAX_BODY_CHARS} characters`);
  }
  let extraFrontmatter: Record<string, unknown> = {};
  if ('icon' in body) {
    const normalized = normalizePageIcon(body.icon);
    if (!normalized.ok) throw new ApiError(400, 'INVALID_INPUT', normalized.message);
    extraFrontmatter = applyPageIcon(extraFrontmatter, normalized.value);
  }
  const now = clock();
  const id = randomUUID();
  const folder = body.folder === undefined ? 'notes' : requireString(body.folder, 'folder');
  if (folder !== '' && body.folder !== undefined && !(await vault.listFolders()).includes(folder)) {
    throw new ApiError(404, 'NOT_FOUND', `Folder "${folder}" no longer exists. Refresh the sidebar and try again.`);
  }
  const path = await uniqueNotePath(vault, slugify(title), folder);

  const note = { ...createNote({ id, title, path, body: content, now }), extraFrontmatter };
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

async function backlinksForNote(rawId: string, index: LinkIndex): Promise<UiBacklinksResponse> {
  if (!isUuidV4(rawId)) throw new ApiError(400, 'INVALID_INPUT', 'Note ID must be a lowercase UUID v4');
  if (!index.notes.some((note) => note.id === rawId)) throw new ApiError(404, 'NOT_FOUND', 'Note was not found.');
  return { backlinks: backlinksByTarget(index).get(rawId) ?? [] };
}

async function listDatabases(vault: FileSystemVault): Promise<UiDatabase[]> {
  const summaries = await vault.listDatabases();
  const databases = await Promise.all(summaries.map((summary) => vault.readDatabaseWithHash(summary.id)));
  return databases
    .map(({ database, hash }) => toUiDatabase(database, hash))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function createLocalDatabase(
  vault: FileSystemVault,
  body: Record<string, unknown>,
): Promise<{ database: UiDatabase }> {
  const database = requireDatabaseInput(body.database);
  await vault.createDatabase(database);
  const saved = await vault.readDatabaseWithHash(database.id);
  return { database: toUiDatabase(saved.database, saved.hash) };
}

async function replaceLocalDatabase(
  vault: FileSystemVault,
  rawId: string,
  body: Record<string, unknown>,
): Promise<{ database: UiDatabase }> {
  const id = requireUuid(rawId, 'database ID');
  const database = requireDatabaseInput(body.database);
  if (database.id !== id) throw new ApiError(400, 'INVALID_INPUT', 'Database ID must match the URL.');
  const baseHash = requireHash(body.baseHash);
  try {
    await vault.replaceDatabase(database, { expectedHash: baseHash });
  } catch (error) {
    throw toDatabaseStaleApiError(error);
  }
  const saved = await vault.readDatabaseWithHash(id);
  return { database: toUiDatabase(saved.database, saved.hash) };
}

async function listDatabaseViews(vault: FileSystemVault, databaseId: string): Promise<UiDatabaseViewsResponse> {
  let database: DatabaseDefinition | undefined;
  let schemaHash: string | undefined;
  const entries = await vault.snapshot();
  const schemaEntry = entries.find((entry) => entry.kind === 'database' && entry.id === databaseId);
  if (schemaEntry !== undefined) {
    database = parseDatabase(schemaEntry.text);
    schemaHash = sha256Hex(schemaEntry.rawBytes ?? Buffer.from(schemaEntry.text, 'utf8'));
  }
  const views = entries.filter((entry) => entry.kind === 'database-view').flatMap((entry) => {
    const view = parseDatabaseView(entry.text);
    return view.databaseId === databaseId ? [{ view, path: entry.path, hash: sha256Hex(entry.rawBytes ?? Buffer.from(entry.text, 'utf8')) }] : [];
  });
  return {
    databaseId,
    ...(schemaHash === undefined ? {} : { schemaHash }),
    views: views.map(({ view, path, hash }) => ({ view, path, contentHash: hash, diagnostics: diagnoseDatabaseView(view, database) })),
  };
}

async function createLocalDatabaseView(vault: FileSystemVault, databaseId: string, body: Record<string, unknown>): Promise<{ view: UiDatabaseView }> {
  requireAllowedKeys(body, ['view'], 'request');
  const view = requireDatabaseViewInput(body.view);
  if (view.databaseId !== databaseId) throw new ApiError(400, 'INVALID_INPUT', 'Saved view databaseId must match the URL.');
  const schema = await vault.readDatabaseWithHash(databaseId);
  try { validateViewReferences(view, schema.database); }
  catch (error) { throw new ApiError(422, 'INVALID_VIEW_REFERENCES', error instanceof Error ? error.message : 'Saved view references are invalid.'); }
  try { await vault.createDatabaseView(view, { expectedDatabaseHash: schema.hash }); }
  catch (error) { throw toViewStaleApiError(error); }
  const saved = (await vault.listDatabaseViews(databaseId)).find((item) => item.view.id === view.id);
  if (!saved) throw new ApiError(500, 'INTERNAL_ERROR', 'Saved view was written but could not be read back.');
  return { view: { view: saved.view, path: saved.path, contentHash: saved.hash, diagnostics: [] } };
}

async function replaceLocalDatabaseView(vault: FileSystemVault, databaseId: string, viewId: string, body: Record<string, unknown>): Promise<{ view: UiDatabaseView }> {
  requireAllowedKeys(body, ['view', 'baseHash'], 'request');
  const view = requireDatabaseViewInput(body.view);
  if (view.databaseId !== databaseId || view.id !== viewId) throw new ApiError(400, 'INVALID_INPUT', 'Saved view IDs must match the URL.');
  const baseHash = requireHash(body.baseHash);
  const schema = await vault.readDatabaseWithHash(databaseId);
  try { validateViewReferences(view, schema.database); }
  catch (error) { throw new ApiError(422, 'INVALID_VIEW_REFERENCES', error instanceof Error ? error.message : 'Saved view references are invalid.'); }
  try { await vault.replaceDatabaseView(view, { expectedHash: baseHash, expectedDatabaseHash: schema.hash }); }
  catch (error) { throw toViewStaleApiError(error); }
  const saved = (await vault.listDatabaseViews(databaseId)).find((item) => item.view.id === view.id);
  if (!saved) throw new ApiError(500, 'INTERNAL_ERROR', 'Saved view was written but could not be read back.');
  return { view: { view: saved.view, path: saved.path, contentHash: saved.hash, diagnostics: [] } };
}

async function deleteLocalDatabaseView(vault: FileSystemVault, databaseId: string, viewId: string, body: Record<string, unknown>): Promise<{ deleted: true }> {
  requireAllowedKeys(body, ['baseHash'], 'request');
  const baseHash = requireHash(body.baseHash);
  try { await vault.deleteDatabaseView(databaseId, viewId, { expectedHash: baseHash }); }
  catch (error) { throw toViewStaleApiError(error); }
  return { deleted: true };
}

function requireAllowedKeys(value: Record<string, unknown>, allowed: string[], where: string): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw new ApiError(400, 'INVALID_INPUT', `Unknown field "${extra}" in ${where}.`);
}

function requireDatabaseViewInput(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ApiError(400, 'INVALID_INPUT', 'view must be an object.');
  try { return parseDatabaseView(JSON.stringify({ format: DATABASE_VIEW_FORMAT, version: ('type' in value || 'settings' in value) ? DATABASE_VIEW_VERSION : 1, ...value })); }
  catch (error) { throw new ApiError(400, 'INVALID_INPUT', error instanceof Error ? error.message : 'view is invalid.'); }
}

function toViewStaleApiError(error: unknown): unknown {
  if (isStorageError(error) && error.code === 'STALE_WRITE') {
    return new ApiError(409, 'STALE_WRITE', 'The saved view or its database schema changed on disk. Reload before saving.', { currentHash: error.details?.currentHash });
  }
  return error;
}

function requireDatabaseInput(value: unknown): DatabaseDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_INPUT', 'database must be an object.');
  }
  try {
    // The API has historically accepted the definition without the on-disk
    // envelope. Validate it as a complete supported schema before the storage
    // serializer can project it into its canonical representation. Explicit
    // envelope fields are accepted only when they describe a supported version.
    return parseDatabase(JSON.stringify({
      format: DATABASE_FORMAT,
      version: DATABASE_FORMAT_VERSION,
      ...value,
    }));
  } catch (error) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      error instanceof Error ? error.message : 'database is not a valid supported schema.',
    );
  }
}

function toDatabaseStaleApiError(error: unknown): unknown {
  if (isStorageError(error) && error.code === 'STALE_WRITE') {
    return new ApiError(
      409,
      'STALE_WRITE',
      'This database schema changed on disk after you opened it. Reload it before saving.',
      { currentHash: error.details?.currentHash },
    );
  }
  return error;
}

function toUiDatabase(database: DatabaseDefinition, hash: string): UiDatabase {
  return {
    id: database.id,
    name: database.name,
    path: `databases/${database.id}.json`,
    contentHash: hash,
    properties: database.properties.map((property) => ({
      id: property.id,
      name: property.name,
      type: property.type,
      ...(property.relation ? { relation: property.relation } : {}),
      ...(property.rollup ? { rollup: property.rollup } : {}),
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
): Promise<{ manifest: BackupManifest; counts: { notes: number; databases: number; databaseViews: number; attachments?: number } }> {
  const source = await requireBackupSource(requireString(body.dir, 'dir'), vault);
  const validation = await validateBackup(source);
  return {
    manifest: validation.manifest,
    counts: { notes: validation.notes.length, databases: validation.databases.length, databaseViews: validation.databaseViews.length,
      ...(validation.entries.some((entry) => entry.kind === 'attachment') ? { attachments: validation.entries.filter((entry) => entry.kind === 'attachment').length } : {}) },
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

async function uniqueNotePath(vault: FileSystemVault, slug: string, folder = 'notes'): Promise<string> {
  const notes = await vault.listNotes();
  const existing = new Set(notes.map((note) => foldPath(note.path)));
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? '' : `-${index}`;
    const path = folder ? `${folder}/${slug}${suffix}.md` : `${slug}${suffix}.md`;
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

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUuidV4(value)) {
    throw new ApiError(400, 'INVALID_INPUT', `${field} must be a lowercase UUID v4`);
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

async function readBinary(req: IncomingMessage, limit: number): Promise<Buffer> {
  const contentType = req.headers['content-type'] ?? '';
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/octet-stream')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Attachment body must be application/octet-stream.');
  }
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit)) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Attachment exceeds the 10 MiB upload limit.');
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) tooLarge = true;
    else if (!tooLarge) chunks.push(buffer);
  }
  if (tooLarge) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Attachment exceeds the 10 MiB upload limit.');
  if (size === 0) throw new ApiError(400, 'INVALID_INPUT', 'Attachment is empty.');
  return Buffer.concat(chunks, size);
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
        ...(Array.isArray(error.details?.structuredDataIssues)
          ? {
              structuredDataIssues:
                error.details.structuredDataIssues as UiApiErrorBody['error']['structuredDataIssues'],
            }
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
    case 'STALE_WRITE':
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
