import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { validatePortablePath } from '../storage/portable/manifest.js';
import { PLUGIN_MANIFEST_FILE, PLUGIN_PACKAGE_LIMITS } from './constants.js';
import type { PluginDiagnostic, PluginPackageFile, PluginPackageInventory } from './types.js';

/**
 * Inventory a package without executing it. File bytes are read through a
 * no-follow handle where the platform supports O_NOFOLLOW, and inode/size/time
 * metadata is checked again after each read to catch ordinary concurrent edits.
 */
export async function inventoryPluginPackage(packagePath: string, options: { expectedRoot?: string } = {}): Promise<PluginPackageInventory> {
  const absolutePackagePath = resolve(packagePath);
  const files: PluginPackageFile[] = [];
  const diagnostics: PluginDiagnostic[] = [];
  let manifestBytes: Uint8Array | null = null;
  let totalBytes = 0;
  let fileCount = 0;
  const seenPaths = new Set<string>();
  const foldedPaths = new Set<string>();
  let entryCount = 0;

  let rootInfo;
  try { rootInfo = await lstat(absolutePackagePath, { bigint: true }); }
  catch (error) { return empty(errorCode(error) === 'ENOENT' ? 'PACKAGE_ROOT_MISSING' : 'PACKAGE_ROOT_UNREADABLE', 'Plugin package directory could not be inspected.'); }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return empty('PACKAGE_ROOT_INVALID', 'Plugin package root must be a real directory.');

  let packageRoot: string;
  try {
    packageRoot = await realpath(absolutePackagePath);
    const rootAfterResolve = await lstat(absolutePackagePath, { bigint: true });
    if (rootAfterResolve.isSymbolicLink() || !rootAfterResolve.isDirectory() || rootAfterResolve.dev !== rootInfo.dev || rootAfterResolve.ino !== rootInfo.ino) {
      return empty('PACKAGE_CHANGED_DURING_READ', 'Plugin package root changed while it was being resolved.');
    }
    if (options.expectedRoot !== undefined) {
      const expectedRoot = await realpath(resolve(options.expectedRoot));
      const rel = relative(expectedRoot, packageRoot);
      if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return empty('PACKAGE_PATH_INVALID', 'Plugin package resolves outside the configured plugin root.');
    }
  }
  catch { return empty('PACKAGE_ROOT_UNREADABLE', 'Plugin package directory could not be resolved.'); }

  const visit = async (directory: string, relativeDirectory: string, depth: number): Promise<void> => {
    let directoryInfo;
    let canonicalDirectory;
    try {
      directoryInfo = await lstat(directory, { bigint: true });
      canonicalDirectory = await realpath(directory);
      const afterResolve = await lstat(directory, { bigint: true });
      const contained = relativeDirectory === '' ? canonicalDirectory === packageRoot : await containedRealPath(packageRoot, canonicalDirectory);
      if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory() || afterResolve.isSymbolicLink() || !afterResolve.isDirectory() || directoryInfo.dev !== afterResolve.dev || directoryInfo.ino !== afterResolve.ino || !contained) {
        diagnostics.push(diag('PACKAGE_PATH_INVALID', 'Package directory changed or escaped its package root.', relativeDirectory || undefined));
        return;
      }
    } catch {
      diagnostics.push(diag('PACKAGE_READ_FAILED', 'Plugin package directory could not be inspected.', relativeDirectory || undefined));
      return;
    }
    let dirents;
    try { dirents = await readdir(canonicalDirectory, { withFileTypes: true }); }
    catch { diagnostics.push(diag('PACKAGE_READ_FAILED', 'Unable to read a plugin package directory.', relativeDirectory || undefined)); return; }
    dirents.sort((left, right) => compare(left.name, right.name));
    for (const dirent of dirents) {
      entryCount += 1;
      const relativePath = relativeDirectory === '' ? dirent.name : `${relativeDirectory}/${dirent.name}`;
      if (entryCount > PLUGIN_PACKAGE_LIMITS.packageEntries) {
        diagnostics.push(diag('PACKAGE_ENTRY_LIMIT_EXCEEDED', `Package inventory exceeds ${PLUGIN_PACKAGE_LIMITS.packageEntries} entries.`, relativePath));
        return;
      }
      if (relativePath.split('/').length > PLUGIN_PACKAGE_LIMITS.nestingDepth + 1) {
        diagnostics.push(diag('PACKAGE_DEPTH_LIMIT_EXCEEDED', `Package nesting exceeds ${PLUGIN_PACKAGE_LIMITS.nestingDepth} directories.`, relativePath));
        continue;
      }
      if (!safeRelativePath(relativePath)) {
        diagnostics.push(diag('PACKAGE_PATH_INVALID', 'Package contains a path that is not a normalized relative POSIX path.', relativePath));
        continue;
      }
      if (seenPaths.has(relativePath)) {
        diagnostics.push(diag('PACKAGE_PATH_INVALID', 'Package contains a duplicate normalized path.', relativePath));
        continue;
      }
      const folded = relativePath.normalize('NFC').toLowerCase();
      if (foldedPaths.has(folded)) {
        diagnostics.push(diag('PACKAGE_PATH_INVALID', 'Package contains paths that collide on a case-insensitive filesystem.', relativePath));
        continue;
      }
      seenPaths.add(relativePath);
      foldedPaths.add(folded);

      const absolute = join(packageRoot, ...relativePath.split('/'));
      let info;
      try { info = await lstat(absolute, { bigint: true }); }
      catch { diagnostics.push(diag('PACKAGE_READ_FAILED', 'Package entry could not be inspected.', relativePath)); continue; }
      if (info.isSymbolicLink()) { diagnostics.push(diag('PACKAGE_SYMLINK', 'Symbolic links are not permitted in plugin packages.', relativePath)); continue; }
      if (info.isDirectory()) {
        if (depth >= PLUGIN_PACKAGE_LIMITS.nestingDepth) {
          diagnostics.push(diag('PACKAGE_DEPTH_LIMIT_EXCEEDED', `Package nesting exceeds ${PLUGIN_PACKAGE_LIMITS.nestingDepth} directories.`, relativePath));
          continue;
        }
        if (!await containedRealPath(packageRoot, absolute)) { diagnostics.push(diag('PACKAGE_PATH_INVALID', 'Package directory resolves outside its package root.', relativePath)); continue; }
        await visit(absolute, relativePath, depth + 1);
        continue;
      }
      if (!info.isFile()) { diagnostics.push(diag('PACKAGE_SPECIAL_FILE', 'Only regular files and directories are permitted in plugin packages.', relativePath)); continue; }
      fileCount += 1;
      if (fileCount > PLUGIN_PACKAGE_LIMITS.packageFiles) { diagnostics.push(diag('PACKAGE_FILE_LIMIT_EXCEEDED', `Package exceeds ${PLUGIN_PACKAGE_LIMITS.packageFiles} files.`, relativePath)); return; }
      if (info.size > BigInt(PLUGIN_PACKAGE_LIMITS.fileBytes)) { diagnostics.push(diag('PACKAGE_FILE_TOO_LARGE', `Package file exceeds ${PLUGIN_PACKAGE_LIMITS.fileBytes} bytes.`, relativePath)); continue; }
      const size = Number(info.size);
      if (!Number.isSafeInteger(size) || size < 0 || size > PLUGIN_PACKAGE_LIMITS.totalBytes - totalBytes) {
        diagnostics.push(diag('PACKAGE_SIZE_LIMIT_EXCEEDED', `Package exceeds ${PLUGIN_PACKAGE_LIMITS.totalBytes} total bytes.`, relativePath));
        continue;
      }
      if (!await containedRealPath(packageRoot, absolute)) { diagnostics.push(diag('PACKAGE_PATH_INVALID', 'Package file resolves outside its package root.', relativePath)); continue; }
      const read = await readRegularFile(absolute, info, relativePath);
      if (!read.ok) { diagnostics.push(diag(read.code, read.message, relativePath)); continue; }
      if (read.bytes.byteLength !== size) { diagnostics.push(diag('PACKAGE_CHANGED_DURING_READ', 'Package file size changed while it was being read.', relativePath)); continue; }
      const sha256 = createHash('sha256').update(read.bytes).digest('hex');
      files.push({ path: relativePath, size, sha256 });
      totalBytes += size;
      if (relativePath === PLUGIN_MANIFEST_FILE) {
        if (size > PLUGIN_PACKAGE_LIMITS.manifestBytes) diagnostics.push(diag('MANIFEST_TOO_LARGE', `Manifest exceeds ${PLUGIN_PACKAGE_LIMITS.manifestBytes} bytes.`, relativePath));
        else manifestBytes = read.bytes;
      }
    }
  };

  await visit(packageRoot, '', 0);
  files.sort((left, right) => compare(left.path, right.path));
  if (manifestBytes === null && !diagnostics.some((item) => item.path === PLUGIN_MANIFEST_FILE && item.code === 'MANIFEST_TOO_LARGE')) {
    diagnostics.push({ code: 'MANIFEST_FIELD_REQUIRED', severity: 'error', message: 'Plugin package is missing nodus-plugin.json.', path: PLUGIN_MANIFEST_FILE });
  }
  const hasErrors = diagnostics.some((item) => item.severity === 'error');
  return {
    packagePath: absolutePackagePath,
    files,
    totalBytes,
    fingerprint: hasErrors ? null : fingerprintPluginInventory(files),
    manifestBytes,
    diagnostics,
  };

  function empty(code: PluginDiagnostic['code'], message: string): PluginPackageInventory {
    return { packagePath: absolutePackagePath, files: [], totalBytes: 0, fingerprint: null, manifestBytes: null, diagnostics: [{ code, severity: 'error', message }] };
  }
}

/** Deterministic SHA-256 over the sorted path/size/content-digest inventory. */
export function fingerprintPluginInventory(files: readonly PluginPackageFile[]): string {
  const sorted = [...files].sort((left, right) => compare(left.path, right.path));
  const canonical = sorted.map(({ path, size, sha256 }) => [path, size, sha256]);
  return createHash('sha256')
    .update('nodus-plugin-package-v1\n', 'utf8')
    .update(JSON.stringify(canonical), 'utf8')
    .digest('hex');
}

async function readRegularFile(
  path: string,
  before: Awaited<ReturnType<typeof lstat>>,
  relativePath: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; code: 'PACKAGE_SYMLINK' | 'PACKAGE_SPECIAL_FILE' | 'PACKAGE_READ_FAILED' | 'PACKAGE_CHANGED_DURING_READ'; message: string }> {
  let handle;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    handle = await open(path, constants.O_RDONLY | noFollow);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) return { ok: false, code: 'PACKAGE_SPECIAL_FILE', message: 'Package entry is not a regular file.' };
    if (opened.dev !== before.dev || opened.ino !== before.ino) return { ok: false, code: 'PACKAGE_CHANGED_DURING_READ', message: 'Package file identity changed while it was being inspected.' };
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(path, { bigint: true });
    if (current.isSymbolicLink()) return { ok: false, code: 'PACKAGE_SYMLINK', message: 'Package entry became a symbolic link while it was being read.' };
    if (!current.isFile() || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || current.dev !== opened.dev || current.ino !== opened.ino || current.size !== opened.size || current.mtimeNs !== opened.mtimeNs || BigInt(bytes.byteLength) !== after.size) {
      return { ok: false, code: 'PACKAGE_CHANGED_DURING_READ', message: 'Package file changed while it was being read.' };
    }
    return { ok: true, bytes };
  } catch (error) {
    return { ok: false, code: errorCode(error) === 'ELOOP' ? 'PACKAGE_SYMLINK' : 'PACKAGE_READ_FAILED', message: errorCode(error) === 'ELOOP' ? 'Symbolic links are not permitted in plugin packages.' : `Unable to read package file${relativePath ? ` "${relativePath}"` : ''}.` };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function containedRealPath(root: string, target: string): Promise<boolean> {
  try {
    const resolved = await realpath(target);
    const rel = relative(root, resolved);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  } catch { return false; }
}

function safeRelativePath(value: string): boolean {
  try {
    validatePortablePath(value);
    return value.normalize('NFC') === value;
  } catch { return false; }
}

function errorCode(error: unknown): string | undefined { return (error as NodeJS.ErrnoException | undefined)?.code; }
function diag(code: PluginDiagnostic['code'], message: string, path?: string): PluginDiagnostic { return { code, severity: 'error', message, ...(path === undefined ? {} : { path }) }; }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
