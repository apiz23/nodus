import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { FolderImpact } from '../contracts.js';
import { validateFolderPath } from '../../domain/paths.js';
import { parseNote, serializeNote } from '../../format/note-format.js';
import { StorageError, storageFailure, wrapInputError } from '../errors.js';
import { writeFileAtomic } from './atomic.js';
import { DATABASES_DIR, DATABASE_VIEWS_DIR, TEMP_PREFIX } from './layout.js';
import { assertInsideRoot, assertNotSymlink, pathExists, resolveInsideRoot } from './safe-path.js';
import { isManagedAttachmentDirectory } from './scan.js';

interface InventoryEntry {
  path: string;
  kind: 'folder' | 'file' | 'symlink';
  size: string;
  modified: string;
  changed: string;
}

function validPath(path: string): string {
  let valid: string;
  try { valid = validateFolderPath(path); } catch (error) { throw wrapInputError(error, 'Invalid folder path'); }
  const firstRaw = valid.split('/')[0];
  const first = firstRaw?.toLowerCase();
  if (first === DATABASES_DIR || first === DATABASE_VIEWS_DIR || firstRaw === 'attachments' || valid.toLowerCase() === 'notes') {
    throw new StorageError('INVALID_INPUT', `Folder path "${path}" is reserved by Nodus`);
  }
  return valid;
}

function displayPath(path: string): string {
  return path.startsWith('notes/') ? path.slice('notes/'.length) : path;
}

async function assertNoDisplayCollision(root: string, path: string, movingFrom?: string): Promise<void> {
  const target = displayPath(path).normalize('NFC').toLowerCase();
  const folders = await listVaultFolders(root);
  const collision = folders.find((folder) => {
    if (movingFrom !== undefined && (folder === movingFrom || folder.startsWith(`${movingFrom}/`))) return false;
    return displayPath(folder).normalize('NFC').toLowerCase() === target;
  });
  if (collision !== undefined) {
    throw new StorageError('CONFLICT', `Folder path "${path}" conflicts with "${collision}" in the sidebar`, { path, details: { paths: [path, collision] } });
  }
}

async function safePath(root: string, path: string): Promise<string> {
  const absolute = resolveInsideRoot(root, path);
  await assertInsideRoot(root, absolute, path);
  let current = root;
  for (const segment of path.split('/')) {
    current = join(current, segment);
    await assertNotSymlink(current, path);
  }
  return absolute;
}

async function requireDirectory(root: string, path: string): Promise<string> {
  const absolute = await safePath(root, path);
  let info;
  try { info = await lstat(absolute); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StorageError('NOT_FOUND', `Folder "${path}" was not found`, { path });
    throw storageFailure(error, 'Read folder', path);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new StorageError('INVALID_INPUT', `"${path}" is not a folder`, { path });
  return absolute;
}

export async function listVaultFolders(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (absolute: string, relative: string): Promise<void> => {
    let entries;
    try { entries = await readdir(absolute, { withFileTypes: true }); }
    catch (error) { throw storageFailure(error, 'Read directory', relative || '.'); }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (!relative && ([DATABASES_DIR, DATABASE_VIEWS_DIR].includes(entry.name.toLowerCase()) || (entry.name === 'attachments' && await isManagedAttachmentDirectory(join(absolute, entry.name))))) continue;
      result.push(path);
      await visit(join(absolute, entry.name), path);
    }
  };
  await visit(root, '');
  return result;
}

export async function createVaultFolder(root: string, path: string): Promise<void> {
  const valid = validPath(path);
  const absolute = await safePath(root, valid);
  const parentPath = posix.dirname(valid);
  if (parentPath !== '.') await requireDirectory(root, parentPath);
  else await assertInsideRoot(root, absolute, valid);
  if (await pathExists(absolute)) throw new StorageError('CONFLICT', `A file or folder already exists at "${valid}"`, { path: valid });
  await assertNoDisplayCollision(root, valid);
  try { await mkdir(absolute); } catch (error) { throw storageFailure(error, 'Create folder', valid); }
}

async function inventory(root: string, path: string): Promise<FolderImpact> {
  const absolute = await requireDirectory(root, path);
  const entries: InventoryEntry[] = [];
  const noteIds: string[] = [];
  const visit = async (current: string, relative: string): Promise<void> => {
    const dirents = await readdir(current, { withFileTypes: true });
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of dirents) {
      const child = join(current, dirent.name);
      const childRelative = relative ? `${relative}/${dirent.name}` : dirent.name;
      const info = await lstat(child, { bigint: true });
      const kind = info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'folder' : 'file';
      entries.push({
        path: childRelative,
        kind,
        size: String(info.size),
        modified: String(info.mtimeNs),
        changed: String(info.ctimeNs),
      });
      if (kind === 'folder') await visit(child, childRelative);
      if (kind === 'file' && dirent.name.endsWith('.md')) {
        try {
          const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(child));
          noteIds.push(parseNote(text, `${path}/${childRelative}`).id);
        } catch { /* Invalid or future-version Markdown is still counted and safely deleted only after explicit confirmation. */ }
      }
    }
  };
  await visit(absolute, '');
  const token = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  return {
    path,
    folders: entries.filter((entry) => entry.kind === 'folder').length,
    notes: entries.filter((entry) => entry.kind === 'file' && entry.path.endsWith('.md')).length,
    files: entries.filter((entry) => entry.kind !== 'folder' && (entry.kind !== 'file' || !entry.path.endsWith('.md'))).length,
    token,
    noteIds,
  };
}

export async function inspectVaultFolder(root: string, path: string): Promise<FolderImpact> {
  return inventory(root, validPath(path));
}

export async function moveVaultFolder(root: string, fromPath: string, toPath: string): Promise<void> {
  const from = validPath(fromPath);
  const to = validPath(toPath);
  if (from === to) return;
  const foldedFrom = from.normalize('NFC').toLowerCase();
  const foldedTo = to.normalize('NFC').toLowerCase();
  if (foldedTo.startsWith(`${foldedFrom}/`)) throw new StorageError('INVALID_INPUT', 'A folder cannot be moved into itself or one of its descendants', { path: to });
  const source = await requireDirectory(root, from);
  const target = await safePath(root, to);
  const parent = posix.dirname(to);
  if (parent !== '.') await requireDirectory(root, parent);
  if (await pathExists(target)) throw new StorageError('CONFLICT', `A file or folder already exists at "${to}"`, { path: to });
  await assertNoDisplayCollision(root, to, from);

  // Plain Markdown IDs are path-derived. Materialize those IDs before an
  // application-managed folder move so backlinks and relations keep identity.
  const conversions: Array<{ path: string; absolute: string; original: Buffer }> = [];
  const gather = async (current: string, relative: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const childPath = relative ? `${relative}/${entry.name}` : entry.name;
      const childAbsolute = join(current, entry.name);
      const safeChild = await safePath(root, `${from}/${childPath}`);
      const info = await lstat(safeChild);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) { await gather(childAbsolute, childPath); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const original = await readFile(safeChild);
      let note;
      try {
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(original);
        note = parseNote(text, `${from}/${childPath}`);
      } catch {
        // Corrupt and future-version files are moved byte-for-byte like other attachments.
        continue;
      }
      if (note.sourceFormat === 'plain-markdown') conversions.push({ path: childPath, absolute: safeChild, original });
    }
  };
  try { await gather(source, ''); }
  catch (error) { throw storageFailure(error, 'Inspect folder before move', from); }
  const written: typeof conversions = [];
  try {
    for (const conversion of conversions) {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(conversion.original);
      const note = parseNote(text, `${from}/${conversion.path}`);
      const safeFile = await safePath(root, `${from}/${conversion.path}`);
      await writeFileAtomic(safeFile, serializeNote({ ...note, sourceFormat: undefined }));
      written.push(conversion);
    }
    await rename(source, target);
  } catch (error) {
    const rollbackIssues: string[] = [];
    for (const conversion of written.reverse()) {
      try { await writeFileAtomic(conversion.absolute, conversion.original); }
      catch { rollbackIssues.push(`${from}/${conversion.path}`); }
    }
    if (rollbackIssues.length) {
      throw new StorageError('PARTIAL_WRITE', `Moving "${from}" failed and plain-note identity preparation could not be fully rolled back`, {
        cause: error, path: from, details: { paths: [from, to, ...rollbackIssues] },
      });
    }
    throw storageFailure(error, 'Move folder', from);
  }
}

export async function deleteVaultFolder(root: string, path: string, expectedToken: string): Promise<FolderImpact> {
  const valid = validPath(path);
  const impact = await inventory(root, valid);
  if (!/^[0-9a-f]{64}$/.test(expectedToken) || impact.token !== expectedToken) {
    throw new StorageError('STALE_WRITE', `Folder "${valid}" changed after its contents were reviewed. Review it again before deleting.`, {
      path: valid,
      details: { paths: [valid] },
    });
  }
  const absolute = await requireDirectory(root, valid);
  const parent = posix.dirname(valid);
  const temporaryPath = `${parent === '.' ? '' : `${parent}/`}${TEMP_PREFIX}delete-${randomUUID()}`;
  const temporaryAbsolute = resolveInsideRoot(root, temporaryPath);
  try {
    await rename(absolute, temporaryAbsolute);
  } catch (error) {
    throw storageFailure(error, 'Prepare folder deletion', valid);
  }
  try {
    await rm(temporaryAbsolute, { recursive: true, force: false });
  } catch (error) {
    throw new StorageError('PARTIAL_WRITE', `Could not fully delete folder "${valid}". The remaining data is at "${temporaryPath}"; inspect it and move any needed files back before retrying.`, {
      cause: error, path: valid, details: { paths: [valid, temporaryPath] },
    });
  }
  return impact;
}
