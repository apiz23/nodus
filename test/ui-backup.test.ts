import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StorageError } from '../src/storage/errors.js';
import { assertBackupTargetAllowed, storageErrorBody, storageStatus } from '../src/ui-server/api.js';
import { withTempDir } from './tmp.js';

interface CapturedFailure {
  status?: number;
  code?: string;
  message?: string;
}

async function apiFailure(promise: Promise<unknown>): Promise<CapturedFailure> {
  try {
    await promise;
    return {};
  } catch (error) {
    const failure = error as CapturedFailure;
    return { status: failure.status, code: failure.code, message: failure.message };
  }
}

/** Creates a symlink, or returns false when the OS denies it (Windows). */
async function trySymlink(target: string, link: string, type: 'dir' | 'file'): Promise<boolean> {
  try {
    await symlink(target, link, type);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw error;
  }
}

describe('assertBackupTargetAllowed', () => {
  it('accepts a nonexistent target in the default root (parent of the vault)', async () => {
    await withTempDir(async (dir) => {
      const vault = join(dir, 'vault');
      await mkdir(vault);
      const target = join(dir, 'backup-new');

      expect(await assertBackupTargetAllowed(target, vault)).toBe(resolve(target));
    });
  });

  it('accepts an existing directory in the default root', async () => {
    await withTempDir(async (dir) => {
      const vault = join(dir, 'vault');
      await mkdir(vault);
      const target = join(dir, 'backup-existing');
      await mkdir(target);

      expect(await assertBackupTargetAllowed(target, vault)).toBe(resolve(target));
    });
  });

  it('rejects a relative path', async () => {
    await withTempDir(async (dir) => {
      const vault = join(dir, 'vault');
      await mkdir(vault);

      const failure = await apiFailure(assertBackupTargetAllowed('backup/new', vault));
      expect(failure.status).toBe(400);
      expect(failure.code).toBe('INVALID_INPUT');
      expect(failure.message).toContain('absolute');
    });
  });

  it('rejects a destination inside the active vault', async () => {
    await withTempDir(async (dir) => {
      const vault = join(dir, 'vault');
      await mkdir(vault);

      const failure = await apiFailure(assertBackupTargetAllowed(join(vault, 'backup'), vault));
      expect(failure.status).toBe(400);
      expect(failure.code).toBe('INVALID_INPUT');
      expect(failure.message).toContain('outside the vault');
    });
  });

  it('rejects a destination outside all allowed roots by default', async () => {
    await withTempDir(async (dir) => {
      const vault = join(dir, 'vault');
      await mkdir(vault);
      const outside = await mkdtemp(join(tmpdir(), 'nodus-backup-outside-'));
      try {
        const failure = await apiFailure(assertBackupTargetAllowed(join(outside, 'backup'), vault));
        expect(failure.status).toBe(403);
        expect(failure.code).toBe('BACKUP_TARGET_NOT_ALLOWED');
        expect(failure.message).toContain('NODUS_BACKUP_ROOTS');
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('allows a destination inside a root listed in NODUS_BACKUP_ROOTS', async () => {
    await withTempDir(async (dir) => {
      const vault = join(dir, 'vault');
      await mkdir(vault);
      const allowed = await mkdtemp(join(tmpdir(), 'nodus-backup-allowed-'));
      const previous = process.env.NODUS_BACKUP_ROOTS;
      process.env.NODUS_BACKUP_ROOTS = allowed;
      try {
        const target = join(allowed, 'backup');
        expect(await assertBackupTargetAllowed(target, vault)).toBe(resolve(target));
      } finally {
        if (previous === undefined) delete process.env.NODUS_BACKUP_ROOTS;
        else process.env.NODUS_BACKUP_ROOTS = previous;
        await rm(allowed, { recursive: true, force: true });
      }
    });
  });

  it('rejects a symlinked parent that escapes the allowed root', async () => {
    await withTempDir(async (dir) => {
      const vault = join(dir, 'vault');
      await mkdir(vault);
      const escapeTarget = await mkdtemp(join(tmpdir(), 'nodus-backup-escape-'));
      try {
        const link = join(dir, 'escape-link');
        if (!(await trySymlink(escapeTarget, link, 'dir'))) {
          return;
        }

        const failure = await apiFailure(assertBackupTargetAllowed(join(link, 'backup'), vault));
        expect(failure.status).toBe(403);
        expect(failure.code).toBe('BACKUP_TARGET_NOT_ALLOWED');
      } finally {
        await rm(escapeTarget, { recursive: true, force: true });
      }
    });
  });

  it('rejects a symlink that resolves into the active vault', async () => {
    await withTempDir(async (dir) => {
      const vault = join(dir, 'vault');
      await mkdir(vault);
      const link = join(dir, 'vault-link');
      if (!(await trySymlink(vault, link, 'dir'))) {
        return;
      }

      const failure = await apiFailure(assertBackupTargetAllowed(join(link, 'backup'), vault));
      expect(failure.status).toBe(400);
      expect(failure.code).toBe('INVALID_INPUT');
      expect(failure.message).toContain('outside the vault');
    });
  });

  it('rejects an existing file destination', async () => {
    await withTempDir(async (dir) => {
      const vault = join(dir, 'vault');
      await mkdir(vault);
      const file = join(dir, 'backup-file');
      await writeFile(file, 'not a directory', 'utf8');

      const failure = await apiFailure(assertBackupTargetAllowed(file, vault));
      expect(failure.status).toBe(400);
      expect(failure.code).toBe('INVALID_INPUT');
      expect(failure.message).toContain('not a directory');
    });
  });
});

describe('storageStatus', () => {
  it('maps CORRUPT_BACKUP to 422', () => {
    expect(storageStatus('CORRUPT_BACKUP')).toBe(422);
  });

  it('maps PARTIAL_WRITE to 500', () => {
    expect(storageStatus('PARTIAL_WRITE')).toBe(500);
  });

  it('keeps the existing mappings', () => {
    expect(storageStatus('NOT_FOUND')).toBe(404);
    expect(storageStatus('CONFLICT')).toBe(409);
    expect(storageStatus('DUPLICATE_ID')).toBe(409);
    expect(storageStatus('INVALID_INPUT')).toBe(400);
    expect(storageStatus('UNSAFE_PATH')).toBe(400);
    expect(storageStatus('INVALID_CONTENT')).toBe(422);
    expect(storageStatus('UNSUPPORTED_VERSION')).toBe(422);
    expect(storageStatus('STORAGE_FAILURE')).toBe(500);
  });
});

describe('storageErrorBody', () => {
  it('returns PARTIAL_WRITE with the exact affected paths, preserving the structure', () => {
    const error = new StorageError('PARTIAL_WRITE', 'Import stopped after writing 2 file(s)', {
      details: { paths: ['notes/a.md', 'notes/b.md'] },
    });

    const body = storageErrorBody(error);

    expect(body).toEqual({
      error: {
        code: 'PARTIAL_WRITE',
        message: 'Import stopped after writing 2 file(s)',
        paths: ['notes/a.md', 'notes/b.md'],
      },
    });
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'paths']);
  });

  it('includes validation issues for CORRUPT_BACKUP without adding other keys', () => {
    const error = new StorageError('CORRUPT_BACKUP', 'Backup validation failed with 1 issue(s)', {
      details: { issues: ['Hash mismatch for "notes/a.md"'] },
    });

    const body = storageErrorBody(error);

    expect(body).toEqual({
      error: {
        code: 'CORRUPT_BACKUP',
        message: 'Backup validation failed with 1 issue(s)',
        issues: ['Hash mismatch for "notes/a.md"'],
      },
    });
    expect(Object.keys(body.error).sort()).toEqual(['code', 'issues', 'message']);
  });

  it('emits only code and message when no details exist', () => {
    const error = new StorageError('NOT_FOUND', 'Note "x" was not found');

    expect(storageErrorBody(error)).toEqual({
      error: { code: 'NOT_FOUND', message: 'Note "x" was not found' },
    });
  });
});
