import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DatabaseDefinition } from '../../database/schema.js';
import { parseDatabase } from '../../database/schema.js';
import type { Note } from '../../domain/note.js';
import { isUuidV4 } from '../../domain/ids.js';
import { NodusError } from '../../domain/errors.js';
import { parseNote } from '../../format/note-format.js';
import type {
  BackupManifest,
  BackupManifestFile,
  BackupOptions,
  BackupReport,
  BackupValidation,
  ImportOptions,
  ImportReport,
  VaultEntry,
  VaultStorage,
} from '../contracts.js';
import { StorageError, storageFailure } from '../errors.js';
import { writeFileAtomic } from '../fs/atomic.js';
import {
  BACKUP_FORMAT,
  BACKUP_MANIFEST,
  BACKUP_VERSION,
  databasePath,
} from '../fs/layout.js';
import { isInsideRoot, resolveInsideRoot } from '../fs/safe-path.js';
import { FileSystemVault } from '../fs/vault.js';

/**
 * Creates a recovery snapshot: every note and database definition, byte for
 * byte, plus a manifest of SHA-256 hashes written last.
 *
 * The target must be empty and outside the vault. A missing manifest therefore
 * means an interrupted or incomplete backup.
 */
export async function createBackup(
  vault: VaultStorage,
  targetDir: string,
  options: BackupOptions = {},
): Promise<BackupReport> {
  const target = resolve(targetDir);
  if (await isInsideRoot(vault.root, target)) {
    throw new StorageError('INVALID_INPUT', 'Backup target must be outside the vault', {
      path: targetDir,
    });
  }

  const entries = await vault.snapshot();

  try {
    await mkdir(target, { recursive: true });
  } catch (error) {
    throw storageFailure(error, 'Create backup directory', targetDir);
  }

  const existing = await readdir(target).catch((error: unknown) => {
    throw storageFailure(error, 'Read backup directory', targetDir);
  });
  if (existing.length > 0) {
    throw new StorageError('CONFLICT', `Backup target "${targetDir}" is not empty; refusing to overwrite`, {
      path: targetDir,
      details: { paths: [targetDir] },
    });
  }

  const files: BackupManifestFile[] = [];
  let notes = 0;
  let databases = 0;

  try {
    for (const entry of entries) {
      await writeFileAtomic(resolveInsideRoot(target, entry.path), entry.text);
      files.push({
        kind: entry.kind,
        id: entry.id,
        path: entry.path,
        sha256: sha256(entry.text),
      });
      if (entry.kind === 'note') notes += 1;
      else databases += 1;
    }

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: options.now ?? new Date().toISOString(),
      files,
    };
    await writeFileAtomic(join(target, BACKUP_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    throw storageFailure(error, 'Write backup', targetDir);
  }

  return { targetDir: target, notes, databases };
}

/**
 * Validates a backup without writing anything.
 *
 * Checks the manifest, every hash, every document with the Phase 1 validators,
 * IDs against the manifest, and the database file naming rule.
 */
export async function validateBackup(targetDir: string): Promise<BackupValidation> {
  const target = resolve(targetDir);
  const manifest = await readManifest(target);
  const issues: string[] = [];
  const entries: VaultEntry[] = [];
  const notes: Note[] = [];
  const databases: DatabaseDefinition[] = [];

  const ids = new Set<string>();
  const paths = new Set<string>();

  for (const file of manifest.files) {
    const idKey = `${file.kind}:${file.id}`;
    if (ids.has(idKey)) issues.push(`Duplicate ${file.kind} ID "${file.id}" in manifest`);
    ids.add(idKey);

    const pathKey = file.path.normalize('NFC').toLowerCase();
    if (paths.has(pathKey)) issues.push(`Duplicate path "${file.path}" in manifest`);
    paths.add(pathKey);
  }

  for (const file of manifest.files) {
    let absolute: string;
    try {
      absolute = resolveInsideRoot(target, file.path);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    let info;
    try {
      info = await lstat(absolute);
    } catch (error) {
      if (isMissing(error)) {
        issues.push(`Missing file "${file.path}"`);
        continue;
      }
      throw storageFailure(error, 'Read backup file', file.path);
    }

    if (info.isSymbolicLink() || !info.isFile()) {
      issues.push(`Backup entry "${file.path}" is not a regular file`);
      continue;
    }

    let text: string;
    try {
      text = await readFile(absolute, 'utf8');
    } catch (error) {
      if (isMissing(error)) {
        issues.push(`Missing file "${file.path}"`);
        continue;
      }
      throw storageFailure(error, 'Read backup file', file.path);
    }

    if (sha256(text) !== file.sha256) {
      issues.push(`Hash mismatch for "${file.path}"`);
      continue;
    }

    if (file.kind === 'note') {
      try {
        const note = parseNote(text, file.path);
        if (note.id !== file.id) {
          issues.push(`Note at "${file.path}" has ID "${note.id}", expected "${file.id}"`);
          continue;
        }
        notes.push(note);
      } catch (error) {
        const unsupported = unsupportedError(error, file.path);
        if (unsupported !== undefined) throw unsupported;
        issues.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    } else {
      if (file.path !== databasePath(file.id)) {
        issues.push(`Database "${file.id}" must be stored at "${databasePath(file.id)}"`);
        continue;
      }
      try {
        const database = parseDatabase(text);
        if (database.id !== file.id) {
          issues.push(`Database at "${file.path}" has ID "${database.id}", expected "${file.id}"`);
          continue;
        }
        databases.push(database);
      } catch (error) {
        const unsupported = unsupportedError(error, file.path);
        if (unsupported !== undefined) throw unsupported;
        issues.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }

    entries.push({ kind: file.kind, id: file.id, path: file.path, text });
  }

  if (issues.length > 0) {
    throw new StorageError(
      'CORRUPT_BACKUP',
      `Backup validation failed with ${issues.length} issue(s)`,
      { details: { issues } },
    );
  }

  return { manifest, entries, notes, databases };
}

/**
 * Restores a backup after full validation.
 *
 * The backup itself is only read. Existing target data is replaced only when
 * `{ overwrite: true }` is passed; otherwise any ID or path conflict aborts
 * before a single write.
 */
export async function restoreBackup(
  backupDir: string,
  targetRoot: string,
  options: ImportOptions = {},
): Promise<ImportReport> {
  const backup = resolve(backupDir);
  const target = resolve(targetRoot);

  if (await isInsideRoot(backup, target)) {
    throw new StorageError('INVALID_INPUT', 'Restore target must not be inside the backup directory', {
      path: targetRoot,
    });
  }

  const validation = await validateBackup(backup);

  let vault: FileSystemVault;
  try {
    vault = await FileSystemVault.open(target);
  } catch (error) {
    throw storageFailure(error, 'Open restore target', targetRoot);
  }

  return vault.applyImport(
    {
      entries: validation.entries,
      notes: validation.notes,
      databases: validation.databases,
    },
    { overwrite: options.overwrite },
  );
}

async function readManifest(target: string): Promise<BackupManifest> {
  const path = join(target, BACKUP_MANIFEST);

  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      throw new StorageError(
        'CORRUPT_BACKUP',
        `Backup manifest "${BACKUP_MANIFEST}" is missing; the backup is incomplete`,
        { path: BACKUP_MANIFEST },
      );
    }
    throw storageFailure(error, 'Read backup manifest', target);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new StorageError('CORRUPT_BACKUP', `Backup manifest is not valid JSON`, {
      path: BACKUP_MANIFEST,
    });
  }

  if (!isRecord(data)) {
    throw new StorageError('CORRUPT_BACKUP', 'Backup manifest must be a JSON object', {
      path: BACKUP_MANIFEST,
    });
  }
  if (data.format !== BACKUP_FORMAT) {
    throw new StorageError('CORRUPT_BACKUP', `Backup manifest format must be "${BACKUP_FORMAT}"`, {
      path: BACKUP_MANIFEST,
    });
  }

  const version = data.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new StorageError('CORRUPT_BACKUP', 'Backup manifest version must be a positive integer', {
      path: BACKUP_MANIFEST,
    });
  }
  if (version > BACKUP_VERSION) {
    throw new StorageError(
      'UNSUPPORTED_VERSION',
      `Backup version ${version} is newer than supported version ${BACKUP_VERSION}`,
      { path: BACKUP_MANIFEST },
    );
  }
  if (typeof data.createdAt !== 'string') {
    throw new StorageError('CORRUPT_BACKUP', 'Backup manifest createdAt must be a string', {
      path: BACKUP_MANIFEST,
    });
  }
  if (!Array.isArray(data.files)) {
    throw new StorageError('CORRUPT_BACKUP', 'Backup manifest files must be an array', {
      path: BACKUP_MANIFEST,
    });
  }

  const issues: string[] = [];
  const files: BackupManifestFile[] = [];

  data.files.forEach((item: unknown, index: number) => {
    if (!isRecord(item)) {
      issues.push(`files[${index}] is not an object`);
      return;
    }
    if (item.kind !== 'note' && item.kind !== 'database') {
      issues.push(`files[${index}].kind must be "note" or "database"`);
      return;
    }
    if (typeof item.id !== 'string' || !isUuidV4(item.id)) {
      issues.push(`files[${index}].id must be a lowercase UUID v4`);
      return;
    }
    if (typeof item.path !== 'string' || item.path.length === 0) {
      issues.push(`files[${index}].path must be a non-empty string`);
      return;
    }
    if (typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)) {
      issues.push(`files[${index}].sha256 must be a lowercase SHA-256 hex digest`);
      return;
    }
    files.push({ kind: item.kind, id: item.id, path: item.path, sha256: item.sha256 });
  });

  if (issues.length > 0) {
    throw new StorageError('CORRUPT_BACKUP', `Backup manifest is invalid`, {
      path: BACKUP_MANIFEST,
      details: { issues },
    });
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: data.createdAt,
    files,
  };
}

function unsupportedError(error: unknown, path: string): StorageError | undefined {
  if (error instanceof NodusError && error.code === 'UNSUPPORTED_VERSION') {
    return new StorageError('UNSUPPORTED_VERSION', `${path}: ${error.message}`, {
      cause: error,
      path,
    });
  }
  return undefined;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
