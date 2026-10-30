import { createHash } from 'node:crypto';
import { lstat, stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DatabaseDefinition } from '../../database/schema.js';
import { parseDatabase } from '../../database/schema.js';
import { parseDatabaseView, type DatabaseView } from '../../database/database-view.js';
import type { Note } from '../../domain/note.js';
import { parseNote } from '../../format/note-format.js';
import type { ImportOptions, ImportPlan, ImportReport, PropertyCatalogFile, VaultEntry, VaultStorage } from '../contracts.js';
import { StorageError, storageFailure, wrapContentError } from '../errors.js';
import { databasePath, databaseViewPath } from '../fs/layout.js';
import { PROPERTY_CATALOG_PATH, parsePropertyCatalog } from '../../properties/catalog.js';
import { walkVault } from '../fs/scan.js';
import { attachmentPathId, validateAttachmentBytes, ATTACHMENT_MAX_BYTES } from '../fs/attachments.js';

/**
 * Reads and fully validates a portable import directory.
 *
 * Nothing is written. Every note and database is parsed with the Phase 1
 * validators, so duplicate IDs, path collisions, malformed files, and
 * unsupported versions are rejected before any target data can change.
 */
export async function planImport(sourceDir: string): Promise<ImportPlan> {
  const source = resolve(sourceDir);

  let info;
  try {
    info = await stat(source);
  } catch (error) {
    if (isMissing(error)) {
      throw new StorageError('NOT_FOUND', `Import source "${sourceDir}" was not found`, {
        path: sourceDir,
      });
    }
    throw storageFailure(error, 'Read import source', sourceDir);
  }
  if (!info.isDirectory()) {
    throw new StorageError('INVALID_INPUT', `Import source "${sourceDir}" is not a directory`, {
      path: sourceDir,
    });
  }

  const walk = await walkVault(source);
  if (walk.issues.length > 0) {
    throw new StorageError('INVALID_CONTENT', 'Import source contains unsupported entries', {
      details: { issues: walk.issues.map((issue) => `${issue.path}: ${issue.message}`) },
    });
  }
  if (walk.entries.some((entry) => entry.kind === 'temp')) {
    throw new StorageError(
      'INVALID_CONTENT',
      'Import source contains leftover temporary files; remove them before importing',
    );
  }

  const propertyCatalog = await readImportPropertyCatalog(source);
  const notes: Note[] = [];
  const databases: DatabaseDefinition[] = [];
  const databaseViews: DatabaseView[] = [];
  const entries: VaultEntry[] = [];
  const noteIds = new Map<string, string>();
  const databaseIds = new Map<string, string>();
  const viewIds = new Map<string, string>();
  const attachmentIds = new Map<string, string>();
  const foldedPaths = new Map<string, string>();

  for (const entry of walk.entries) {
    if (entry.kind !== 'note') continue;

    const text = await readText(entry.absolute, entry.path);
    let note: Note;
    try {
      note = parseNote(text, entry.path);
    } catch (error) {
      throw wrapContentError(error, entry.path);
    }

    const previous = noteIds.get(note.id);
    if (previous !== undefined) {
      throw new StorageError(
        'DUPLICATE_ID',
        `Import contains note ID "${note.id}" at both "${previous}" and "${entry.path}"`,
        { details: { ids: [note.id], paths: [previous, entry.path] } },
      );
    }
    noteIds.set(note.id, entry.path);
    assertNoPathCollision(entry.path, foldedPaths);

    notes.push(note);
    entries.push({ kind: 'note', id: note.id, path: entry.path, text });
  }

  for (const entry of walk.entries) {
    if (entry.kind !== 'database') continue;

    const text = await readText(entry.absolute, entry.path);
    let database: DatabaseDefinition;
    try {
      database = parseDatabase(text);
    } catch (error) {
      throw wrapContentError(error, entry.path);
    }

    const expected = databasePath(database.id);
    if (entry.path !== expected) {
      throw new StorageError(
        'INVALID_CONTENT',
        `Import file "${entry.path}" contains database ID "${database.id}"; expected path "${expected}"`,
        { path: entry.path, details: { ids: [database.id], paths: [entry.path, expected] } },
      );
    }

    const previous = databaseIds.get(database.id);
    if (previous !== undefined) {
      throw new StorageError(
        'DUPLICATE_ID',
        `Import contains database ID "${database.id}" more than once`,
        { details: { ids: [database.id], paths: [previous, entry.path] } },
      );
    }
    databaseIds.set(database.id, entry.path);
    assertNoPathCollision(entry.path, foldedPaths);

    databases.push(database);
    entries.push({ kind: 'database', id: database.id, path: entry.path, text });
  }

  for (const entry of walk.entries) {
    if (entry.kind !== 'database-view') continue;
    const text = await readText(entry.absolute, entry.path);
    let view: DatabaseView;
    try { view = parseDatabaseView(text); } catch (error) { throw wrapContentError(error, entry.path); }
    const expected = databaseViewPath(view.databaseId, view.id);
    if (entry.path !== expected) throw new StorageError('INVALID_CONTENT', `Import file "${entry.path}" does not match saved view ID and database ID; expected "${expected}"`, { path: entry.path, details: { ids: [view.databaseId, view.id], paths: [entry.path, expected] } });
    const previous = viewIds.get(view.id);
    if (previous !== undefined) throw new StorageError('DUPLICATE_ID', `Import contains saved view ID "${view.id}" more than once`, { details: { ids: [view.id], paths: [previous, entry.path] } });
    viewIds.set(view.id, entry.path);
    assertNoPathCollision(entry.path, foldedPaths);
    databaseViews.push(view);
    entries.push({ kind: 'database-view', id: view.id, path: entry.path, text });
  }

  for (const entry of walk.entries) {
    if (entry.kind !== 'attachment') continue;
    let bytes: Buffer;
    try { bytes = await readFile(entry.absolute); }
    catch (error) { throw storageFailure(error, 'Read import attachment', entry.path); }
    if (bytes.byteLength > ATTACHMENT_MAX_BYTES) throw new StorageError('INVALID_CONTENT', `Attachment "${entry.path}" exceeds the 10 MiB limit`, { path: entry.path });
    const valid = validateAttachmentBytes(entry.path, bytes);
    if (valid.id !== attachmentPathId(entry.path)) throw new StorageError('INVALID_CONTENT', `Attachment "${entry.path}" does not match its ID`, { path: entry.path });
    const previous = attachmentIds.get(valid.id);
    if (previous !== undefined) throw new StorageError('DUPLICATE_ID', `Import contains attachment ID "${valid.id}" more than once`, { details: { ids: [valid.id], paths: [previous, entry.path] } });
    attachmentIds.set(valid.id, entry.path);
    assertNoPathCollision(entry.path, foldedPaths);
    entries.push({ kind: 'attachment', id: valid.id, path: entry.path, text: '', rawBytes: Buffer.from(bytes) });
  }

  return { entries, notes, databases, databaseViews, ...(propertyCatalog === undefined ? {} : { propertyCatalog }) };
}

async function readImportPropertyCatalog(source: string): Promise<PropertyCatalogFile | undefined> {
  const propertiesDirectory = join(source, 'properties');
  let directoryInfo;
  try {
    directoryInfo = await lstat(propertiesDirectory);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw storageFailure(error, 'Read import property catalog directory', 'properties');
  }
  if (!directoryInfo.isDirectory()) {
    if (directoryInfo.isSymbolicLink()) throw new StorageError('INVALID_CONTENT', 'Import property catalog directory cannot be a symbolic link', { path: 'properties' });
    return undefined;
  }

  const catalogPath = join(source, PROPERTY_CATALOG_PATH);
  let catalogInfo;
  try {
    catalogInfo = await lstat(catalogPath);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw storageFailure(error, 'Read import property catalog', PROPERTY_CATALOG_PATH);
  }
  if (catalogInfo.isSymbolicLink() || !catalogInfo.isFile()) {
    throw new StorageError('INVALID_CONTENT', 'Import property catalog must be a regular file', { path: PROPERTY_CATALOG_PATH });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(catalogPath);
  } catch (error) {
    throw storageFailure(error, 'Read import property catalog', PROPERTY_CATALOG_PATH);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new StorageError('INVALID_CONTENT', `File "${PROPERTY_CATALOG_PATH}" is not valid UTF-8 text`, { path: PROPERTY_CATALOG_PATH });
  }
  let catalog;
  let version: number;
  try {
    catalog = parsePropertyCatalog(text);
    version = catalogVersionFromText(text);
  } catch (error) {
    throw wrapContentError(error, PROPERTY_CATALOG_PATH);
  }
  return {
    path: PROPERTY_CATALOG_PATH,
    text,
    rawBytes: Buffer.from(bytes),
    hash: createHash('sha256').update(bytes).digest('hex'),
    version,
    catalog,
  };
}

function catalogVersionFromText(text: string): number {
  const parsed = JSON.parse(text) as { version?: unknown };
  return typeof parsed.version === 'number' ? parsed.version : 0;
}

/** Applies a previously validated plan. Conflicts are checked before writing. */
export async function applyImport(
  vault: VaultStorage,
  plan: ImportPlan,
  options: ImportOptions = {},
): Promise<ImportReport> {
  return vault.applyImport(plan, options);
}

function assertNoPathCollision(path: string, seen: Map<string, string>): void {
  const key = path.normalize('NFC').toLowerCase();
  const previous = seen.get(key);
  if (previous !== undefined) {
    throw new StorageError(
      'CONFLICT',
      `Import contains two paths that collide on case-insensitive filesystems: "${previous}" and "${path}"`,
      { path, details: { paths: [previous, path] } },
    );
  }
  seen.set(key, path);
}

async function readText(absolute: string, relativePath: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    throw storageFailure(error, 'Read import file', relativePath);
  }

  try {
    // Keep a valid BOM in the planned text so imports preserve source bytes.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new StorageError('INVALID_CONTENT', `File "${relativePath}" is not valid UTF-8 text`, {
      path: relativePath,
    });
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
