import { opendir, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import type { StorageIssue } from '../contracts.js';
import { StorageError, storageFailure } from '../errors.js';
import { DATABASES_DIR, DATABASE_VIEWS_DIR, TEMP_PREFIX } from './layout.js';
import { attachmentPathId, ATTACHMENTS_DIR } from './attachments.js';

export interface WalkEntry {
  kind: 'note' | 'database' | 'database-view' | 'attachment' | 'temp';
  absolute: string;
  /** Workspace-relative POSIX path. */
  path: string;
}

export interface WalkResult {
  entries: WalkEntry[];
  /** Non-fatal walker findings. Traversal-budget exhaustion throws instead. */
  issues: StorageIssue[];
  /** Visible filesystem directories, including empty folders. */
  folders: string[];
}

/**
 * Walks a vault without following symbolic links.
 *
 * Hidden files and directories are skipped, except leftover `.nodus-tmp-*`
 * files, which are reported so `checkHealth` can surface interrupted writes.
 *
 * Traversal bounds are fail-closed. Exceeding `maxEntries` or the shared
 * `budget` throws a structured `INVALID_CONTENT` storage error before another
 * entry is stored; an overflow entry is charged to detect the violation, and
 * no partial inventory is returned. `issues` holds only
 * non-fatal walker findings.
 */
export async function walkVault(root: string, options: { maxDepth?: number; maxEntries?: number; budget?: TraversalBudget } = {}): Promise<WalkResult> {
  const entries: WalkEntry[] = [];
  const issues: StorageIssue[] = [];
  const folders: string[] = [];

  await walkDirectory(root, '', entries, issues, folders, options.maxDepth, options.budget ?? { count: 0, max: options.maxEntries });

  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  folders.sort();
  return { entries, issues, folders };
}

async function walkDirectory(
  absolute: string,
  relative: string,
  entries: WalkEntry[],
  issues: StorageIssue[],
  folders: string[],
  maxDepth: number | undefined,
  budget: TraversalBudget,
  supplied?: Dirent[],
): Promise<void> {
  let dirents;
  try {
    dirents = supplied ?? await boundedEntries(absolute, budget);
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
      if (maxDepth !== undefined && childRelative.split('/').length > maxDepth) {
        issues.push({ code: 'INVALID_CONTENT', path: childRelative, message: `Directory depth exceeds the ${maxDepth}-segment import limit` });
        continue;
      }
      if (relative === '' && dirent.name.toLowerCase() === DATABASES_DIR) {
        await collectDatabases(childAbsolute, childRelative, entries, issues, budget);
        continue;
      }
      if (relative === '' && dirent.name.toLowerCase() === DATABASE_VIEWS_DIR) {
        await collectDatabaseViews(childAbsolute, childRelative, entries, issues, budget);
        continue;
      }
      if (relative === '' && dirent.name === ATTACHMENTS_DIR) {
        const children = await boundedEntries(childAbsolute, budget);
        if (children.every((child) => child.name.startsWith('.') || (!child.isSymbolicLink() && child.isFile() && attachmentPathId(`${ATTACHMENTS_DIR}/${child.name}`) !== undefined))) {
          await collectAttachments(childAbsolute, childRelative, entries, issues, budget, children);
          continue;
        }
        // An ordinary user folder is traversed once using its already charged entries.
        folders.push(childRelative);
        await walkDirectory(childAbsolute, childRelative, entries, issues, folders, maxDepth, budget, children);
        continue;
      }
      folders.push(childRelative);
      await walkDirectory(childAbsolute, childRelative, entries, issues, folders, maxDepth, budget);
      continue;
    }

    if (dirent.isFile() && dirent.name.endsWith('.md')) {
      entries.push({ kind: 'note', absolute: childAbsolute, path: childRelative });
    }
  }
}

/** Avoid reinterpreting an existing user folder as managed storage unless all visible children use Nodus IDs. */
export async function isManagedAttachmentDirectory(absolute: string): Promise<boolean> {
  let children;
  try { children = await readdir(absolute, { withFileTypes: true }); }
  catch (error) { throw storageFailure(error, 'Read attachment directory', absolute); }
  return children.every((child) => child.name.startsWith('.') || (!child.isSymbolicLink() && child.isFile() && attachmentPathId(`${ATTACHMENTS_DIR}/${child.name}`) !== undefined));
}

async function collectAttachments(absolute: string, relative: string, entries: WalkEntry[], issues: StorageIssue[], budget: TraversalBudget, supplied?: Dirent[]): Promise<void> {
  let files;
  try { files = supplied ?? await boundedEntries(absolute, budget); }
  catch (error) { throw storageFailure(error, 'Read directory', relative); }
  files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const file of files) {
    if (file.name.startsWith(TEMP_PREFIX)) { entries.push({ kind: 'temp', absolute: join(absolute, file.name), path: `${relative}/${file.name}` }); continue; }
    if (file.name.startsWith('.')) continue;
    const path = `${relative}/${file.name}`;
    if (file.isSymbolicLink()) { issues.push({ code: 'UNSAFE_PATH', path, message: 'Symbolic links are not followed' }); continue; }
    if (!file.isFile() || attachmentPathId(path) === undefined) {
      issues.push({ code: 'INVALID_CONTENT', path, message: 'The attachments/ directory may only contain managed Nodus attachments' });
      continue;
    }
    entries.push({ kind: 'attachment', absolute: join(absolute, file.name), path });
  }
}

async function collectDatabaseViews(absolute: string, relative: string, entries: WalkEntry[], issues: StorageIssue[], budget: TraversalBudget, supplied?: Dirent[]): Promise<void> {
  let databases;
  try { databases = await boundedEntries(absolute, budget); }
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
    try { views = await boundedEntries(dbAbsolute, budget); }
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
  budget: TraversalBudget,
  supplied?: Dirent[],
): Promise<void> {
  let dirents;
  try {
    dirents = supplied ?? await boundedEntries(absolute, budget);
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

/** Charges every discovered entry, including hidden and specialized resources,
 * before storing it. Failure aborts the whole walk; no partial inventory escapes.
 */
export interface TraversalBudget {
  count: number;
  max: number | undefined;
  check?: () => void;
}

export async function boundedEntries(absolute: string, budget: TraversalBudget): Promise<Dirent[]> {
  budget.check?.();
  const entries: Dirent[] = [];
  const directory = await opendir(absolute);
  let primary: unknown;
  let failed = false;
  try {
    for (;;) {
      budget.check?.();
      const entry = await directory.read();
      if (entry === null) break;
      budget.count += 1;
      budget.check?.();
      if (budget.max !== undefined && budget.count > budget.max) {
        throw new StorageError('INVALID_CONTENT', `Directory inventory exceeds the inclusive ${budget.max}-entry limit`);
      }
      entries.push(entry);
    }
  } catch (error) { failed = true; primary = error; }
  try { await directory.close(); }
  catch (cleanup) {
    if (failed) throw new AggregateError([primary, cleanup], 'Directory inspection and cleanup failed');
    throw cleanup;
  }
  if (failed) throw primary;
  return entries;
}
