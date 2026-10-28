import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { StorageIssue } from '../contracts.js';
import { storageFailure } from '../errors.js';
import { DATABASES_DIR, DATABASE_VIEWS_DIR, TEMP_PREFIX } from './layout.js';

export interface WalkEntry {
  kind: 'note' | 'database' | 'database-view' | 'temp';
  absolute: string;
  /** Workspace-relative POSIX path. */
  path: string;
}

export interface WalkResult {
  entries: WalkEntry[];
  issues: StorageIssue[];
}

/**
 * Walks a vault without following symbolic links.
 *
 * Hidden files and directories are skipped, except leftover `.nodus-tmp-*`
 * files, which are reported so `checkHealth` can surface interrupted writes.
 */
export async function walkVault(root: string): Promise<WalkResult> {
  const entries: WalkEntry[] = [];
  const issues: StorageIssue[] = [];

  await walkDirectory(root, '', entries, issues);

  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { entries, issues };
}

async function walkDirectory(
  absolute: string,
  relative: string,
  entries: WalkEntry[],
  issues: StorageIssue[],
): Promise<void> {
  let dirents;
  try {
    dirents = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    throw storageFailure(error, 'Read directory', relative === '' ? '.' : relative);
  }

  dirents.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  for (const dirent of dirents) {
    const childRelative = relative === '' ? dirent.name : `${relative}/${dirent.name}`;
    const childAbsolute = join(absolute, dirent.name);

    if (dirent.name.startsWith(TEMP_PREFIX)) {
      entries.push({ kind: 'temp', absolute: childAbsolute, path: childRelative });
      continue;
    }
    if (dirent.name.startsWith('.')) continue;

    if (dirent.isSymbolicLink()) {
      issues.push({
        code: 'UNSAFE_PATH',
        path: childRelative,
        message: 'Symbolic links are not followed',
      });
      continue;
    }

    if (dirent.isDirectory()) {
      if (relative === '' && dirent.name.toLowerCase() === DATABASES_DIR) {
        await collectDatabases(childAbsolute, childRelative, entries, issues);
        continue;
      }
      if (relative === '' && dirent.name.toLowerCase() === DATABASE_VIEWS_DIR) {
        await collectDatabaseViews(childAbsolute, childRelative, entries, issues);
        continue;
      }
      await walkDirectory(childAbsolute, childRelative, entries, issues);
      continue;
    }

    if (dirent.isFile() && dirent.name.endsWith('.md')) {
      entries.push({ kind: 'note', absolute: childAbsolute, path: childRelative });
    }
  }
}

async function collectDatabaseViews(absolute: string, relative: string, entries: WalkEntry[], issues: StorageIssue[]): Promise<void> {
  let databases;
  try { databases = await readdir(absolute, { withFileTypes: true }); }
  catch (error) { throw storageFailure(error, 'Read directory', relative); }
  databases.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const database of databases) {
    const dbPath = `${relative}/${database.name}`;
    const dbAbsolute = join(absolute, database.name);
    if (database.name.startsWith(TEMP_PREFIX)) { entries.push({ kind: 'temp', absolute: dbAbsolute, path: dbPath }); continue; }
    if (database.isSymbolicLink()) { issues.push({ code: 'UNSAFE_PATH', path: dbPath, message: 'Symbolic links are not followed' }); continue; }
    if (database.name.startsWith('.') || !database.isDirectory()) {
      issues.push({ code: 'INVALID_CONTENT', path: dbPath, message: 'The database-views/ directory may only contain database ID directories' });
      continue;
    }
    let views;
    try { views = await readdir(dbAbsolute, { withFileTypes: true }); }
    catch (error) { throw storageFailure(error, 'Read directory', dbPath); }
    views.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const view of views) {
      const viewPath = `${dbPath}/${view.name}`;
      const viewAbsolute = join(dbAbsolute, view.name);
      if (view.name.startsWith(TEMP_PREFIX)) { entries.push({ kind: 'temp', absolute: viewAbsolute, path: viewPath }); continue; }
      if (view.isSymbolicLink()) { issues.push({ code: 'UNSAFE_PATH', path: viewPath, message: 'Symbolic links are not followed' }); continue; }
      if (view.name.startsWith('.') || !view.isFile() || !view.name.endsWith('.json')) {
        issues.push({ code: 'INVALID_CONTENT', path: viewPath, message: 'A database view directory may only contain Nodus .json view files' });
        continue;
      }
      entries.push({ kind: 'database-view', absolute: viewAbsolute, path: viewPath });
    }
  }
}

async function collectDatabases(
  absolute: string,
  relative: string,
  entries: WalkEntry[],
  issues: StorageIssue[],
): Promise<void> {
  let dirents;
  try {
    dirents = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    throw storageFailure(error, 'Read directory', relative);
  }

  dirents.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  for (const dirent of dirents) {
    const childRelative = `${relative}/${dirent.name}`;
    const childAbsolute = join(absolute, dirent.name);

    if (dirent.name.startsWith(TEMP_PREFIX)) {
      entries.push({ kind: 'temp', absolute: childAbsolute, path: childRelative });
      continue;
    }
    if (dirent.name.startsWith('.')) continue;
    if (dirent.isSymbolicLink()) {
      issues.push({
        code: 'UNSAFE_PATH',
        path: childRelative,
        message: 'Symbolic links are not followed',
      });
      continue;
    }
    if (dirent.isFile() && dirent.name.endsWith('.json')) {
      entries.push({ kind: 'database', absolute: childAbsolute, path: childRelative });
      continue;
    }
    issues.push({
      code: 'INVALID_CONTENT',
      path: childRelative,
      message: 'The databases/ directory may only contain Nodus .json definitions',
    });
  }
}
