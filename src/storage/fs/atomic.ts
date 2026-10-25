import { randomUUID } from 'node:crypto';
import { open, mkdir, rename, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { TEMP_PREFIX } from './layout.js';

/**
 * Writes a file through a temporary sibling and an atomic rename.
 *
 * Guarantees: readers never observe a half-written target; the temporary file is
 * removed on failure. Not guaranteed: durability of the rename itself, or a
 * vault-wide transaction across several files.
 */
export async function writeFileAtomic(target: string, text: string): Promise<void> {
  const directory = dirname(target);
  await mkdir(directory, { recursive: true });

  const temporary = join(directory, `${TEMP_PREFIX}${randomUUID()}`);
  let handle: FileHandle | undefined;

  try {
    handle = await open(temporary, 'wx');
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    await syncDirectory(directory);
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Best-effort directory metadata flush. Unsupported on Windows; ignored. */
async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch {
    // Some filesystems reject directory fsync. The rename already happened.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
