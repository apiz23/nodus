import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DatabaseDefinition } from '../../database/schema.js';
import { DATABASE_FORMAT_VERSION, parseDatabase } from '../../database/schema.js';
import { DATABASE_VIEW_VERSION, parseDatabaseView, type DatabaseView } from '../../database/database-view.js';
import type { Note } from '../../domain/note.js';
import { NOTE_FORMAT_VERSION } from '../../domain/note.js';
import { isUuidV4 } from '../../domain/ids.js';
import { NodusError } from '../../domain/errors.js';
import { PROPERTY_CATALOG_FORMAT, PROPERTY_CATALOG_PATH, PROPERTY_CATALOG_VERSION, parsePropertyCatalog } from '../../properties/catalog.js';
import { parseNote } from '../../format/note-format.js';
import { validateNotePath } from '../../domain/paths.js';
import type {
  BackupManifest,
  BackupManifestApp,
  BackupManifestCounts,
  BackupManifestFile,
  BackupManifestFormats,
  BackupManifestPropertyCatalog,
  BackupOptions,
  BackupReport,
  BackupValidation,
  ImportOptions,
  ImportReport,
  RestorePreview,
  PropertyCatalogFile,
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
  databaseViewPath,
  DATABASE_VIEWS_DIR,
  isReservedNotePath,
} from '../fs/layout.js';
import { isInsideRoot, resolveInsideRoot } from '../fs/safe-path.js';
import { FileSystemVault } from '../fs/vault.js';
import { isManagedAttachmentDirectory, walkVault } from '../fs/scan.js';
import { attachmentPathId, validateAttachmentBytes, ATTACHMENT_MAX_BYTES, ATTACHMENTS_DIR } from '../fs/attachments.js';

/**
 * Creates a recovery snapshot: every note, database definition, and saved view, byte for
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

  const { entries, propertyCatalog } = await vault.snapshotWithPropertyCatalog();
  for (const entry of entries) {
    const issue = restorePathIssue(entry.kind, entry.id, entry.path);
    if (issue !== undefined) {
      throw new StorageError('INVALID_CONTENT', issue, { path: entry.path });
    }
  }
  const backupEntries = entries.map((entry) => {
    const bytes = entry.rawBytes ?? Buffer.from(entry.text, 'utf8');
    if (entry.kind === 'attachment') {
      const attachment = validateAttachmentBytes(entry.path, bytes);
      if (attachment.id !== entry.id) throw new StorageError('INVALID_CONTENT', `Attachment at "${entry.path}" does not match its ID`, { path: entry.path });
      return { entry, bytes };
    }
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
  let databaseViews = 0;
  let attachments = 0;

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
      else if (entry.kind === 'database') databases += 1;
      else if (entry.kind === 'database-view') databaseViews += 1;
      else attachments += 1;
    }

    let catalogMetadata: BackupManifestPropertyCatalog | undefined;
    if (propertyCatalog !== null) {
      const bytes = propertyCatalog.rawBytes;
      if (propertyCatalog.path !== PROPERTY_CATALOG_PATH || propertyCatalog.hash !== sha256(bytes)) {
        throw new StorageError('INVALID_CONTENT', 'Property catalog snapshot failed its integrity check', { path: PROPERTY_CATALOG_PATH });
      }
      await writeFileAtomic(resolveInsideRoot(target, PROPERTY_CATALOG_PATH), bytes);
      catalogMetadata = {
        path: PROPERTY_CATALOG_PATH,
        format: PROPERTY_CATALOG_FORMAT,
        version: propertyCatalog.version,
        properties: propertyCatalog.catalog.properties.length,
        sha256: sha256(bytes),
        bytes: bytes.byteLength,
      };
    }

    const app = await readAppInfo();
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: options.now ?? new Date().toISOString(),
      ...(app === undefined ? {} : { app }),
      formats: { note: NOTE_FORMAT_VERSION, database: Math.max(1, ...entries.filter((entry) => entry.kind === 'database').map((entry) => JSON.parse(entry.text).version as number)), databaseView: DATABASE_VIEW_VERSION, backup: BACKUP_VERSION, propertyCatalog: PROPERTY_CATALOG_VERSION },
      counts: { notes, databases, databaseViews, attachments, propertyCatalog: propertyCatalog === null ? 0 : 1 },
      ...(catalogMetadata === undefined ? {} : { propertyCatalog: catalogMetadata }),
      files,
    };
    manifest.digest = digestOf(manifest);
    await writeFileAtomic(join(target, BACKUP_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    throw storageFailure(error, 'Write backup', targetDir);
  }

  return { targetDir: target, notes, databases, databaseViews, ...(attachments === 0 ? {} : { attachments }), ...(propertyCatalog === null ? {} : { propertyCatalog: 1 }) };
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
  // A v1 manifest cannot account for views. Never restore only a subset when
  // a portable saved-view tree has been copied into an older backup.
  const viewDirectory = (await readdir(target)).find((name) => name.toLowerCase() === DATABASE_VIEWS_DIR);
  if (viewDirectory !== undefined) {
    if (manifest.version === 1) throw corruptBackup('Backup manifest v1 cannot represent the saved-view directory; no restore occurred');
    const info = await lstat(join(target, viewDirectory));
    if (viewDirectory !== DATABASE_VIEWS_DIR || !info.isDirectory() || info.isSymbolicLink()) throw corruptBackup('Saved-view backup directory must be a regular database-views/ directory');
    const walk = await walkVault(target);
    const listed = new Set(manifest.files.filter((file) => file.kind === 'database-view').map((file) => file.path));
    if (walk.issues.some((issue) => issue.path.toLowerCase().startsWith(`${DATABASE_VIEWS_DIR}/`)) || walk.entries.some((entry) => entry.path.startsWith(`${DATABASE_VIEWS_DIR}/`) && (entry.kind !== 'database-view' || !listed.has(entry.path)))) {
      throw corruptBackup('Saved-view backup files are unsafe or missing from the manifest; no restore occurred');
    }
  }
  const attachmentDirectory = (await readdir(target)).find((name) => name.toLowerCase() === ATTACHMENTS_DIR);
  if (attachmentDirectory !== undefined) {
    const attachmentEntries = manifest.files.filter((file) => file.kind === 'attachment');
    // An ordinary user folder named attachments/ (or Attachments/) is allowed
    // by the vault contract on every backup version. Treat it as managed
    // storage only when the manifest carries attachments or every visible
    // child already uses an exact managed file name.
    const info = await lstat(join(target, attachmentDirectory));
    const regularDirectory = info.isDirectory() && !info.isSymbolicLink();
    const hasVisibleChild = regularDirectory &&
      (await readdir(join(target, attachmentDirectory))).some((name) => !name.startsWith('.'));
    const managed = attachmentEntries.length > 0 ||
      (attachmentDirectory === ATTACHMENTS_DIR && hasVisibleChild && await isManagedAttachmentDirectory(join(target, attachmentDirectory)));
    if (managed) {
      if (attachmentDirectory !== ATTACHMENTS_DIR || !regularDirectory) {
        throw corruptBackup('Attachment backup directory must be a regular attachments/ directory');
      }
      if (manifest.version < 3) throw corruptBackup('Legacy backup manifest cannot account for the attachments/ directory; no restore occurred');
      const children = await readdir(join(target, attachmentDirectory), { withFileTypes: true });
      if (children.some((child) => !child.name.startsWith('.') && (child.isSymbolicLink() || !child.isFile() || attachmentPathId(`${ATTACHMENTS_DIR}/${child.name}`) === undefined))) {
        throw corruptBackup('Attachment backup directory contains an unrecognized or unsafe file');
      }
      const walk = await walkVault(target);
      const listed = new Set(attachmentEntries.map((file) => file.path));
      if (walk.issues.some((issue) => issue.path.toLowerCase().startsWith(`${ATTACHMENTS_DIR}/`)) || walk.entries.some((entry) => entry.path.startsWith(`${ATTACHMENTS_DIR}/`) && (entry.kind !== 'attachment' || !listed.has(entry.path)))) {
        throw corruptBackup('Attachment backup files are unsafe or missing from the manifest; no restore occurred');
      }
    }
  }
  const issues: string[] = [];
  const entries: VaultEntry[] = [];
  const notes: Note[] = [];
  const databases: DatabaseDefinition[] = [];
  const databaseViews: DatabaseView[] = [];
  let propertyCatalog: PropertyCatalogFile | undefined;

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
  const catalogResult = await validateBackupPropertyCatalog(target, manifest);
  propertyCatalog = catalogResult.file;
  issues.push(...catalogResult.issues);
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
    if (file.kind === 'attachment' && info.size > ATTACHMENT_MAX_BYTES) {
      issues.push(`Attachment "${file.path}" exceeds the 10 MiB limit`);
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

    if (file.kind === 'attachment') {
      try {
        const attachment = validateAttachmentBytes(file.path, bytes);
        if (attachment.id !== file.id) { issues.push(`Attachment at "${file.path}" does not match manifest ID`); continue; }
      } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); continue; }
      entries.push({ kind: 'attachment', id: file.id, path: file.path, text: '', rawBytes: Buffer.from(bytes) });
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
    } else if (file.kind === 'database') {
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
    } else {
      const pathIds = viewPathFromManifest(file.path);
      if (pathIds === undefined || pathIds.path !== file.path || pathIds.viewId !== file.id) {
        issues.push(`Saved view at "${file.path}" does not match its path and manifest ID`);
        continue;
      }
      try {
        const view = parseDatabaseView(text);
        if (view.id !== file.id || view.databaseId !== pathIds.databaseId) {
          issues.push(`Saved view at "${file.path}" does not match manifest path and ID`);
          continue;
        }
        databaseViews.push(view);
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

  return { manifest, entries, notes, databases, databaseViews, ...(propertyCatalog === undefined ? {} : { propertyCatalog }) };
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
      databaseViews: validation.databaseViews,
      ...(validation.propertyCatalog === undefined ? {} : { propertyCatalog: validation.propertyCatalog }),
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
  const targetCatalog = await vault.readPropertyCatalogWithHash();
  const catalogConflict = validation.propertyCatalog === undefined
    ? false
    : targetCatalog.hash === null
      ? await propertiesDirectoryHasEntries(vault.root)
      : targetCatalog.hash !== validation.propertyCatalog.hash;

  const noteIds = new Set<string>();
  const databaseIds = new Set<string>();
  const viewIds = new Set<string>();
  const notePaths = new Set<string>();
  const viewPaths = new Set<string>();
  const attachmentIds = new Set<string>();
  const attachmentPaths = new Set<string>();
  for (const entry of existing) {
    if (entry.kind === 'note') {
      noteIds.add(entry.id);
      notePaths.add(foldPath(entry.path));
    } else if (entry.kind === 'database') {
      databaseIds.add(entry.id);
    } else if (entry.kind === 'database-view') {
      viewIds.add(entry.id);
      viewPaths.add(foldPath(entry.path));
    } else {
      attachmentIds.add(entry.id);
      attachmentPaths.add(foldPath(entry.path));
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
  for (const view of validation.databaseViews) {
    const path = databaseViewPath(view.databaseId, view.id);
    if (viewIds.has(view.id)) ids.add(view.id);
    if (viewPaths.has(foldPath(path))) paths.add(path);
  }
  for (const entry of validation.entries) if (entry.kind === 'attachment') {
    if (attachmentIds.has(entry.id)) ids.add(entry.id);
    if (attachmentPaths.has(foldPath(entry.path))) paths.add(entry.path);
  }
  if (catalogConflict) paths.add(PROPERTY_CATALOG_PATH);

  return {
    manifest: validation.manifest,
    counts: { notes: validation.notes.length, databases: validation.databases.length, databaseViews: validation.databaseViews.length,
      ...(validation.entries.some((entry) => entry.kind === 'attachment') ? { attachments: validation.entries.filter((entry) => entry.kind === 'attachment').length } : {}),
      ...(validation.propertyCatalog === undefined ? {} : { propertyCatalog: 1 }) },
    ...(validation.propertyCatalog === undefined ? {} : { propertyCatalog: {
      path: PROPERTY_CATALOG_PATH,
      version: validation.propertyCatalog.version,
      properties: validation.propertyCatalog.catalog.properties.length,
      hash: validation.propertyCatalog.hash,
      conflict: catalogConflict,
    } }),
    conflicts: { ids: [...ids].sort(), paths: [...paths].sort() },
  };
}

async function propertiesDirectoryHasEntries(root: string): Promise<boolean> {
  try {
    return (await readdir(join(root, 'properties'))).length > 0;
  } catch (error) {
    if (isMissing(error)) return false;
    if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') return true;
    throw storageFailure(error, 'Inspect property catalog directory', PROPERTY_CATALOG_PATH);
  }
}

async function validateBackupPropertyCatalog(
  target: string,
  manifest: BackupManifest,
): Promise<{ file?: PropertyCatalogFile; issues: string[] }> {
  const issues: string[] = [];
  const metadata = manifest.propertyCatalog;
  const propertiesDirectory = join(target, 'properties');
  let directoryInfo;
  try {
    directoryInfo = await lstat(propertiesDirectory);
  } catch (error) {
    if (isMissing(error)) {
      if (metadata !== undefined) issues.push(`Missing property catalog "${PROPERTY_CATALOG_PATH}"`);
      return { issues };
    }
    throw storageFailure(error, 'Inspect property catalog directory', PROPERTY_CATALOG_PATH);
  }
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
    if (metadata !== undefined) issues.push('Property catalog parent must be a regular properties/ directory');
    return { issues };
  }

  const catalogPath = join(target, PROPERTY_CATALOG_PATH);
  let catalogInfo;
  try {
    catalogInfo = await lstat(catalogPath);
  } catch (error) {
    if (isMissing(error)) {
      if (metadata !== undefined) issues.push(`Missing property catalog "${PROPERTY_CATALOG_PATH}"`);
      return { issues };
    }
    throw storageFailure(error, 'Read property catalog', PROPERTY_CATALOG_PATH);
  }
  if (catalogInfo.isSymbolicLink() || !catalogInfo.isFile()) {
    issues.push('Property catalog must be a regular file');
    return { issues };
  }
  if (metadata === undefined) {
    issues.push(`Property catalog "${PROPERTY_CATALOG_PATH}" is present but not recorded in the manifest`);
    return { issues };
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(catalogPath);
  } catch (error) {
    if (isMissing(error)) {
      issues.push(`Missing property catalog "${PROPERTY_CATALOG_PATH}"`);
      return { issues };
    }
    throw storageFailure(error, 'Read property catalog', PROPERTY_CATALOG_PATH);
  }
  if (bytes.byteLength !== metadata.bytes) issues.push('Property catalog byte length does not match the manifest');
  if (sha256(bytes) !== metadata.sha256) issues.push('Property catalog hash does not match the manifest');

  let text: string;
  let catalog;
  let version: number;
  try {
    text = decodeUtf8(bytes, PROPERTY_CATALOG_PATH);
    catalog = parsePropertyCatalog(text);
    version = catalogVersionFromText(text);
  } catch (error) {
    const unsupported = unsupportedError(error, PROPERTY_CATALOG_PATH);
    if (unsupported !== undefined) throw unsupported;
    issues.push(`${PROPERTY_CATALOG_PATH}: ${error instanceof Error ? error.message : String(error)}`);
    return { issues };
  }
  if (metadata.path !== PROPERTY_CATALOG_PATH) issues.push('Property catalog manifest path must be properties/catalog.json');
  if (metadata.format !== PROPERTY_CATALOG_FORMAT) issues.push('Property catalog format does not match the manifest');
  if (metadata.version !== version) issues.push('Property catalog version does not match the manifest');
  if (metadata.properties !== catalog.properties.length) issues.push('Property catalog definition count does not match the manifest');
  if (issues.length > 0) return { issues };
  return {
    file: {
      path: PROPERTY_CATALOG_PATH,
      text,
      rawBytes: Buffer.from(bytes),
      hash: metadata.sha256,
      version,
      catalog,
    },
    issues,
  };
}

function catalogVersionFromText(text: string): number {
  const parsed = JSON.parse(text) as { version?: unknown };
  return typeof parsed.version === 'number' ? parsed.version : 0;
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
  if (version >= 2) rejectUnknownKeys(data, ['format', 'version', 'createdAt', 'app', 'formats', 'counts', ...(version >= 4 ? ['propertyCatalog'] : []), 'files', 'digest'], 'manifest', issues);
  const files: BackupManifestFile[] = [];

  data.files.forEach((item: unknown, index: number) => {
    if (!isRecord(item)) {
      issues.push(`files[${index}] is not an object`);
      return;
    }
    if (item.kind !== 'note' && item.kind !== 'database' && !(version >= 2 && item.kind === 'database-view') && !(version >= 3 && item.kind === 'attachment')) {
      issues.push(`files[${index}].kind is not supported by backup version ${version}`);
      return;
    }
    if (version >= 2) rejectUnknownKeys(item, ['kind', 'id', 'path', 'sha256', 'bytes'], `files[${index}]`, issues);
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
    if (version >= 2 && isRecord(data.app)) rejectUnknownKeys(data.app, ['name', 'version'], 'app', issues);
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
        !isIntegerAtLeast(data.formats.backup, 1) ||
        (version >= 2 && !isIntegerAtLeast(data.formats.databaseView, 1)) ||
        (version >= 4 && !isIntegerAtLeast(data.formats.propertyCatalog, 1))) {
      issues.push('formats must contain positive integers note, database, backup, databaseView for v2+, and propertyCatalog for v4+');
    } else {
      if (version >= 2) rejectUnknownKeys(data.formats, ['note', 'database', 'databaseView', ...(version >= 4 ? ['propertyCatalog'] : []), 'backup'], 'formats', issues);
      formats = { note: data.formats.note, database: data.formats.database, backup: data.formats.backup, ...(version >= 2 ? { databaseView: data.formats.databaseView as number } : {}), ...(version >= 4 ? { propertyCatalog: data.formats.propertyCatalog as number } : {}) };
    }
  }

  let counts: BackupManifestCounts | undefined;
  if (data.counts !== undefined) {
    if (!isRecord(data.counts) ||
        !isIntegerAtLeast(data.counts.notes, 0) ||
        !isIntegerAtLeast(data.counts.databases, 0) ||
        (version >= 2 && !isIntegerAtLeast(data.counts.databaseViews, 0)) ||
        (version >= 3 && !isIntegerAtLeast(data.counts.attachments, 0)) ||
        (version >= 4 && !isIntegerAtLeast(data.counts.propertyCatalog, 0))) {
      issues.push('counts must contain non-negative integers notes, databases, databaseViews for v2+, attachments for v3+, and propertyCatalog for v4+');
    } else {
      if (version >= 2) rejectUnknownKeys(data.counts, ['notes', 'databases', 'databaseViews', ...(version >= 3 ? ['attachments'] : []), ...(version >= 4 ? ['propertyCatalog'] : [])], 'counts', issues);
      counts = { notes: data.counts.notes, databases: data.counts.databases, ...(version >= 2 ? { databaseViews: data.counts.databaseViews as number } : {}), ...(version >= 3 ? { attachments: data.counts.attachments as number } : {}), ...(version >= 4 ? { propertyCatalog: data.counts.propertyCatalog as number } : {}) };
      const noteFiles = files.filter((file) => file.kind === 'note').length;
      const databaseFiles = files.filter((file) => file.kind === 'database').length;
      const viewFiles = files.filter((file) => file.kind === 'database-view').length;
      const attachmentFiles = files.filter((file) => file.kind === 'attachment').length;
      if (counts.notes !== noteFiles || counts.databases !== databaseFiles || (version >= 2 && counts.databaseViews !== viewFiles) || (version >= 3 && counts.attachments !== attachmentFiles)) {
        issues.push('counts does not match the number of file entries');
      }
    }
  }

  let propertyCatalog: BackupManifestPropertyCatalog | undefined;
  if (data.propertyCatalog !== undefined) {
    if (version < 4) {
      issues.push('propertyCatalog is not supported before backup version 4');
    } else if (!isRecord(data.propertyCatalog)) {
      issues.push('propertyCatalog must be an object');
    } else {
      rejectUnknownKeys(data.propertyCatalog, ['path', 'format', 'version', 'properties', 'sha256', 'bytes'], 'propertyCatalog', issues);
      if (data.propertyCatalog.path !== PROPERTY_CATALOG_PATH) issues.push(`propertyCatalog.path must be "${PROPERTY_CATALOG_PATH}"`);
      if (data.propertyCatalog.format !== PROPERTY_CATALOG_FORMAT) issues.push(`propertyCatalog.format must be "${PROPERTY_CATALOG_FORMAT}"`);
      if (!isIntegerAtLeast(data.propertyCatalog.version, 1)) issues.push('propertyCatalog.version must be a positive integer');
      if (!isIntegerAtLeast(data.propertyCatalog.properties, 0)) issues.push('propertyCatalog.properties must be a non-negative integer');
      if (typeof data.propertyCatalog.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(data.propertyCatalog.sha256)) issues.push('propertyCatalog.sha256 must be a lowercase SHA-256 hex digest');
      if (!isIntegerAtLeast(data.propertyCatalog.bytes, 0)) issues.push('propertyCatalog.bytes must be a non-negative integer');
      if (isIntegerAtLeast(data.propertyCatalog.version, 1)) {
        if (data.propertyCatalog.version > PROPERTY_CATALOG_VERSION) {
          throw new StorageError('UNSUPPORTED_VERSION', `Property catalog version ${data.propertyCatalog.version} is newer than supported version ${PROPERTY_CATALOG_VERSION}`, { path: BACKUP_MANIFEST });
        }
        propertyCatalog = {
          path: data.propertyCatalog.path as string,
          format: data.propertyCatalog.format as 'nodus-property-catalog',
          version: data.propertyCatalog.version,
          properties: data.propertyCatalog.properties as number,
          sha256: data.propertyCatalog.sha256 as string,
          bytes: data.propertyCatalog.bytes as number,
        };
      }
    }
  }
  if (version >= 4 && counts !== undefined) {
    const expectedCatalogCount = propertyCatalog === undefined ? 0 : 1;
    if (counts.propertyCatalog !== expectedCatalogCount) issues.push('counts.propertyCatalog does not match the catalog metadata');
  }

  const digest =
    typeof data.digest === 'string' && /^[0-9a-f]{64}$/.test(data.digest)
      ? data.digest
      : undefined;
  if (data.digest !== undefined && digest === undefined) {
    issues.push('digest must be a lowercase SHA-256 hex digest');
  }
  if (version >= 2 && (formats === undefined || counts === undefined)) issues.push('v2+ manifests require formats and counts');
  if (version >= 3 && counts?.attachments === undefined) issues.push('v3 manifests require attachment counts');
  if (version >= 4 && counts?.propertyCatalog === undefined) issues.push('v4 manifests require property catalog counts');
  if (version >= 2 && files.some((file) => file.bytes === undefined)) issues.push('v2+ manifest file entries require byte lengths');
  if (version >= 2 && digest === undefined) issues.push('v2+ manifests require a digest');
  if (version >= 2 && formats?.databaseView !== undefined && formats.databaseView > DATABASE_VIEW_VERSION) {
    if (formats.databaseView > DATABASE_VIEW_VERSION) throw new StorageError('UNSUPPORTED_VERSION', `Database view format version ${formats.databaseView} is newer than supported version ${DATABASE_VIEW_VERSION}`, { path: BACKUP_MANIFEST });
  }
  if (formats?.propertyCatalog !== undefined && formats.propertyCatalog > PROPERTY_CATALOG_VERSION) {
    throw new StorageError('UNSUPPORTED_VERSION', `Property catalog format version ${formats.propertyCatalog} is newer than supported version ${PROPERTY_CATALOG_VERSION}`, { path: BACKUP_MANIFEST });
  }
  if (formats && formats.database > DATABASE_FORMAT_VERSION) throw new StorageError('UNSUPPORTED_VERSION', 'Backup requires a newer database format', { path: BACKUP_MANIFEST });
  if (version >= 2 && formats?.backup !== version) issues.push(`formats.backup must match manifest version ${version}`);

  if (digest !== undefined && issues.length === 0) {
    if (files.some((file) => file.bytes === undefined)) {
      issues.push('digest present but some file entries lack bytes');
    } else {
      const candidate: BackupManifest = {
        format: BACKUP_FORMAT,
        version: version as 1 | 2 | 3 | 4,
        createdAt: data.createdAt,
        ...(app === undefined ? {} : { app }),
        ...(formats === undefined ? {} : { formats }),
        ...(counts === undefined ? {} : { counts }),
        ...(propertyCatalog === undefined ? {} : { propertyCatalog }),
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
    version: version as 1 | 2 | 3 | 4,
    createdAt: data.createdAt,
    ...(app === undefined ? {} : { app }),
    ...(formats === undefined ? {} : { formats }),
    ...(counts === undefined ? {} : { counts }),
    ...(propertyCatalog === undefined ? {} : { propertyCatalog }),
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
    // Preserve a valid BOM in the text passed to restore; hashes still cover raw bytes.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new StorageError(code, `File "${path}" is not valid UTF-8`, { path });
  }
}

function corruptBackup(message: string): StorageError {
  return new StorageError('CORRUPT_BACKUP', message, { path: BACKUP_MANIFEST });
}

function restorePathIssue(kind: 'note' | 'database' | 'database-view' | 'attachment', id: string, path: string): string | undefined {
  if (kind === 'attachment') return attachmentPathId(path) === id ? undefined : `Attachment path "${path}" must be managed under attachments/ and match its ID`;
  if (kind === 'database-view') {
    const ids = viewPathFromManifest(path);
    return ids !== undefined && ids.path === path && ids.viewId === id
      ? undefined
      : `Saved view path "${path}" must be database-views/<database-id>/<view-id>.json and match its ID`;
  }
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
  if (isReservedNotePath(path.toLowerCase())) return `Note path "${path}" is reserved for Nodus database metadata`;
  return undefined;
}

function viewPathFromManifest(path: string): { databaseId: string; viewId: string; path: string } | undefined {
  const match = /^database-views\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/.exec(path);
  if (!match) return undefined;
  const databaseId = match[1]!; const viewId = match[2]!;
  return { databaseId, viewId, path: databaseViewPath(databaseId, viewId) };
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

function rejectUnknownKeys(value: Record<string, unknown>, allowed: string[], where: string, issues: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(`Unknown key "${key}" in ${where}`);
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
 *    counts, propertyCatalog when present (each rebuilt with its own fixed key
 *    order), then files. The `digest` key itself is never included.
 * 2. Each file entry has keys kind, id, path, sha256, and bytes when present,
 *    in that order; entries keep manifest array order.
 * 3. Serialized with `JSON.stringify` and no whitespace, UTF-8 encoded,
 *    hashed with SHA-256 as lowercase hex.
 */
function canonicalDigestInput(
  manifest: Pick<BackupManifest, 'format' | 'version' | 'createdAt' | 'app' | 'formats' | 'counts' | 'propertyCatalog' | 'files'>,
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
      ...(manifest.formats.databaseView === undefined ? {} : { databaseView: manifest.formats.databaseView }),
      ...(manifest.formats.propertyCatalog === undefined ? {} : { propertyCatalog: manifest.formats.propertyCatalog }),
      backup: manifest.formats.backup,
    };
  }
  if (manifest.counts !== undefined) {
    payload.counts = {
      notes: manifest.counts.notes,
      databases: manifest.counts.databases,
      ...(manifest.counts.databaseViews === undefined ? {} : { databaseViews: manifest.counts.databaseViews }),
      ...(manifest.counts.attachments === undefined ? {} : { attachments: manifest.counts.attachments }),
      ...(manifest.counts.propertyCatalog === undefined ? {} : { propertyCatalog: manifest.counts.propertyCatalog }),
    };
  }
  if (manifest.propertyCatalog !== undefined) {
    payload.propertyCatalog = {
      path: manifest.propertyCatalog.path,
      format: manifest.propertyCatalog.format,
      version: manifest.propertyCatalog.version,
      properties: manifest.propertyCatalog.properties,
      sha256: manifest.propertyCatalog.sha256,
      bytes: manifest.propertyCatalog.bytes,
    };
  }
  payload.files = manifest.files.map((file) =>
    file.bytes === undefined
      ? { kind: file.kind, id: file.id, path: file.path, sha256: file.sha256 }
      : { kind: file.kind, id: file.id, path: file.path, sha256: file.sha256, bytes: file.bytes },
  );
  return JSON.stringify(payload);
}

function digestOf(
  manifest: Pick<BackupManifest, 'format' | 'version' | 'createdAt' | 'app' | 'formats' | 'counts' | 'propertyCatalog' | 'files'>,
): string {
  return sha256(canonicalDigestInput(manifest));
}
