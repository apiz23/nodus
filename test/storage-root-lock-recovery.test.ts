import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { StorageError } from '../src/storage/errors.js';
import { VAULT_PROCESS_LOCK_FILE, withVaultRootLock } from '../src/storage/fs/root-lock.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { withTempDir } from './tmp.js';

// Keep fault injection local to this test module, including its subprocesses.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open), unlink: vi.fn(actual.unlink) };
});
const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const CHILD_MODE = process.env.NODUS_LOCK_RECOVERY_MODE;
const ID = '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';
const NOW = '2026-10-25T09:00:00Z';

beforeEach(() => {
  vi.mocked(fs.open).mockReset().mockImplementation(realFs.open);
  vi.mocked(fs.unlink).mockReset().mockImplementation(realFs.unlink);
});
afterEach(() => vi.restoreAllMocks());

if (CHILD_MODE) {
  it('runs the isolated recovery subprocess', async () => {
    const root = process.env.NODUS_LOCK_RECOVERY_ROOT;
    const marker = process.env.NODUS_LOCK_RECOVERY_MARKER;
    if (!root || !marker) throw new Error('Missing recovery subprocess configuration');
    if (CHILD_MODE === 'contend') {
      await expect(withVaultRootLock(root, async () => {
        throw new Error('An abandoned lock must not be reclaimed');
      })).rejects.toMatchObject({ code: 'CONFLICT' });
      await fs.writeFile(marker, 'conflict');
      return;
    }

    const vault = await FileSystemVault.open(root);
    const current = await vault.readNoteWithHash(ID);
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      const handle = await realFs.open(path, flags, mode);
      if (basename(String(path)).startsWith('.nodus-tmp-')) {
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          // The actual atomic writer has written its sibling file, but has
          // not flushed or renamed it. Parent waits for this explicit barrier.
          await fs.writeFile(marker, 'ready');
          await new Promise<void>(() => {});
        });
      }
      return handle;
    });
    await vault.replaceNote({ ...current.note, body: 'Interrupted edit\n' }, { expectedHash: current.hash });
  }, 30_000);
}

describe.skipIf(Boolean(CHILD_MODE))('vault lock recovery failures', () => {
  it.each(['', '{', JSON.stringify({
    version: 1, pid: process.pid, host: hostname(), acquiredAt: '2000-01-01T00:00:00Z', token: 'live-owner',
  })])('never reclaims an existing lock, regardless of age or metadata: %j', async (contents) => {
    await withTempDir(async (root) => {
      const lock = join(root, VAULT_PROCESS_LOCK_FILE);
      await fs.writeFile(lock, contents);
      const operation = vi.fn();
      await expect(withVaultRootLock(root, operation)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(operation).not.toHaveBeenCalled();
      expect(await fs.readFile(lock, 'utf8')).toBe(contents);
    });
  });

  it.each(['writeFile', 'sync'] as const)('leaves failed initialization in place after %s fails', async (step) => {
    await withTempDir(async (root) => {
      const operation = vi.fn();
      vi.mocked(fs.open).mockImplementationOnce(async (path, flags, mode) => {
        const handle = await realFs.open(path, flags, mode);
        vi.spyOn(handle, step).mockRejectedValueOnce(new Error('injected initialization failure'));
        return handle;
      });
      await expect(withVaultRootLock(root, operation)).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
      expect(operation).not.toHaveBeenCalled();
      await expect(fs.lstat(join(root, VAULT_PROCESS_LOCK_FILE))).resolves.toBeDefined();
      await expect(withVaultRootLock(root, operation)).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('does not unlink a replacement lock after initialization fails', async () => {
    await withTempDir(async (root) => {
      const lock = join(root, VAULT_PROCESS_LOCK_FILE);
      vi.mocked(fs.open).mockImplementationOnce(async (path, flags, mode) => {
        const handle = await realFs.open(path, flags, mode);
        vi.spyOn(handle, 'sync').mockImplementationOnce(async () => {
          await fs.rm(lock);
          await fs.writeFile(lock, 'another owner');
          throw new Error('injected sync failure after replacement');
        });
        return handle;
      });
      await expect(withVaultRootLock(root, async () => {})).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
      expect(await fs.readFile(lock, 'utf8')).toBe('another owner');
    });
  });

  it('rejects replacement identity even if owner metadata was copied exactly', async () => {
    await withTempDir(async (root) => {
      const lock = join(root, VAULT_PROCESS_LOCK_FILE);
      let replacement = '';
      await expect(withVaultRootLock(root, async () => {
        replacement = await fs.readFile(lock, 'utf8');
        await fs.rm(lock);
        await fs.writeFile(lock, replacement);
      })).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
      expect(await fs.readFile(lock, 'utf8')).toBe(replacement);
    });
  });

  it.each(['', '{', '{"token":"different-owner"}'])('preserves changed or malformed owner metadata: %j', async (contents) => {
    await withTempDir(async (root) => {
      const lock = join(root, VAULT_PROCESS_LOCK_FILE);
      await expect(withVaultRootLock(root, () => fs.writeFile(lock, contents))).rejects.toMatchObject({
        code: 'STORAGE_FAILURE',
      });
      expect(await fs.readFile(lock, 'utf8')).toBe(contents);
    });
  });

  it.skipIf(process.platform === 'win32')('does not release a symlink replacement', async () => {
    await withTempDir(async (root) => {
      const lock = join(root, VAULT_PROCESS_LOCK_FILE);
      const target = join(root, 'other-owner');
      await expect(withVaultRootLock(root, async () => {
        await fs.writeFile(target, await fs.readFile(lock));
        await fs.rm(lock);
        await fs.symlink(target, lock);
      })).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
      expect((await fs.lstat(lock)).isSymbolicLink()).toBe(true);
      await expect(fs.readFile(target)).resolves.toBeDefined();
    });
  });

  it('does not start a vault operation if exclusive creation is denied', async () => {
    await withTempDir(async (root) => {
      const operation = vi.fn();
      vi.mocked(fs.open).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
      await expect(withVaultRootLock(root, operation)).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
      expect(operation).not.toHaveBeenCalled();
      await expect(fs.lstat(join(root, VAULT_PROCESS_LOCK_FILE))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('reports cleanup failure after a completed write and blocks a new writer', async () => {
    await withTempDir(async (root) => {
      const note = join(root, 'note.md');
      vi.mocked(fs.unlink).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
      await expect(withVaultRootLock(root, () => fs.writeFile(note, 'Saved\n'))).rejects.toMatchObject({
        code: 'STORAGE_FAILURE', message: expect.stringContaining('may have completed'),
      });
      expect(await fs.readFile(note, 'utf8')).toBe('Saved\n');
      await expect(withVaultRootLock(root, async () => {})).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('preserves partial-write paths and both causes when release also fails', async () => {
    await withTempDir(async (root) => {
      const original = new StorageError('PARTIAL_WRITE', 'Import stopped after a write', {
        details: { paths: ['first.md', 'failed.md'], ids: [ID] },
      });
      const cleanupError = new Error('injected unlink failure');
      vi.mocked(fs.unlink).mockRejectedValueOnce(cleanupError);
      const failure = await withVaultRootLock(root, async () => {
        await fs.writeFile(join(root, 'first.md'), 'Written\n');
        throw original;
      }).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code: 'PARTIAL_WRITE',
        details: { paths: ['first.md', 'failed.md', VAULT_PROCESS_LOCK_FILE], ids: [ID] },
        cause: expect.any(AggregateError),
      });
      expect((failure as Error).message).toContain(original.message);
      expect(((failure as Error).cause as AggregateError).errors).toContain(original);
      expect(await fs.readFile(join(root, 'first.md'), 'utf8')).toBe('Written\n');
    });
  });

  it('surfaces a close failure without reporting the operation as successful', async () => {
    await withTempDir(async (root) => {
      let close: (() => Promise<void>) | undefined;
      vi.mocked(fs.open).mockImplementationOnce(async (path, flags, mode) => {
        const handle = await realFs.open(path, flags, mode);
        close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockRejectedValueOnce(new Error('injected close failure'));
        return handle;
      });
      try {
        await expect(withVaultRootLock(root, async () => 'completed')).rejects.toMatchObject({
          code: 'STORAGE_FAILURE', message: expect.stringContaining('may have completed'),
        });
      } finally {
        await close?.();
      }
    });
  });

  it.skipIf(process.platform === 'win32')('fails closed after SIGKILL during an atomic write, including two new contender processes', async () => {
    await withTempDir(async (directory) => {
      const root = join(directory, 'vault');
      const vault = await FileSystemVault.open(root);
      await vault.createNote(createNote({ id: ID, path: 'note.md', title: 'Recovery', body: 'Initial\n', now: NOW }));
      const initial = await fs.readFile(join(root, 'note.md'));
      const marker = join(directory, 'ready');
      const owner = spawnChild('crash', root, marker);
      const workers = [owner];
      try {
        await waitForMarker(marker);
        owner.child.kill('SIGKILL');
        expect((await owner.done).signal).toBe('SIGKILL');
        const lock = join(root, VAULT_PROCESS_LOCK_FILE);
        const abandoned = await fs.readFile(lock);
        expect(await fs.readFile(join(root, 'note.md'))).toEqual(initial);
        expect((await vault.readNote(ID)).body).toBe('Initial\n');
        expect((await vault.checkHealth()).issues).toEqual(expect.arrayContaining([
          expect.objectContaining({ code: 'INCOMPLETE_WRITE' }),
        ]));
        await expect(vault.snapshot()).rejects.toMatchObject({ code: 'CONFLICT' });

        const contenders = [0, 1].map((index) => spawnChild('contend', root, join(directory, `contender-${index}`)));
        workers.push(...contenders);
        expect((await Promise.all(contenders.map(({ done }) => done))).map(({ code }) => code)).toEqual([0, 0]);
        expect(await fs.readFile(lock)).toEqual(abandoned);
        expect(await fs.readFile(join(root, 'note.md'))).toEqual(initial);

        // Every child has exited. This test owns the temporary vault, so it can
        // explicitly remove its abandoned lock and validate the repair path.
        await fs.rm(lock);
        const current = await vault.readNoteWithHash(ID);
        await vault.replaceNote({ ...current.note, body: 'Recovered\n' }, { expectedHash: current.hash });
        expect((await vault.readNote(ID)).body).toBe('Recovered\n');
        await expect(fs.lstat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        for (const { child } of workers) {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }
        await Promise.allSettled(workers.map(({ done }) => done));
      }
    });
  }, 45_000);
});

function spawnChild(mode: string, root: string, marker: string) {
  const cli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
  const child = spawn(process.execPath, [cli, 'run', fileURLToPath(import.meta.url), '--pool=threads', '--maxWorkers=1'], {
    env: { ...process.env, NODUS_LOCK_RECOVERY_MODE: mode, NODUS_LOCK_RECOVERY_ROOT: root, NODUS_LOCK_RECOVERY_MARKER: marker },
    stdio: 'ignore',
  });
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, done };
}

async function waitForMarker(path: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await fs.access(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (Date.now() >= deadline) throw new Error('Recovery child did not reach the write barrier');
    await delay(10);
  }
}
