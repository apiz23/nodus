import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import { withTempDir } from './tmp.js';

async function serve(vaultPath: string) {
  const middleware = createLocalApiMiddleware({ vaultPath });
  const server: Server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No local API address');
  return { base: `http://127.0.0.1:${address.port}`, server, middleware };
}

async function request<T>(base: string, path: string, method = 'GET', body?: unknown, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${base}${path}`, { method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as T };
}

describe('local conflict-resolution bridge', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps bearer credentials in process memory and clears the paired session on disconnect', async () => {
    await withTempDir(async (root) => {
      const vaultPath = join(root, 'vault');
      const token = 'memory-only-test-bearer-secret';
      const localFetch = globalThis.fetch;
      let observedAuthorization: string | null = null;
      let pairingCalled = false;
      const fetchMock: typeof fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/pair')) { pairingCalled = true; return new Response(JSON.stringify({ deviceId: 'device-test', token }), { status: 200 }); }
        if (url.endsWith('/vault')) {
          observedAuthorization = new Headers(init?.headers).get('Authorization');
          return new Response(JSON.stringify({ vaultId: 'vault-test', epoch: 1 }), { status: 200 });
        }
        throw new Error(`Unexpected relay request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      const app = await serve(vaultPath);
      try {
        expect(await request<{ conflicts: unknown[] }>(app.base, '/api/sync/conflicts', 'GET', undefined, localFetch))
          .toMatchObject({ status: 200, body: { conflicts: [] } });
        const connected = await request<Record<string, unknown>>(app.base, '/api/sync/connect', 'POST', {
          relayUrl: 'https://relay.example', pairingCode: 'one-time-pairing-code',
        }, localFetch);
        expect(connected.status).toBe(200);
        expect(connected.body).toEqual({ connected: true, vaultId: 'vault-test', epoch: 1 });
        expect(JSON.stringify(connected.body)).not.toContain(token);
        expect(await request(app.base, '/api/sync/connection', 'GET', undefined, localFetch)).toMatchObject({ status: 200, body: { connected: true } });
        const persisted = await readFile(join(vaultPath, '.nodus', 'sync.sqlite'));
        expect(persisted.includes(Buffer.from(token))).toBe(false);
        expect(pairingCalled).toBe(true);
        expect(observedAuthorization).toBe(`Bearer ${token}`);
        expect(await request(app.base, '/api/sync/disconnect', 'POST', undefined, localFetch)).toMatchObject({ status: 200, body: { connected: false } });
        expect(await request(app.base, '/api/sync/connection', 'GET', undefined, localFetch)).toMatchObject({ status: 200, body: { connected: false } });
      } finally {
        app.server.closeAllConnections();
        await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
        await app.middleware.dispose();
      }
    });
  });

  it('rejects insecure non-loopback relay URLs before sending pairing credentials', async () => {
    await withTempDir(async (root) => {
      const app = await serve(root);
      try {
        const result = await request<{ error: { code: string } }>(app.base, '/api/sync/connect', 'POST', {
          relayUrl: 'http://relay.example', pairingCode: 'one-time-pairing-code',
        }, globalThis.fetch);
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('INVALID_INPUT');
      } finally {
        app.server.closeAllConnections();
        await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
        await app.middleware.dispose();
      }
    });
  });
});
