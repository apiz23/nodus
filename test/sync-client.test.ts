import { createServer, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { AuthService, hashHex } from '../src/relay/auth.js';
import { RelayDatabase } from '../src/relay/db.js';
import { SyncService } from '../src/relay/sync.js';
import { createRelayServer } from '../src/relay/server.js';
import { SyncClient } from '../src/sync/client.js';
import { FileSystemVault, type SyncWriteSession } from '../src/storage/fs/vault.js';

const NOW = '2026-10-25T12:00:00Z';
const VAULT_ID = '00000000-0000-0000-0000-000000000001';
const N1 = '11111111-1111-4111-8111-111111111111';
const N2 = '22222222-2222-4222-8222-222222222222';

async function relay(): Promise<{
  server: Server;
  url: string;
  auth: AuthService;
  db: RelayDatabase;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'nodus-client-relay-'));
  const db = RelayDatabase.open(join(dir, 'relay.sqlite'));
  const auth = new AuthService(db);
  const identity = { vaultId: VAULT_ID, epoch: 1 };
  const sync = new SyncService(db, identity);
  const server = createRelayServer({
    db,
    auth,
    sync,
    identity,
    adminToken: 'admin-test',
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('No relay port');
  return { server, url: `http://127.0.0.1:${address.port}`, auth, db };
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function pair(url: string, auth: AuthService, name: string): Promise<{ deviceId: string; token: string }> {
  const { code } = await auth.generatePairingCode(name);
  return SyncClient.pair(url, code, name);
}

async function localNote(vault: FileSystemVault, id = N1, body = 'Local\n'): Promise<void> {
  await vault.createNote(createNote({ id, title: `Note ${id.slice(0, 4)}`, path: `notes/${id.slice(0, 4)}.md`, body, now: NOW }));
}

function interceptSession(vault: FileSystemVault, transform: (writes: SyncWriteSession) => SyncWriteSession) {
  const original = vault.withSyncWrite.bind(vault);
  return vi.spyOn(vault, 'withSyncWrite').mockImplementationOnce(
    <T>(operation: (writes: SyncWriteSession) => Promise<T>) => original((writes) => operation(transform(writes))),
  );
}

describe('SyncClient', () => {
  it('bootstraps and pulls an incremental remote update', async () => {
    const started = await relay();
    try {
      const aRoot = await mkdtemp(join(tmpdir(), 'nodus-client-a-'));
      const bRoot = await mkdtemp(join(tmpdir(), 'nodus-client-b-'));
      const a = await FileSystemVault.open(aRoot);
      const b = await FileSystemVault.open(bRoot);
      const aCreds = await pair(started.url, started.auth, 'Device A');
      const bCreds = await pair(started.url, started.auth, 'Device B');
      const clientA = new SyncClient({ vault: a, baseUrl: started.url, token: aCreds.token, deviceId: aCreds.deviceId });
      const clientB = new SyncClient({ vault: b, baseUrl: started.url, token: bCreds.token, deviceId: bCreds.deviceId });

      await clientA.bootstrap();
      await localNote(a);
      await clientA.enqueueNoteChange(N1, 'create', { baseVersion: 0 });
      await clientA.pushOutbox();

      await clientB.bootstrap();
      expect((await b.readNote(N1)).body).toBe('Local\n');

      await b.replaceNote({ ...(await b.readNote(N1)), body: 'From B\n', updatedAt: NOW });
      await clientB.enqueueNoteChange(N1, 'update');
      await clientB.pushOutbox();
      await clientA.pull();

      expect((await a.readNote(N1)).body).toBe('From B\n');
      clientA.close();
      clientB.close();
    } finally {
      await close(started.server);
    }
  });

  it.each(['edit', 'move'] as const)('preserves a conflicting local %s when another device wins the write', async (scenario) => {
    const started = await relay();
    try {
      const aRoot = await mkdtemp(join(tmpdir(), 'nodus-client-a-'));
      const bRoot = await mkdtemp(join(tmpdir(), 'nodus-client-b-'));
      const a = await FileSystemVault.open(aRoot);
      const b = await FileSystemVault.open(bRoot);
      const aCreds = await pair(started.url, started.auth, 'Device A');
      const bCreds = await pair(started.url, started.auth, 'Device B');
      const clientA = new SyncClient({ vault: a, baseUrl: started.url, token: aCreds.token, deviceId: aCreds.deviceId });
      const clientB = new SyncClient({ vault: b, baseUrl: started.url, token: bCreds.token, deviceId: bCreds.deviceId });

      await clientA.bootstrap();
      await localNote(a, N1, 'Original\n');
      await clientA.enqueueNoteChange(N1, 'create', { baseVersion: 0 });
      await clientA.pushOutbox();
      await clientB.bootstrap();

      if (scenario === 'move') await a.moveNote(N1, 'notes/from-a.md');
      else await a.replaceNote({ ...(await a.readNote(N1)), body: 'A wins\n', updatedAt: NOW });
      await clientA.enqueueNoteChange(N1, scenario === 'move' ? 'move' : 'update');
      await clientA.pushOutbox();

      if (scenario === 'move') await b.moveNote(N1, 'notes/from-b.md');
      else await b.replaceNote({ ...(await b.readNote(N1)), body: 'B diverges\n', updatedAt: NOW });
      await clientB.enqueueNoteChange(N1, scenario === 'move' ? 'move' : 'update');
      await clientB.pushOutbox();
      await clientB.pull();

      const notes = await b.listNotes();
      expect(notes).toHaveLength(2);
      const original = await b.readNote(N1);
      const copy = await b.readNote(notes.find((note) => note.id !== N1)!.id);
      expect(original.body).toBe(scenario === 'move' ? 'Original\n' : 'A wins\n');
      expect(copy.body).toBe(scenario === 'move' ? 'Original\n' : 'B diverges\n');
      if (scenario === 'move') {
        expect(original.path).toBe('notes/from-a.md');
        expect(copy.path).toMatch(/^notes\/from-b \(conflict /);
      }
      clientA.close();
      clientB.close();
    } finally {
      await close(started.server);
    }
  });

  it.each(['update', 'move', 'delete'] as const)(
    'preserves a concurrent local revision during remote %s and blocks replay', async (operation) => {
      const started = await relay();
      try {
        const a = await FileSystemVault.open(await mkdtemp(join(tmpdir(), 'nodus-guard-a-')));
        const root = await mkdtemp(join(tmpdir(), 'nodus-guard-b-'));
        const b = await FileSystemVault.open(root);
        const clientA = new SyncClient({ vault: a, baseUrl: started.url, ...(await pair(started.url, started.auth, 'A')) });
        const options = { vault: b, baseUrl: started.url, ...(await pair(started.url, started.auth, 'B')) };
        const clientB = new SyncClient(options);
        try {
          await clientA.bootstrap();
          await localNote(a);
          await clientA.enqueueNoteChange(N1, 'create');
          await clientA.pushOutbox();
          await clientB.bootstrap();
          const cursor = clientB.getCursor();
          if (operation === 'move') await a.moveNote(N1, 'notes/remote.md');
          if (operation === 'update') await a.replaceNote({ ...(await a.readNote(N1)), body: 'Remote edit\n' });
          await clientA.enqueueNoteChange(N1, operation);
          await clientA.pushOutbox();

          const hook = interceptSession(b, (writes) => {
            const concurrentEdit = async () => {
              if (operation === 'update') {
                await writes.replaceNote({ ...(await b.readNote(N1)), body: 'Newer local edit\n' });
              } else {
                await writes.relocateNote(N1, 'notes/local.md', {});
              }
            };
            return {
              ...writes,
              replaceNote: async (...args) => { await concurrentEdit(); return writes.replaceNote(...args); },
              relocateNote: async (...args) => { await concurrentEdit(); return writes.relocateNote(...args); },
              deleteNote: async (...args) => { await concurrentEdit(); return writes.deleteNote(...args); },
            };
          });
          try {
            await expect(clientB.pull()).rejects.toMatchObject({ code: 'STALE_WRITE' });
          } finally {
            hook.mockRestore();
          }
          expect(clientB.getCursor()).toBe(cursor);

          const retry = new SyncClient(options);
          try {
            await expect(retry.pull()).rejects.toThrow('needs recovery');
            expect(retry.getCursor()).toBe(cursor);
            const note = await b.readNote(N1);
            expect(note.path).toBe(operation === 'update' ? 'notes/1111.md' : 'notes/local.md');
            expect(note.body).toBe(operation === 'update' ? 'Newer local edit\n' : 'Local\n');
            expect(await b.listNotes()).toHaveLength(1);
          } finally {
            retry.close();
          }
        } finally {
          clientA.close();
          clientB.close();
        }
      } finally {
        await close(started.server);
      }
    },
  );

  it.each(['published', 'changed-after-publication', 'split-move'] as const)(
    'reconciles a persisted apply intent after interruption (%s)', async (scenario) => {
      const started = await relay();
      try {
        const a = await FileSystemVault.open(await mkdtemp(join(tmpdir(), 'nodus-intent-a-')));
        const root = await mkdtemp(join(tmpdir(), 'nodus-intent-b-'));
        const b = await FileSystemVault.open(root);
        const clientA = new SyncClient({ vault: a, baseUrl: started.url, ...(await pair(started.url, started.auth, 'A')) });
        const options = { vault: b, baseUrl: started.url, ...(await pair(started.url, started.auth, 'B')) };
        const first = new SyncClient(options);
        await clientA.bootstrap();
        await localNote(a);
        await clientA.enqueueNoteChange(N1, 'create');
        await clientA.pushOutbox();
        await first.bootstrap();
        const cursor = first.getCursor();
        const path = scenario === 'split-move' ? 'notes/moved.md' : 'notes/1111.md';
        if (scenario === 'split-move') await a.moveNote(N1, path);
        await a.replaceNote({ ...(await a.readNote(N1)), body: 'Remote revision\n' });
        await clientA.enqueueNoteChange(N1);
        await clientA.pushOutbox();

        const hook = interceptSession(b, (writes) => ({
          ...writes,
          relocateNote: async () => {
            const bytes = await readFile(join(a.root, path));
            await writeFile(join(root, path), bytes, { flag: 'wx' });
            throw new Error('interrupted after publishing destination');
          },
          replaceNote: async (...args) => {
            await writes.replaceNote(...args);
            throw new Error('interrupted after publishing destination');
          },
        }));
        try {
          await expect(first.pull()).rejects.toThrow('interrupted after publishing destination');
          expect(first.getCursor()).toBe(cursor);
        } finally {
          hook.mockRestore();
          first.close();
        }
        if (scenario === 'changed-after-publication') {
          await b.replaceNote({ ...(await b.readNote(N1)), body: 'New local revision\n' });
        }

        const retry = new SyncClient(options);
        const unexpectedWrite = vi.fn<SyncWriteSession['replaceNote']>();
        const retryHook = interceptSession(b, (writes) => ({ ...writes, replaceNote: unexpectedWrite }));
        try {
          if (scenario === 'published') {
            await retry.pull();
            expect(retry.getCursor()).not.toBe(cursor);
            expect((await b.readNote(N1)).body).toBe('Remote revision\n');
          } else {
            await expect(retry.pull()).rejects.toThrow('needs recovery');
            await expect(retry.pull()).rejects.toThrow('needs recovery');
            expect(retry.getCursor()).toBe(cursor);
            if (scenario === 'split-move') {
              expect((await b.readNoteAtPath('notes/1111.md')).body).toBe('Local\n');
              expect((await b.readNoteAtPath(path)).body).toBe('Remote revision\n');
            } else {
              expect((await b.readNote(N1)).body).toBe('New local revision\n');
            }
          }
          expect(unexpectedWrite).not.toHaveBeenCalled();
        } finally {
          retryHook.mockRestore();
          retry.close();
          clientA.close();
        }
      } finally {
        await close(started.server);
      }
    },
  );

  it.each(['before-copy', 'after-copy', 'missing', 'modified'] as const)(
    'recovers or detects an interrupted conflict copy (%s)', async (scenario) => {
      const started = await relay();
      try {
        const a = await FileSystemVault.open(await mkdtemp(join(tmpdir(), 'nodus-conflict-a-')));
        const root = await mkdtemp(join(tmpdir(), 'nodus-conflict-b-'));
        const b = await FileSystemVault.open(root);
        const aCreds = await pair(started.url, started.auth, 'A');
        const bCreds = await pair(started.url, started.auth, 'B');
        const baseUrl = started.url;
        const clientA = new SyncClient({ vault: a, baseUrl, ...aCreds });
        const options = { vault: b, baseUrl, ...bCreds };
        const clientB = new SyncClient(options);
        await clientA.bootstrap();
        await localNote(a);
        await clientA.enqueueNoteChange(N1, 'create');
        await clientA.pushOutbox();
        await clientB.bootstrap();
        clientB.close();

        const statePath = join(root, '.nodus', 'sync.sqlite');
        // Simulate a vault created before the additive migration.
        const legacyDb = new DatabaseSync(statePath);
        legacyDb.exec('DROP TABLE conflict_records_v1');
        legacyDb.close();
        const first = new SyncClient(options);

        await a.replaceNote({ ...(await a.readNote(N1)), body: 'Remote\n' });
        await clientA.enqueueNoteChange(N1);
        await clientA.pushOutbox();
        await b.replaceNote({ ...(await b.readNote(N1)), body: 'Divergent\n' });
        const localHash = hashHex(await readFile(join(root, 'notes/1111.md'), 'utf8'));

        const interrupt = interceptSession(b, (writes) => ({
          ...writes,
          createNote: async (note) => {
            if (scenario === 'before-copy' || scenario === 'after-copy') {
              if (scenario === 'after-copy') await writes.createNote(note);
              throw new Error('interrupted');
            }
            await writes.createNote(note);
          },
          replaceNote: async () => { throw new Error('interrupted'); },
        }));
        try {
          await expect(first.pull()).rejects.toThrow('interrupted');
        } finally {
          interrupt.mockRestore();
          first.close();
        }

        const stateDb = new DatabaseSync(statePath);
        const row = stateDb.prepare('SELECT conflictId, localHash, published FROM conflict_records_v1').get() as
          { conflictId: string; localHash: string; published: number };
        stateDb.close();
        expect(row.localHash).toBe(localHash);
        expect(row.published).toBe(scenario === 'missing' || scenario === 'modified' ? 1 : 0);

        if (scenario === 'missing') await b.deleteNote(row.conflictId);
        if (scenario === 'modified') {
          await b.replaceNote({ ...(await b.readNote(row.conflictId)), body: 'Edited copy\n' });
        }
        const retry = new SyncClient(options);
        try {
          if (scenario === 'missing' || scenario === 'modified') {
            await expect(retry.pull()).rejects.toThrow('missing or modified');
            expect((await b.readNote(N1)).body).toBe('Divergent\n');
            if (scenario === 'modified') expect((await b.readNote(row.conflictId)).body).toBe('Edited copy\n');
          } else {
            await retry.pull();
            expect(await b.listNotes()).toHaveLength(2);
            expect((await b.readNote(row.conflictId)).body).toBe('Divergent\n');
            expect((await b.readNote(N1)).body).toBe('Remote\n');
          }
        } finally {
          retry.close();
          clientA.close();
        }
      } finally {
        await close(started.server);
      }
    },
  );

  it.each(['edit', 'move'] as const)('preserves a local %s when the remote document is deleted', async (scenario) => {
    const started = await relay();
    try {
      const aRoot = await mkdtemp(join(tmpdir(), 'nodus-client-a-'));
      const bRoot = await mkdtemp(join(tmpdir(), 'nodus-client-b-'));
      const a = await FileSystemVault.open(aRoot);
      const b = await FileSystemVault.open(bRoot);
      const aCreds = await pair(started.url, started.auth, 'Device A');
      const bCreds = await pair(started.url, started.auth, 'Device B');
      const clientA = new SyncClient({ vault: a, baseUrl: started.url, token: aCreds.token, deviceId: aCreds.deviceId });
      const clientB = new SyncClient({ vault: b, baseUrl: started.url, token: bCreds.token, deviceId: bCreds.deviceId });

      await clientA.bootstrap();
      await localNote(a, N1, 'Original\n');
      await clientA.enqueueNoteChange(N1, 'create', { baseVersion: 0 });
      await clientA.pushOutbox();
      await clientB.bootstrap();

      if (scenario === 'move') await b.moveNote(N1, 'notes/from-b.md');
      else await b.replaceNote({ ...(await b.readNote(N1)), body: 'B local edit\n', updatedAt: NOW });
      await a.deleteNote(N1);
      await clientA.enqueueChanges([
        { kind: 'note', id: N1, op: 'delete', baseVersion: 1, version: 2, path: 'notes/1111.md', contentHash: hashHex('') },
      ]);
      await clientA.pushOutbox();
      await clientB.pull();

      await expect(b.readNote(N1)).rejects.toThrow();
      const notes = await b.listNotes();
      expect(notes).toHaveLength(1);
      const copy = await b.readNote(notes[0]!.id);
      expect(copy.body).toBe(scenario === 'move' ? 'Original\n' : 'B local edit\n');
      if (scenario === 'move') expect(copy.path).toMatch(/^notes\/from-b \(conflict /);
      clientA.close();
      clientB.close();
    } finally {
      await close(started.server);
    }
  });

  it('retries pending outbox work after a network failure', async () => {
    const started = await relay();
    try {
      const root = await mkdtemp(join(tmpdir(), 'nodus-client-network-'));
      const vault = await FileSystemVault.open(root);
      const creds = await pair(started.url, started.auth, 'Network Device');
      const statePath = join(root, '.nodus', 'sync.sqlite');
      let failPush = true;
      const flakyFetch = (async (input: string | URL | Request, init?: RequestInit) => {
        if (failPush && String(input).endsWith('/push')) {
          failPush = false;
          throw new Error('simulated network failure');
        }
        return fetch(input, init);
      }) as typeof fetch;
      const first = new SyncClient({
        vault,
        baseUrl: started.url,
        token: creds.token,
        deviceId: creds.deviceId,
        statePath,
        fetchImpl: flakyFetch,
      });
      await first.bootstrap();
      await localNote(vault);
      await first.enqueueNoteChange(N1, 'create', { baseVersion: 0 });
      await expect(first.pushOutbox()).rejects.toThrow(/unreachable|network/i);
      expect(first.getPendingOperationIds()).toHaveLength(1);
      first.close();

      const second = new SyncClient({
        vault,
        baseUrl: started.url,
        token: creds.token,
        deviceId: creds.deviceId,
        statePath,
      });
      await second.pushOutbox();
      expect(second.getPendingOperationIds()).toHaveLength(0);
      second.close();
    } finally {
      await close(started.server);
    }
  });

  it('blocks mass deletion when the remote deletion count exceeds the limit', async () => {
    const started = await relay();
    try {
      const aRoot = await mkdtemp(join(tmpdir(), 'nodus-client-a-'));
      const a = await FileSystemVault.open(aRoot);
      const aCreds = await pair(started.url, started.auth, 'Mass Delete A');
      const clientA = new SyncClient({ vault: a, baseUrl: started.url, token: aCreds.token, deviceId: aCreds.deviceId });
      await clientA.bootstrap();
      await localNote(a, N1, 'A\n');
      await localNote(a, N2, 'B\n');
      await clientA.enqueueNoteChange(N1, 'create', { baseVersion: 0 });
      await clientA.pushOutbox();
      await clientA.enqueueNoteChange(N2, 'create', { baseVersion: 0 });
      await clientA.pushOutbox();
      await clientA.enqueueNoteChange(N1, 'delete');
      await clientA.pushOutbox();
      await clientA.enqueueNoteChange(N2, 'delete');
      await clientA.pushOutbox();

      const bRoot = await mkdtemp(join(tmpdir(), 'nodus-client-b-'));
      const b = await FileSystemVault.open(bRoot);
      await localNote(b, N1, 'A\n');
      await localNote(b, N2, 'B\n');
      const bCreds = await pair(started.url, started.auth, 'Mass Delete B');
      const clientB = new SyncClient({
        vault: b,
        baseUrl: started.url,
        token: bCreds.token,
        deviceId: bCreds.deviceId,
        massDeleteLimit: 1,
      });
      await expect(clientB.bootstrap()).rejects.toThrow(/Mass-delete guard/);
      clientA.close();
      clientB.close();
    } finally {
      await close(started.server);
    }
  });

  it('replays a pull batch safely when the cursor was not advanced', async () => {
    const started = await relay();
    try {
      const aRoot = await mkdtemp(join(tmpdir(), 'nodus-client-a-'));
      const bRoot = await mkdtemp(join(tmpdir(), 'nodus-client-b-'));
      const a = await FileSystemVault.open(aRoot);
      const b = await FileSystemVault.open(bRoot);
      const aCreds = await pair(started.url, started.auth, 'Replay A');
      const bCreds = await pair(started.url, started.auth, 'Replay B');
      const clientA = new SyncClient({ vault: a, baseUrl: started.url, token: aCreds.token, deviceId: aCreds.deviceId });
      const clientB = new SyncClient({ vault: b, baseUrl: started.url, token: bCreds.token, deviceId: bCreds.deviceId });

      await clientA.bootstrap();
      await localNote(a, N1, 'Before replay\n');
      await clientA.enqueueNoteChange(N1, 'create', { baseVersion: 0 });
      await clientA.pushOutbox();
      await clientB.bootstrap();
      const cursorBefore = clientB.getCursor();
      expect(cursorBefore).toBeDefined();

      await a.replaceNote({ ...(await a.readNote(N1)), body: 'Replay update\n', updatedAt: NOW });
      await clientA.enqueueNoteChange(N1, 'update');
      await clientA.pushOutbox();
      await clientB.pull();
      expect((await b.readNote(N1)).body).toBe('Replay update\n');

      const statePath = join(bRoot, '.nodus', 'sync.sqlite');
      const stateDb = new DatabaseSync(statePath);
      stateDb.prepare("UPDATE meta SET value = ? WHERE key = 'cursor'").run(cursorBefore ?? '');
      stateDb.close();

      await clientB.pull();
      expect((await b.readNote(N1)).body).toBe('Replay update\n');
      expect(await b.listNotes()).toHaveLength(1);
      clientA.close();
      clientB.close();
    } finally {
      await close(started.server);
    }
  });

  it('keeps pending outbox work across restart', async () => {
    const started = await relay();
    try {
      const root = await mkdtemp(join(tmpdir(), 'nodus-client-restart-'));
      const vault = await FileSystemVault.open(root);
      const creds = await pair(started.url, started.auth, 'Restart Device');
      const statePath = join(root, '.nodus', 'sync.sqlite');
      const first = new SyncClient({ vault, baseUrl: started.url, token: creds.token, deviceId: creds.deviceId, statePath });
      await first.bootstrap();
      await localNote(vault);
      await first.enqueueNoteChange(N1, 'create', { baseVersion: 0 });
      first.close();

      const second = new SyncClient({ vault, baseUrl: started.url, token: creds.token, deviceId: creds.deviceId, statePath });
      expect(second.getPendingOperationIds()).toHaveLength(1);
      await second.pushOutbox();
      expect(second.getPendingOperationIds()).toHaveLength(0);
      second.close();
    } finally {
      await close(started.server);
    }
  });

  it('bootstraps after the relay epoch changes', async () => {
    const started = await relay();
    let secondServer: Server | undefined;
    try {
      const root = await mkdtemp(join(tmpdir(), 'nodus-client-epoch-'));
      const vault = await FileSystemVault.open(root);
      const creds = await pair(started.url, started.auth, 'Epoch Device');
      const first = new SyncClient({ vault, baseUrl: started.url, token: creds.token, deviceId: creds.deviceId });
      await first.bootstrap();
      await localNote(vault, N1, 'Epoch content\n');
      await first.enqueueNoteChange(N1, 'create', { baseVersion: 0 });
      await first.pushOutbox();
      first.close();
      await close(started.server);

      const identity = { vaultId: VAULT_ID, epoch: 2 };
      secondServer = createRelayServer({
        db: started.db,
        auth: started.auth,
        sync: new SyncService(started.db, identity),
        identity,
        adminToken: 'admin-test',
      });
      await new Promise<void>((resolve) => secondServer!.listen(0, '127.0.0.1', resolve));
      const address = secondServer.address();
      if (typeof address !== 'object' || address === null) throw new Error('No second relay port');
      const restarted = new SyncClient({
        vault,
        baseUrl: `http://127.0.0.1:${address.port}`,
        token: creds.token,
        deviceId: creds.deviceId,
      });
      await restarted.pull();
      expect((await vault.readNote(N1)).body).toBe('Epoch content\n');
      restarted.close();
    } finally {
      if (started.server.listening) await close(started.server);
      if (secondServer?.listening) await close(secondServer);
    }
  });

  it('recovers when local sync state is missing by bootstrapping', async () => {
    const started = await relay();
    try {
      const root = await mkdtemp(join(tmpdir(), 'nodus-client-missing-'));
      const vault = await FileSystemVault.open(root);
      const creds = await pair(started.url, started.auth, 'Missing State');
      const first = new SyncClient({ vault, baseUrl: started.url, token: creds.token, deviceId: creds.deviceId });
      await first.bootstrap();
      await localNote(vault, N2, 'Remote\n');
      await first.enqueueNoteChange(N2, 'create', { baseVersion: 0 });
      await first.pushOutbox();
      first.close();

      const fresh = new SyncClient({
        vault,
        baseUrl: started.url,
        token: creds.token,
        deviceId: creds.deviceId,
        statePath: join(root, '.nodus', 'fresh.sqlite'),
      });
      await fresh.bootstrap();
      expect((await vault.readNote(N2)).body).toBe('Remote\n');
      fresh.close();
    } finally {
      await close(started.server);
    }
  });
});
