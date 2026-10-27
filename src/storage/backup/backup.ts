import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DatabaseDefinition } from '../../database/schema.js';
import { DATABASE_FORMAT_VERSION, parseDatabase } from '../../database/schema.js';
import type { Note } from '../../domain/note.js';
import { NOTE_FORMAT_VERSION } from '../../domain/note.js';
import { isUuidV4 } from '../../domain/ids.js';
import { NodusError } from '../../domain/errors.js';
import { parseNote } from '../../format/note-format.js';
import { validateNotePath } from '../../domain/paths.js';
import type {
  BackupManifest,
  BackupManifestApp,
  BackupManifestCounts,
  BackupManifestFile,
  BackupManifestFormats,
  BackupOptions,
  BackupReport,
  BackupValidation,
  ImportOptions,
  ImportReport,
  RestorePreview,
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
  isReservedNotePath,
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
  for (const entry of entries) {
    const issue = restorePathIssue(entry.kind, entry.id, entry.path);
    if (issue !== undefined) {
      throw new StorageError('INVALID_CONTENT', issue, { path: entry.path });
    }
  }
  const backupEntries = entries.map((entry) => {
    const bytes = entry.rawBytes ?? Buffer.from(entry.text, 'utf8');
    const text = decodeUtf8(bytes, entry.path, 'INVALID_CONTENT');
    if (text !== entry.text) {
      throw new StorageError('INVALID_CONTENT', `File "${entry.path}" is not valid UTF-8 text`, {
        path: entry.path,
      });
    }
    return { entry, bytes };
  });

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
    for (const { entry, bytes } of backupEntries) {
      await writeFileAtomic(resolveInsideRoot(target, entry.path), bytes);
      files.push({
        kind: entry.kind,
        id: entry.id,
        path: entry.path,
        sha256: sha256(bytes),
        bytes: bytes.byteLength,
      });
      if (entry.kind === 'note') notes += 1;
      else databases += 1;
    }

    const app = await readAppInfo();
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: options.now ?? new Date().toISOString(),
      ...(app === undefined ? {} : { app }),
      formats: { note: NOTE_FORMAT_VERSION, database: DATABASE_FORMAT_VERSION, backup: BACKUP_VERSION },
      counts: { notes, databases },
      files,
    };
    manifest.digest = digestOf(manifest);
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
  let rootInfo;
  try {
    rootInfo = await lstat(target);
  } catch (error) {
    throw storageFailure(error, 'Read backup directory', targetDir);
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw corruptBackup(`Backup root "${targetDir}" is not a regular directory`);
  }
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
    const pathIssue = restorePathIssue(file.kind, file.id, file.path);
    if (pathIssue !== undefined) issues.push(pathIssue);
  }
  if (issues.length > 0) {
    throw new StorageError('CORRUPT_BACKUP', 'Backup validation failed before reading entries', {
      details: { issues },
    });
  }

  for (const file of manifest.files) {
    let absolute: string;
    try {
      absolute = resolveInsideRoot(target, file.path);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    try {
      await assertNoSymlinkComponents(target, file.path);
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

    let bytes: Buffer;
    try {
      bytes = await readFile(absolute);
    } catch (error) {
      if (isMissing(error)) {
        issues.push(`Missing file "${file.path}"`);
        continue;
      }
      throw storageFailure(error, 'Read backup file', file.path);
    }

    if (file.bytes !== undefined && bytes.byteLength !== file.bytes) {
      issues.push(`Byte length mismatch for "${file.path}"`);
      continue;
    }
    if (sha256(bytes) !== file.sha256) {
      issues.push(`Hash mismatch for "${file.path}"`);
      continue;
    }

    let text: string;
    try {
      text = decodeUtf8(bytes, file.path);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
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

/**
 * Validates a backup and reports how a restore would merge into `vault`,
 * without writing anything on either side.
 *
 * Counts come from the parsed documents, not the manifest. Conflicts mirror
 * the ID and path checks `applyImport` runs before a restore: note IDs against
 * note IDs, database IDs against database IDs, and note paths compared after
 * case folding/NFC normalization.
 */
export async function previewRestore(
  backupDir: string,
  vault: VaultStorage,
): Promise<RestorePreview> {
  const validation = await validateBackup(backupDir);
  const existing = await vault.snapshot();

  const noteIds = new Set<string>();
  const databaseIds = new Set<string>();
  const notePaths = new Set<string>();
  for (const entry of existing) {
    if (entry.kind === 'note') {
      noteIds.add(entry.id);
      notePaths.add(foldPath(entry.path));
    } else {
      databaseIds.add(entry.id);
    }
  }

  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const note of validation.notes) {
    if (noteIds.has(note.id)) ids.add(note.id);
    if (notePaths.has(foldPath(note.path))) paths.add(note.path);
  }
  for (const database of validation.databases) {
    if (databaseIds.has(database.id)) ids.add(database.id);
  }

  return {
    manifest: validation.manifest,
    counts: { notes: validation.notes.length, databases: validation.databases.length },
    conflicts: { ids: [...ids].sort(), paths: [...paths].sort() },
  };
}

async function readManifest(target: string): Promise<BackupManifest> {
  const path = join(target, BACKUP_MANIFEST);

  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw corruptBackup(`Backup manifest "${BACKUP_MANIFEST}" is not a regular file`);
    }
  } catch (error) {
    if (isMissing(error)) {
      throw new StorageError(
        'CORRUPT_BACKUP',
        `Backup manifest "${BACKUP_MANIFEST}" is missing; the backup is incomplete`,
        { path: BACKUP_MANIFEST },
      );
    }
    if (error instanceof StorageError) throw error;
    throw storageFailure(error, 'Read backup manifest', target);
  }

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
    if (item.bytes !== undefined && !isIntegerAtLeast(item.bytes, 0)) {
      issues.push(`files[${index}].bytes must be a non-negative integer when present`);
      return;
    }
    files.push({
      kind: item.kind,
      id: item.id,
      path: item.path,
      sha256: item.sha256,
      ...(item.bytes === undefined ? {} : { bytes: item.bytes as number }),
    });
  });

  // Optional metadata written by current builds; absent on legacy v1 manifests.
  let app: BackupManifestApp | undefined;
  if (data.app !== undefined) {
    if (!isRecord(data.app) || typeof data.app.name !== 'string' || data.app.name.length === 0 ||
        typeof data.app.version !== 'string' || data.app.version.length === 0) {
      issues.push('app must contain non-empty string name and version');
    } else {
      app = { name: data.app.name, version: data.app.version };
    }
  }

  let formats: BackupManifestFormats | undefined;
  if (data.formats !== undefined) {
    if (!isRecord(data.formats) ||
        !isIntegerAtLeast(data.formats.note, 1) ||
        !isIntegerAtLeast(data.formats.database, 1) ||
        !isIntegerAtLeast(data.formats.backup, 1)) {
      issues.push('formats must contain positive integers note, database, and backup');
    } else {
      formats = { note: data.formats.note, database: data.formats.database, backup: data.formats.backup };
    }
  }

  let counts: BackupManifestCounts | undefined;
  if (data.counts !== undefined) {
    if (!isRecord(data.counts) ||
        !isIntegerAtLeast(data.counts.notes, 0) ||
        !isIntegerAtLeast(data.counts.databases, 0)) {
      issues.push('counts must contain non-negative integers notes and databases');
    } else {
      counts = { notes: data.counts.notes, databases: data.counts.databases };
      const noteFiles = files.filter((file) => file.kind === 'note').length;
      if (counts.notes !== noteFiles || counts.databases !== files.length - noteFiles) {
        issues.push('counts does not match the number of file entries');
      }
    }
  }

  const digest =
    typeof data.digest === 'string' && /^[0-9a-f]{64}$/.test(data.digest)
      ? data.digest
      : undefined;
  if (data.digest !== undefined && digest === undefined) {
    issues.push('digest must be a lowercase SHA-256 hex digest');
  }

  if (digest !== undefined && issues.length === 0) {
    if (files.some((file) => file.bytes === undefined)) {
      issues.push('digest present but some file entries lack bytes');
    } else {
      const candidate: BackupManifest = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        createdAt: data.createdAt,
        ...(app === undefined ? {} : { app }),
        ...(formats === undefined ? {} : { formats }),
        ...(counts === undefined ? {} : { counts }),
        files,
      };
      if (digestOf(candidate) !== digest) {
        issues.push('digest does not match the canonical manifest serialization');
      }
    }
  }

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
    ...(app === undefined ? {} : { app }),
    ...(formats === undefined ? {} : { formats }),
    ...(counts === undefined ? {} : { counts }),
    files,
    ...(digest === undefined ? {} : { digest }),
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

function sha256(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}

function decodeUtf8(
  bytes: Uint8Array,
  path: string,
  code: 'CORRUPT_BACKUP' | 'INVALID_CONTENT' = 'CORRUPT_BACKUP',
): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new StorageError(code, `File "${path}" is not valid UTF-8`, { path });
  }
}

function corruptBackup(message: string): StorageError {
  return new StorageError('CORRUPT_BACKUP', message, { path: BACKUP_MANIFEST });
}

function restorePathIssue(kind: 'note' | 'database', id: string, path: string): string | undefined {
  if (kind === 'database') {
    return path === databasePath(id) ? undefined : `Database "${id}" must be stored at "${databasePath(id)}"`;
  }
  try {
    validateNotePath(path);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (path.split('/').some((segment) => segment.startsWith('.'))) {
    return `Hidden note path "${path}" is not restorable`;
  }
  if (isReservedNotePath(path)) return `Note path "${path}" is reserved for database definitions`;
  return undefined;
}

async function assertNoSymlinkComponents(root: string, relativePath: string): Promise<void> {
  let current = root;
  for (const segment of relativePath.split('/')) {
    current = join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (isMissing(error)) throw new StorageError('CORRUPT_BACKUP', `Missing path component in "${relativePath}"`, { path: relativePath });
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new StorageError('CORRUPT_BACKUP', `Symbolic link in backup path "${relativePath}"`, { path: relativePath });
    }
    if (current !== join(root, relativePath) && !info.isDirectory()) {
      throw new StorageError('CORRUPT_BACKUP', `Non-directory component in backup path "${relativePath}"`, { path: relativePath });
    }
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntegerAtLeast(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

/** Same folding as the vault adapter: case-insensitive and NFC-normalized. */
function foldPath(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

/**
 * Reads `name` and `version` from package.json for manifest metadata.
 * Returns undefined when the file is missing or malformed, so backups never
 * fail over optional metadata.
 */
async function readAppInfo(): Promise<{ name: string; version: string } | undefined> {
  try {
    const text = await readFile(new URL('../../../package.json', import.meta.url), 'utf8');
    const data: unknown = JSON.parse(text);
    if (isRecord(data) && typeof data.name === 'string' && data.name.length > 0 &&
        typeof data.version === 'string' && data.version.length > 0) {
      return { name: data.name, version: data.version };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Canonical digest serialization, covered by `digestOf`:
 *
 * 1. Keys in fixed order: format, version, createdAt, then app, formats,
 *    counts when present (each rebuilt with its own fixed key order), then
 *    files. The `digest` key itself is never included.
 * 2. Each file entry has keys kind, id, path, sha256, and bytes when present,
 *    in that order; entries keep manifest array order.
 * 3. Serialized with `JSON.stringify` and no whitespace, UTF-8 encoded,
 *    hashed with SHA-256 as lowercase hex.
 */
function canonicalDigestInput(
  manifest: Pick<BackupManifest, 'format' | 'version' | 'createdAt' | 'app' | 'formats' | 'counts' | 'files'>,
): string {
  const payload: Record<string, unknown> = {
    format: manifest.format,
    version: manifest.version,
    createdAt: manifest.createdAt,
  };
  if (manifest.app !== undefined) {
    payload.app = { name: manifest.app.name, version: manifest.app.version };
  }
  if (manifest.formats !== undefined) {
    payload.formats = {
      note: manifest.formats.note,
      database: manifest.formats.database,
      backup: manifest.formats.backup,
    };
  }
  if (manifest.counts !== undefined) {
    payload.counts = { notes: manifest.counts.notes, databases: manifest.counts.databases };
  }
  payload.files = manifest.files.map((file) =>
    file.bytes === undefined
      ? { kind: file.kind, id: file.id, path: file.path, sha256: file.sha256 }
      : { kind: file.kind, id: file.id, path: file.path, sha256: file.sha256, bytes: file.bytes },
  );
  return JSON.stringify(payload);
}

function digestOf(
  manifest: Pick<BackupManifest, 'format' | 'version' | 'createdAt' | 'app' | 'formats' | 'counts' | 'files'>,
): string {
  return sha256(canonicalDigestInput(manifest));
}
