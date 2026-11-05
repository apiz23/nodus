import { StorageError } from '../errors.js';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

/**
 * Import resource bounds. These are deliberately package-level safeguards, not
 * per-vault storage limits. Managed attachments retain their stricter existing
 * 10 MiB validator; these bounds cap other resources and the multiple in-memory
 * representations used by planning, preview, and execution.
 */
export const IMPORT_MAX_RESOURCES = 10_000;
export const IMPORT_MAX_FILESYSTEM_ENTRIES = 20_000;
export const IMPORT_MAX_RESOURCE_BYTES = 64 * 1024 * 1024;
export const IMPORT_MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
export const IMPORT_MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const IMPORT_MAX_PATH_DEPTH = 64;

export interface ImportResourceSize {
  path: string;
  bytes: number;
}

export function validateImportResourceLimits(resources: readonly ImportResourceSize[], folders: readonly string[] = []): void {
  if (resources.length > IMPORT_MAX_RESOURCES) {
    throw new StorageError('INVALID_CONTENT', `Import contains ${resources.length} resources; the limit is ${IMPORT_MAX_RESOURCES}.`, { details: { issues: [`Resource count ${resources.length} exceeds limit ${IMPORT_MAX_RESOURCES}.`] } });
  }
  let total = 0;
  for (const resource of resources) {
    if (!Number.isSafeInteger(resource.bytes) || resource.bytes < 0 || resource.bytes > IMPORT_MAX_RESOURCE_BYTES) {
      throw new StorageError('INVALID_CONTENT', `Import resource "${resource.path}" exceeds the ${IMPORT_MAX_RESOURCE_BYTES / 1024 / 1024} MiB per-resource limit.`, { path: resource.path, details: { paths: [resource.path], issues: [`Resource size ${resource.bytes} exceeds limit ${IMPORT_MAX_RESOURCE_BYTES}.`] } });
    }
    total += resource.bytes;
    if (total > IMPORT_MAX_PACKAGE_BYTES) {
      throw new StorageError('INVALID_CONTENT', `Import package exceeds the ${IMPORT_MAX_PACKAGE_BYTES / 1024 / 1024} MiB total resource limit.`, { path: resource.path, details: { paths: [resource.path], issues: [`Aggregate resource size ${total} exceeds limit ${IMPORT_MAX_PACKAGE_BYTES}.`] } });
    }
    validateDepth(resource.path);
  }
  for (const folder of folders) validateDepth(folder);
}

/** Read a regular file with a hard allocation bound and reject observed mutation. */
export async function readBoundedImportFile(absolutePath: string, relativePath: string, maxBytes = IMPORT_MAX_RESOURCE_BYTES): Promise<Buffer> {
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink()) throw new StorageError('UNSAFE_PATH', `Import resource is not a regular file: ${relativePath}.`, { path: relativePath });
  if (before.size > maxBytes) throw new StorageError('INVALID_CONTENT', `Import resource "${relativePath}" exceeds its ${Math.floor(maxBytes / 1024 / 1024)} MiB read limit.`, { path: relativePath, details: { paths: [relativePath], issues: [`Resource size ${before.size} exceeds limit ${maxBytes}.`] } });
  let handle;
  try {
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    handle = await open(absolutePath, constants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new StorageError('UNSAFE_PATH', `Import resource changed while opening: ${relativePath}.`, { path: relativePath });
    if (opened.size > maxBytes) throw new StorageError('INVALID_CONTENT', `Import resource "${relativePath}" exceeds its ${Math.floor(maxBytes / 1024 / 1024)} MiB read limit.`, { path: relativePath, details: { paths: [relativePath], issues: [`Resource size ${opened.size} exceeds limit ${maxBytes}.`] } });
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new StorageError('INVALID_CONTENT', `Import resource "${relativePath}" grew beyond its ${Math.floor(maxBytes / 1024 / 1024)} MiB read limit.`, { path: relativePath, details: { paths: [relativePath], issues: [`Resource grew beyond limit ${maxBytes} while being read.`] } });
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    const currentPath = await lstat(absolutePath);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || currentPath.dev !== opened.dev || currentPath.ino !== opened.ino) {
      throw new StorageError('INVALID_CONTENT', `Import resource changed while it was being read: ${relativePath}.`, { path: relativePath });
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle?.close();
  }
}

function validateDepth(path: string): void {
  const depth = path.split('/').length;
  if (depth > IMPORT_MAX_PATH_DEPTH) {
    throw new StorageError('INVALID_CONTENT', `Import path "${path}" exceeds the ${IMPORT_MAX_PATH_DEPTH}-segment depth limit.`, { path, details: { paths: [path], issues: [`Path depth ${depth} exceeds limit ${IMPORT_MAX_PATH_DEPTH}.`] } });
  }
}
