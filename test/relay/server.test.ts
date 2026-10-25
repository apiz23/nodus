import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { RelayDatabase } from '../../src/relay/db.js';
import { AuthService, hashHex } from '../../src/relay/auth.js';
import { SyncService } from '../../src/relay/sync.js';
import { createRelayServer } from '../../src/relay/server.js';

const VAULT_ID = '00000000-0000-0000-0000-000000000001';
const PROTOCOL_HEADERS = {
  'Content-Type': 'application/json',
  'X-Nodus-Protocol-Version': '1',
  'X-Nodus-Vault-Id': VAULT_ID,
  'X-Nodus-Epoch': '1',
};

const N1 = '11111111-1111-4111-1111-111111111111';
const N2 = '22222222-2222-4222-2222-222222222222';

function content(body: string, id = N1): { content: string; contentHash: string } {
  const c = `---\nnodus:\n  version: 1\n  id: ${id}\n  createdAt: 2026-10-25T12:00:00Z\n  updatedAt: 2026-10-25T12:00:00Z\n---\n${body}`;
  return { content: c, contentHash: hashHex(c) };
}

async function setup(): Promise<{
  server: Server;
  url: string;
  adminToken: string;
  auth: AuthService;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'nodus-relay-srv-'));
  const dbPath = join(dir, 'relay.sqlite');
  const db = RelayDatabase.open(dbPath);
  const auth = new AuthService(db);
  const identity = { vaultId: VAULT_ID, epoch: 1 };
  const sync = new SyncService(db, identity);
  const adminToken = 'admin-secret-for-tests';

  const server = createRelayServer({ db, auth, sync, identity, adminToken });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;
  return { server, url, adminToken, auth };
}

async function pairDevice(url: string, auth: AuthService): Promise<{ deviceId: string; token: string }> {
  const { code } = await auth.generatePairingCode('Test Device');
  const res = await fetch(`${url}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingCode: code, deviceName: 'Test Device' }),
  });
  const body = (await res.json()) as { deviceId: string; token: string };
  return body;
}

async function stop(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe('relay server', () => {
  it('reports health', async () => {
    const { server, url } = await setup();
    try {
      const res = await fetch(`${url}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('ok');
    } finally {
      await stop(server);
    }
  });

  it('sets no-store responses and request timeouts', async () => {
    const { server, url } = await setup();
    try {
      const res = await fetch(`${url}/health`);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(server.requestTimeout).toBe(30_000);
      expect(server.headersTimeout).toBe(10_000);
    } finally {
      await stop(server);
    }
  });

  it('reports vault info', async () => {
    const { server, url } = await setup();
    try {
      const res = await fetch(`${url}/vault`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { protocolVersion: number; vaultId: string; epoch: number };
      expect(body.protocolVersion).toBe(1);
      expect(body.vaultId).toMatch(/^[0-9a-f]{8}-/);
      expect(body.epoch).toBe(1);
    } finally {
      await stop(server);
    }
  });

  it('pairs a device with a valid code', async () => {
    const { server, url, auth } = await setup();
    try {
      const body = await pairDevice(url, auth);
      expect(body.deviceId).toMatch(/^[0-9a-f]{8}-/);
      expect(typeof body.token).toBe('string');
    } finally {
      await stop(server);
    }
  });

  it('rejects an invalid pairing code', async () => {
    const { server, url } = await setup();
    try {
      const res = await fetch(`${url}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode: 'badcode', deviceName: 'X' }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string; requestId: string } };
      expect(body.error.code).toBe('INVALID_PAIRING_CODE');
      expect(body.error.requestId).toMatch(/^[0-9a-f]{8}-/);
    } finally {
      await stop(server);
    }
  });

  it('rejects invalid JSON', async () => {
    const { server, url } = await setup();
    try {
      const res = await fetch(`${url}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ not json',
      });
      expect(res.status).toBe(400);
    } finally {
      await stop(server);
    }
  });

  it('protects admin endpoints', async () => {
    const { server, url } = await setup();
    try {
      const res = await fetch(`${url}/devices`);
      expect(res.status).toBe(401);
    } finally {
      await stop(server);
    }
  });

  it('lists and revokes devices with admin token', async () => {
    const { server, url, adminToken, auth } = await setup();
    try {
      const { deviceId } = await pairDevice(url, auth);

      const listRes = await fetch(`${url}/devices`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as { devices: { deviceId: string }[] };
      expect(list.devices.some((d) => d.deviceId === deviceId)).toBe(true);

      const revokeRes = await fetch(`${url}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      expect(revokeRes.status).toBe(200);

      const listAfter = await fetch(`${url}/devices`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const after = (await listAfter.json()) as { devices: { deviceId: string }[] };
      expect(after.devices.some((d) => d.deviceId === deviceId)).toBe(false);
    } finally {
      await stop(server);
    }
  });

  it('pushes and pulls a document', async () => {
    const { server, url, auth } = await setup();
    try {
      const { token } = await pairDevice(url, auth);
      const { content: c, contentHash } = content('Hello');

      const pushRes = await fetch(`${url}/push`, {
        method: 'POST',
        headers: { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          operationId: 'op-1',
          deviceSeq: 1,
          changes: [{ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content: c }],
        }),
      });
      expect(pushRes.status).toBe(200);
      const pushBody = (await pushRes.json()) as { results: { status: string; version: number }[] };
      expect(pushBody.results[0]!.status).toBe('applied');
      expect(pushBody.results[0]!.version).toBe(1);

      const pullRes = await fetch(`${url}/pull`, {
        headers: { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` },
      });
      expect(pullRes.status).toBe(200);
      const pullBody = (await pullRes.json()) as { changes: { id: string }[] };
      expect(pullBody.changes).toHaveLength(1);
      expect(pullBody.changes[0]!.id).toBe(N1);
    } finally {
      await stop(server);
    }
  });

  it('rejects stale baseVersion with conflict', async () => {
    const { server, url, auth } = await setup();
    try {
      const { token } = await pairDevice(url, auth);
      const v1 = content('Hello');
      await fetch(`${url}/push`, {
        method: 'POST',
        headers: { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          operationId: 'op-1',
          deviceSeq: 1,
          changes: [{ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash: v1.contentHash, content: v1.content }],
        }),
      });
      const v2 = content('Hello world');
      await fetch(`${url}/push`, {
        method: 'POST',
        headers: { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          operationId: 'op-2',
          deviceSeq: 2,
          changes: [{ kind: 'note', id: N1, op: 'update', baseVersion: 1, version: 2, path: 'notes/a.md', contentHash: v2.contentHash, content: v2.content }],
        }),
      });

      const stale = content('Stale edit');
      const res = await fetch(`${url}/push`, {
        method: 'POST',
        headers: { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          operationId: 'op-3',
          deviceSeq: 3,
          changes: [{ kind: 'note', id: N1, op: 'update', baseVersion: 1, version: 2, path: 'notes/a.md', contentHash: stale.contentHash, content: stale.content }],
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { results: { status: string }[] };
      expect(body.results[0]!.status).toBe('conflict');
    } finally {
      await stop(server);
    }
  });

  it('returns stored result for duplicate push', async () => {
    const { server, url, auth } = await setup();
    try {
      const { token } = await pairDevice(url, auth);
      const { content: c, contentHash } = content('Hello');
      const payload = {
        operationId: 'op-1',
        deviceSeq: 1,
        changes: [{ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content: c }],
      };
      const first = await fetch(`${url}/push`, {
        method: 'POST',
        headers: { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const firstBody = (await first.json()) as { results: unknown[] };

      const second = await fetch(`${url}/push`, {
        method: 'POST',
        headers: { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const secondBody = (await second.json()) as { results: unknown[] };
      expect(secondBody.results).toEqual(firstBody.results);
    } finally {
      await stop(server);
    }
  });

  it('rejects out-of-order device sequences', async () => {
    const { server, url, auth } = await setup();
    try {
      const { token } = await pairDevice(url, auth);
      const { content: c, contentHash } = content('Hello');
      await fetch(`${url}/push`, {
        method: 'POST',
        headers: { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          operationId: 'op-1',
          deviceSeq: 1,
          changes: [{ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content: c }],
        }),
      });

      const res = await fetch(`${url}/push`, {
        method: 'POST',
        headers: { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          operationId: 'op-2',
          deviceSeq: 3,
          changes: [{ kind: 'note', id: N1, op: 'update', baseVersion: 1, version: 2, path: 'notes/a.md', contentHash, content: c }],
        }),
      });
      expect(res.status).toBe(409);
    } finally {
      await stop(server);
    }
  });

  it('rejects sync requests without a protocol version', async () => {
    const { server, url, auth } = await setup();
    try {
      const { token } = await pairDevice(url, auth);
      const res = await fetch(`${url}/pull`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(400);
    } finally {
      await stop(server);
    }
  });

  it('rejects invalid sync payloads', async () => {
    const { server, url, auth } = await setup();
    try {
      const { token } = await pairDevice(url, auth);
      const res = await fetch(`${url}/push`, {
        method: 'POST',
        headers: { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ operationId: 'x', deviceSeq: 1 }),
      });
      expect(res.status).toBe(400);
    } finally {
      await stop(server);
    }
  });

  it('protects sync endpoints with device token', async () => {
    const { server, url } = await setup();
    try {
      const res = await fetch(`${url}/pull`, {
        headers: PROTOCOL_HEADERS,
      });
      expect(res.status).toBe(401);
    } finally {
      await stop(server);
    }
  });

  it('returns operations and snapshots', async () => {
    const { server, url, auth } = await setup();
    try {
      const { token } = await pairDevice(url, auth);
      const { content: c, contentHash } = content('Hello');
      await fetch(`${url}/push`, {
        method: 'POST',
        headers: { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          operationId: 'op-1',
          deviceSeq: 1,
          changes: [{ kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash, content: c }],
        }),
      });

      const opsRes = await fetch(`${url}/operations?fromDeviceSeq=1`, {
        headers: { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` },
      });
      expect(opsRes.status).toBe(200);
      const opsBody = (await opsRes.json()) as { operations: { operationId: string }[] };
      expect(opsBody.operations).toHaveLength(1);
      expect(opsBody.operations[0]!.operationId).toBe('op-1');

      const snapRes = await fetch(`${url}/snapshot`, {
        headers: { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` },
      });
      expect(snapRes.status).toBe(200);
      const snapBody = (await snapRes.json()) as { documents: { id: string }[] };
      expect(snapBody.documents).toHaveLength(1);
      expect(snapBody.documents[0]!.id).toBe(N1);
    } finally {
      await stop(server);
    }
  });

  it('requires matching vault identity and epoch headers', async () => {
    const { server, url, auth } = await setup();
    try {
      const { token } = await pairDevice(url, auth);
      const missing = await fetch(`${url}/pull`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Nodus-Protocol-Version': '1' },
      });
      expect(missing.status).toBe(400);

      const mismatch = await fetch(`${url}/pull`, {
        headers: {
          ...PROTOCOL_HEADERS,
          'X-Nodus-Epoch': '2',
          Authorization: `Bearer ${token}`,
        },
      });
      expect(mismatch.status).toBe(410);
      const body = (await mismatch.json()) as { error: { code: string } };
      expect(body.error.code).toBe('BOOTSTRAP_REQUIRED');
    } finally {
      await stop(server);
    }
  });

  it('paginates snapshots and serves versioned content with explicit stale/retired errors', async () => {
    const { server, url, auth } = await setup();
    try {
      const { token } = await pairDevice(url, auth);
      const one = content('One');
      const two = content('Two', N2);
      const headers = { ...PROTOCOL_HEADERS, Authorization: `Bearer ${token}` };

      const pushRes = await fetch(`${url}/push`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operationId: 'snap-op-1',
          deviceSeq: 1,
          changes: [
            { kind: 'note', id: N1, op: 'create', baseVersion: 0, version: 1, path: 'notes/a.md', contentHash: one.contentHash, content: one.content },
            { kind: 'note', id: N2, op: 'create', baseVersion: 0, version: 1, path: 'notes/b.md', contentHash: two.contentHash, content: two.content },
          ],
        }),
      });
      expect(pushRes.status).toBe(200);

      const first = await fetch(`${url}/snapshot?limit=1`, { headers });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as {
        snapshotSeq: number;
        documents: { id: string }[];
        nextCursor: string | null;
      };
      expect(firstBody.documents).toHaveLength(1);
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await fetch(
        `${url}/snapshot?limit=1&after=${encodeURIComponent(firstBody.nextCursor ?? '')}`,
        { headers },
      );
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as { documents: { id: string }[] };
      expect(secondBody.documents).toHaveLength(1);
      expect(new Set([firstBody.documents[0]!.id, secondBody.documents[0]!.id])).toEqual(
        new Set([N1, N2]),
      );

      const contentRes = await fetch(`${url}/docs/note/${N1}?version=1`, { headers });
      expect(contentRes.status).toBe(200);
      const contentBody = (await contentRes.json()) as { content: string };
      expect(contentBody.content).toContain('One');

      const updated = content('One updated');
      await fetch(`${url}/push`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operationId: 'snap-op-2',
          deviceSeq: 2,
          changes: [{ kind: 'note', id: N1, op: 'update', baseVersion: 1, version: 2, path: 'notes/a.md', contentHash: updated.contentHash, content: updated.content }],
        }),
      });
      const stale = await fetch(`${url}/docs/note/${N1}?version=1`, { headers });
      expect(stale.status).toBe(409);
      const staleBody = (await stale.json()) as { error: { code: string } };
      expect(staleBody.error.code).toBe('STALE_SNAPSHOT');

      await fetch(`${url}/push`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operationId: 'snap-op-3',
          deviceSeq: 3,
          changes: [{ kind: 'note', id: N1, op: 'delete', baseVersion: 2, version: 3, path: 'notes/a.md', contentHash: hashHex('') }],
        }),
      });
      const retired = await fetch(`${url}/docs/note/${N1}`, { headers });
      expect(retired.status).toBe(410);
      const retiredBody = (await retired.json()) as { error: { code: string } };
      expect(retiredBody.error.code).toBe('DOCUMENT_RETIRED');

      const deviceState = await fetch(`${url}/device/state`, { headers });
      expect(deviceState.status).toBe(200);
      const deviceStateBody = (await deviceState.json()) as { lastSeq: number };
      expect(deviceStateBody.lastSeq).toBe(3);
    } finally {
      await stop(server);
    }
  });
});
