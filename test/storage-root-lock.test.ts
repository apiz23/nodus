import { spawn } from 'node:child_process';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { VAULT_PROCESS_LOCK_FILE, withVaultRootLock } from '../src/storage/fs/root-lock.js';
import { withTempDir } from './tmp.js';

const CHILD_MODE = process.env.NODUS_ROOT_LOCK_CHILD === '1';
const CHILD_ROOT = process.env.NODUS_ROOT_LOCK_ROOT;
const CHILD_NOTE_ID = process.env.NODUS_ROOT_LOCK_NOTE_ID;
const CHILD_BODY = process.env.NODUS_ROOT_LOCK_BODY;
const CHILD_EXPECTED_HASH = process.env.NODUS_ROOT_LOCK_EXPECTED_HASH;
const CHILD_READY = process.env.NODUS_ROOT_LOCK_READY;
const CHILD_GATE = process.env.NODUS_ROOT_LOCK_GATE;
const CHILD_RESULT = process.env.NODUS_ROOT_LOCK_RESULT;

const TEST_NOTE_ID = '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';
const NOW = '2026-10-25T09:00:00Z';

type WriteDocument = (
  this: FileSystemVault,
  path: string,
  text: string | Uint8Array,
  allowReserved?: boolean,
  beforeWrite?: () => Promise<void>,
) => Promise<void>;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for process-lock barrier');
    // Polling only observes explicit ready/result marker files; the gate controls scheduling.
    await delay(10);
  }
}

if (CHILD_MODE) {
  it('child waits at the post-validation write barrier or records lock conflict', async () => {
    if (!(CHILD_ROOT && CHILD_NOTE_ID && CHILD_BODY && CHILD_EXPECTED_HASH && CHILD_READY && CHILD_GATE && CHILD_RESULT)) {
      throw new Error('Missing process-lock child configuration');
    }

    const vault = await FileSystemVault.open(CHILD_ROOT);
    const prototype = FileSystemVault.prototype as unknown as { writeDocument: WriteDocument };
    const original = prototype.writeDocument;
    prototype.writeDocument = async function (path, text, allowReserved, beforeWrite) {
      await writeFile(CHILD_READY, 'ready');
      await waitUntil(() => pathExists(CHILD_GATE));
      return original.call(this, path, text, allowReserved, beforeWrite);
    };

    let result: { outcome: 'success'; body: string } | { outcome: 'conflict'; code: string };
    try {
      const current = await vault.readNoteWithHash(CHILD_NOTE_ID);
      await vault.replaceNote(
        { ...current.note, body: CHILD_BODY, updatedAt: '2026-10-25T10:00:00Z' },
        { expectedHash: CHILD_EXPECTED_HASH },
      );
      result = { outcome: 'success', body: CHILD_BODY };
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : 'UNKNOWN';
      if (code !== 'CONFLICT') throw error;
      result = { outcome: 'conflict', code };
    }
    await writeFile(CHILD_RESULT, JSON.stringify(result));
  });
}

describe.skipIf(CHILD_MODE)('cross-process vault root lock', () => {
  it('serializes competing writers in one process', async () => {
    await withTempDir(async (directory) => {
      const order: string[] = [];
      let entered!: () => void;
      let continueFirst!: () => void;
      const firstEntered = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { continueFirst = resolve; });

      const first = withVaultRootLock(directory, async () => {
        order.push('first:start');
        entered();
        await gate;
        order.push('first:end');
      });
      await firstEntered;

      const second = withVaultRootLock(directory, async () => { order.push('second'); });
      expect(order).toEqual(['first:start']);
      continueFirst();
      await Promise.all([first, second]);
      expect(order).toEqual(['first:start', 'first:end', 'second']);
    });
  });

  it('rejects same-root nested acquisition instead of waiting on itself', async () => {
    await withTempDir(async (directory) => {
      const nestedOperation = vi.fn(async () => 'must not run');
      await withVaultRootLock(directory, async () => {
        await expect(withVaultRootLock(directory, nestedOperation)).rejects.toMatchObject({
          code: 'CONFLICT',
          message: expect.stringContaining('Nested vault write-lock acquisition'),
        });
      });
      expect(nestedOperation).not.toHaveBeenCalled();
      await expect(withVaultRootLock(directory, async () => 'lock released')).resolves.toBe('lock released');
    });
  });

  it('keeps withSyncWrite on the shared lock and expires its capability after callback completion', async () => {
    await withTempDir(async (directory) => {
      const root = `${directory}/vault`;
      const vault = await FileSystemVault.open(root);
      const first = createNote({ id: TEST_NOTE_ID, path: 'notes/session.md', title: 'Session', body: 'Session write\n', now: NOW });
      const second = createNote({ id: '7f2d3b0a-4c8e-4d91-9f0b-2e3a4c5d6e7f', path: 'notes/queued.md', title: 'Queued', body: 'Queued write\n', now: NOW });
      const third = createNote({ id: '8a3e4c1b-5d9f-4ea2-8a1c-3f4b5d6e7f80', path: 'notes/expired.md', title: 'Expired', body: 'Must not write\n', now: NOW });
      const nested = createNote({ id: '9b4f5d2c-6e0a-4fb3-9b2d-4a5c6d7e8f90', path: 'notes/nested.md', title: 'Nested', body: 'Must not nest\n', now: NOW });
      let entered!: () => void;
      let continueSession!: () => void;
      const sessionEntered = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { continueSession = resolve; });
      let escaped: import('../src/storage/fs/vault.js').SyncWriteSession | undefined;

      const session = vault.withSyncWrite(async (writes) => {
        escaped = writes;
        await writes.createNote(first);
        await expect(vault.createNote(nested)).rejects.toMatchObject({
          code: 'CONFLICT',
          message: expect.stringContaining('Nested vault write-lock acquisition'),
        });
        entered();
        await gate;
      });
      await sessionEntered;

      const queued = vault.createNote(second);
      expect(await pathExists(`${root}/${second.path}`)).toBe(false);
      continueSession();
      await Promise.all([session, queued]);

      expect((await vault.readNote(TEST_NOTE_ID)).body).toBe('Session write\n');
      expect((await vault.readNote(second.id)).body).toBe('Queued write\n');
      await expect(escaped!.createNote(third)).rejects.toThrow('Sync write session has ended');
      expect(await pathExists(`${root}/${third.path}`)).toBe(false);
    });
  });

  it('serializes competing conditional saves across Node processes', async () => {
    await withTempDir(async (directory) => {
      const root = `${directory}/vault`;
      const vault = await FileSystemVault.open(root);
      await vault.createNote(createNote({
        id: TEST_NOTE_ID,
        path: 'notes/race.md',
        title: 'Race',
        body: 'Initial body\n',
        now: NOW,
      }));
      const initial = await vault.readNoteWithHash(TEST_NOTE_ID);
      const cli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
      const testFile = fileURLToPath(import.meta.url);
      const workers = ['Writer A', 'Writer B'].map((body, index) => {
        const prefix = `${directory}/writer-${index}`;
        const child = spawn(process.execPath, [cli, 'run', testFile, '--reporter=dot', '--maxWorkers=1'], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODUS_ROOT_LOCK_CHILD: '1',
            NODUS_ROOT_LOCK_ROOT: root,
            NODUS_ROOT_LOCK_NOTE_ID: TEST_NOTE_ID,
            NODUS_ROOT_LOCK_BODY: body,
            NODUS_ROOT_LOCK_EXPECTED_HASH: initial.hash,
            NODUS_ROOT_LOCK_READY: `${prefix}.ready`,
            NODUS_ROOT_LOCK_GATE: `${prefix}.gate`,
            NODUS_ROOT_LOCK_RESULT: `${prefix}.result.json`,
          },
          stdio: 'ignore',
        });
        return {
          body,
          ready: `${prefix}.ready`,
          gate: `${prefix}.gate`,
          result: `${prefix}.result.json`,
          process: child,
          done: new Promise<number>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code) => resolve(code ?? -1));
          }),
        };
      });

      try {
        await waitUntil(async () => {
          const readyCount = await Promise.all(workers.map(({ ready }) => pathExists(ready)))
            .then((values) => values.filter(Boolean).length);
          const resultCount = await Promise.all(workers.map(({ result }) => pathExists(result)))
            .then((values) => values.filter(Boolean).length);
          return readyCount === 2 || (readyCount === 1 && resultCount === 1);
        });

        // Release only after both legacy writers would have passed stale-state validation,
        // or after one writer reached that barrier and the competing process was rejected.
        await Promise.all(workers.map(({ gate }) => writeFile(gate, 'release')));
        const exits = await Promise.all(workers.map(({ done }) => done));
        expect(exits).toEqual([0, 0]);

        const results = await Promise.all(workers.map(async ({ result }) =>
          JSON.parse(await readFile(result, 'utf8')) as
            | { outcome: 'success'; body: string }
            | { outcome: 'conflict'; code: string },
        ));
        expect(results.filter(({ outcome }) => outcome === 'success')).toHaveLength(1);
        expect(results.filter(({ outcome }) => outcome === 'conflict')).toHaveLength(1);
        const successfulBody = results.find((result) => result.outcome === 'success');
        expect((await vault.readNoteWithHash(TEST_NOTE_ID)).note.body).toBe(successfulBody?.body);
      } finally {
        await Promise.all(workers.map(({ gate }) => writeFile(gate, 'release').catch(() => undefined)));
        for (const { process } of workers) {
          if (process.exitCode === null) process.kill('SIGKILL');
        }
        await rm(directory, { recursive: true, force: true });
      }
    });
  }, 30_000);

  it('fails closed on a leftover lock and resumes after explicit stale-lock cleanup', async () => {
    await withTempDir(async (directory) => {
      const vault = await FileSystemVault.open(`${directory}/vault`);
      const lockPath = `${vault.root}/${VAULT_PROCESS_LOCK_FILE}`;
      await writeFile(lockPath, JSON.stringify({ pid: 123, host: 'test', token: 'stale' }));

      await expect(vault.createNote(createNote({
        id: TEST_NOTE_ID,
        path: 'notes/recovery.md',
        title: 'Recovery',
        body: 'Safe retry\n',
        now: NOW,
      }))).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await pathExists(`${vault.root}/notes/recovery.md`)).toBe(false);

      await rm(lockPath);
      await vault.createNote(createNote({
        id: TEST_NOTE_ID,
        path: 'notes/recovery.md',
        title: 'Recovery',
        body: 'Safe retry\n',
        now: NOW,
      }));
      expect((await vault.readNote(TEST_NOTE_ID)).body).toBe('Safe retry\n');
    });
  });

  it('releases the process lock when the protected operation fails', async () => {
    await withTempDir(async (directory) => {
      const lockPath = `${directory}/${VAULT_PROCESS_LOCK_FILE}`;
      await expect(withVaultRootLock(directory, async () => {
        throw new Error('injected failure');
      })).rejects.toThrow('injected failure');
      expect(await pathExists(lockPath)).toBe(false);
      await expect(withVaultRootLock(directory, async () => 'next operation')).resolves.toBe('next operation');
    });
  });
});
