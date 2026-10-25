import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { StorageError } from '../errors.js';

/** True when `target` is `root` or inside it, using real paths where they exist. */
export async function isInsideRoot(root: string, target: string): Promise<boolean> {
  const realRoot = await realpath(resolve(root));
  const existing = await nearestExistingAncestor(resolve(target));
  const resolvedExisting = await realpath(existing);
  const path = relative(realRoot, resolvedExisting);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

/**
 * Resolves a workspace-relative path and rejects anything that leaves the root.
 * This is defence in depth: Phase 1 path validation runs first.
 */
export function resolveInsideRoot(root: string, relativePath: string): string {
  const target = resolve(root, ...relativePath.split('/'));
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(prefix)) {
    throw new StorageError('UNSAFE_PATH', `Path "${relativePath}" escapes the vault root`, {
      path: relativePath,
    });
  }
  return target;
}

/**
 * Rejects a write whose nearest existing ancestor resolves outside the vault.
 * This catches directory symlinks and junctions that would escape the root.
 */
export async function assertInsideRoot(realRoot: string, target: string, relativePath: string): Promise<void> {
  const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (!target.startsWith(prefix)) {
    throw new StorageError('UNSAFE_PATH', `Path "${relativePath}" escapes the vault root`, {
      path: relativePath,
    });
  }

  const existing = await nearestExistingAncestor(target);
  const resolved = await realpath(existing);
  const matchesRoot =
    process.platform === 'win32'
      ? resolved.toLowerCase() === realRoot.toLowerCase()
      : resolved === realRoot;
  const inside = process.platform === 'win32'
    ? resolved.toLowerCase().startsWith(prefix.toLowerCase())
    : resolved.startsWith(prefix);
  if (!matchesRoot && !inside) {
    throw new StorageError('UNSAFE_PATH', `Path "${relativePath}" resolves outside the vault root`, {
      path: relativePath,
    });
  }
}

export async function assertNotSymlink(absolute: string, relativePath: string): Promise<void> {
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      throw new StorageError('UNSAFE_PATH', `Path "${relativePath}" is a symbolic link`, {
        path: relativePath,
      });
    }
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
}

export async function pathExists(absolute: string): Promise<boolean> {
  try {
    await lstat(absolute);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function nearestExistingAncestor(target: string): Promise<string> {
  let current = target;
  for (;;) {
    try {
      await stat(current);
      return current;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
