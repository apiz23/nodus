import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../ui/src/api.js';
import { isBackupRequestCurrent } from '../ui/src/backupRequest.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(handler);
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('backup request freshness', () => {
  it('ignores a response when the source edit has invalidated its request', () => {
    const oldRequest = 4;
    const currentRequest = oldRequest + 1;

    expect(isBackupRequestCurrent(oldRequest, currentRequest)).toBe(false);
    expect(isBackupRequestCurrent(currentRequest, currentRequest)).toBe(true);
  });
});

describe('backup and restore API client', () => {
  it('posts the target directory to /api/backup and returns the report', async () => {
    const mock = stubFetch(async () =>
      jsonResponse({ targetDir: '/backups/one', notes: 3, databases: 1 }, 201),
    );

    const report = await api.createBackup({ targetDir: '/backups/one' });

    expect(report).toEqual({ targetDir: '/backups/one', notes: 3, databases: 1 });
    expect(mock).toHaveBeenCalledTimes(1);
    const call = mock.mock.calls[0]!;
    expect(call[0]).toBe('/api/backup');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(call[1]?.body).toBe('{"targetDir":"/backups/one"}');
  });

  it('maps a rejected backup target to an ApiError with server diagnostics', async () => {
    stubFetch(async () =>
      jsonResponse({
        error: {
          code: 'BACKUP_TARGET_NOT_ALLOWED',
          message: 'The backup target is outside the allowed backup roots.',
        },
      }, 403),
    );

    const error = await api.createBackup({ targetDir: '/somewhere/outside' }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(403);
    expect(apiError.code).toBe('BACKUP_TARGET_NOT_ALLOWED');
    expect(apiError.message).toBe('The backup target is outside the allowed backup roots.');
  });

  it('posts the directory to /api/backup/validate and returns manifest plus counts', async () => {
    const manifest = {
      format: 'nodus-backup',
      version: 1,
      createdAt: '2026-10-27T08:00:00Z',
      files: [{ kind: 'note', id: 'n1', path: 'notes/a.md', sha256: 'abc' }],
    };
    const mock = stubFetch(async () =>
      jsonResponse({ manifest, counts: { notes: 2, databases: 1 } }),
    );

    const result = await api.validateBackup({ dir: '/backups/one' });

    expect(result.counts).toEqual({ notes: 2, databases: 1 });
    expect(result.manifest.files).toHaveLength(1);
    expect(mock.mock.calls[0]![0]).toBe('/api/backup/validate');
    expect(mock.mock.calls[0]![1]?.body).toBe('{"dir":"/backups/one"}');
  });

  it('keeps CORRUPT_BACKUP validation issues on the ApiError', async () => {
    const issues = ['digest mismatch for notes/a.md', 'unreadable database file'];
    stubFetch(async () =>
      jsonResponse({
        error: { code: 'CORRUPT_BACKUP', message: 'The backup is corrupt.', issues },
      }, 422),
    );

    const error = await api.validateBackup({ dir: '/backups/bad' }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe('CORRUPT_BACKUP');
    expect(apiError.issues).toEqual(issues);
  });

  it('posts the directory to /api/restore/preview and keeps the conflict structure', async () => {
    const preview = {
      manifest: { format: 'nodus-backup', version: 1, createdAt: '2026-10-27T08:00:00Z', files: [] },
      counts: { notes: 4, databases: 0 },
      conflicts: { ids: ['n1'], paths: ['notes/a.md'] },
    };
    const mock = stubFetch(async () => jsonResponse(preview));

    const result = await api.previewRestore({ dir: '/backups/one' });

    expect(result.conflicts).toEqual({ ids: ['n1'], paths: ['notes/a.md'] });
    expect(result.counts).toEqual({ notes: 4, databases: 0 });
    expect(mock.mock.calls[0]![0]).toBe('/api/restore/preview');
    expect(mock.mock.calls[0]![1]?.body).toBe('{"dir":"/backups/one"}');
  });

  it('sends overwrite as explicit false and never sends a destination field', async () => {
    const mock = stubFetch(async () => jsonResponse({ notes: 1, databases: 0 }));

    await api.restoreBackup({ dir: '/backups/one', overwrite: false });

    const body = mock.mock.calls[0]![1]?.body;
    expect(body).toBe('{"dir":"/backups/one","overwrite":false}');
    expect(body).not.toContain('destination');
  });

  it('omits overwrite from the payload when the caller leaves it unset', async () => {
    const mock = stubFetch(async () => jsonResponse({ notes: 0, databases: 0 }));

    await api.restoreBackup({ dir: '/backups/one' });

    expect(mock.mock.calls[0]![1]?.body).toBe('{"dir":"/backups/one"}');
  });

  it('surfaces a restore conflict as a 409 CONFLICT ApiError', async () => {
    stubFetch(async () =>
      jsonResponse({
        error: { code: 'CONFLICT', message: 'Conflicting notes exist in the vault.' },
      }, 409),
    );

    const error = await api.restoreBackup({ dir: '/backups/one', overwrite: false }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe('CONFLICT');
  });

  it('keeps PARTIAL_WRITE affected paths on the ApiError instead of succeeding', async () => {
    stubFetch(async () =>
      jsonResponse(
        {
          error: {
            code: 'PARTIAL_WRITE',
            message: 'The restore stopped before every file was written.',
            paths: ['notes/a.md'],
          },
        },
        500,
      ),
    );

    const error = await api.restoreBackup({ dir: '/backups/one', overwrite: true }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(500);
    expect(apiError.code).toBe('PARTIAL_WRITE');
    expect(apiError.paths).toEqual(['notes/a.md']);
  });

  it('reports unreachable servers as NETWORK_ERROR', async () => {
    const mock = stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    expect(mock).toBeDefined();

    const error = await api.restoreBackup({ dir: '/backups/one' }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(0);
    expect(apiError.code).toBe('NETWORK_ERROR');
  });
});
