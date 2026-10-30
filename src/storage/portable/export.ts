import { mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ExportReport, VaultStorage } from '../contracts.js';
import { StorageError, storageFailure } from '../errors.js';
import { writeFileAtomic } from '../fs/atomic.js';
import { resolveInsideRoot, isInsideRoot } from '../fs/safe-path.js';

/**
 * Writes a portable copy of a vault: notes at their relative paths and database
 * definitions under `databases/`. The result is itself a valid vault, with no
 * proprietary wrapper format.
 *
 * The target must be empty and outside the vault, so export never overwrites
 * user data. Each file is written atomically; a failure part-way through leaves
 * a valid subset, not a complete export.
 */
export async function exportVault(vault: VaultStorage, targetDir: string): Promise<ExportReport> {
  const target = resolve(targetDir);
  if (await isInsideRoot(vault.root, target)) {
    throw new StorageError('INVALID_INPUT', 'Export target must be outside the vault', {
      path: targetDir,
    });
  }

  const entries = await vault.snapshot();

  try {
    await mkdir(target, { recursive: true });
  } catch (error) {
    throw storageFailure(error, 'Create export directory', targetDir);
  }

  const existing = await readdir(target).catch((error: unknown) => {
    throw storageFailure(error, 'Read export directory', targetDir);
  });
  if (existing.length > 0) {
    throw new StorageError('CONFLICT', `Export target "${targetDir}" is not empty; refusing to overwrite`, {
      path: targetDir,
      details: { paths: [targetDir] },
    });
  }

  let notes = 0;
  let databases = 0;
  let databaseViews = 0;
  let attachments = 0;

  try {
    for (const entry of entries) {
      await writeFileAtomic(resolveInsideRoot(target, entry.path), entry.rawBytes ?? entry.text);
      if (entry.kind === 'note') notes += 1;
      else if (entry.kind === 'database') databases += 1;
      else if (entry.kind === 'database-view') databaseViews += 1;
      else attachments += 1;
    }
  } catch (error) {
    throw storageFailure(error, 'Write export', targetDir);
  }

  return { targetDir: target, notes, databases, databaseViews, ...(attachments === 0 ? {} : { attachments }) };
}
