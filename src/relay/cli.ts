/**
 * Admin CLI for the personal sync relay.
 *
 * Operates directly on the relay data directory (database + epoch anchor).
 * This is intended to run on the relay host, not remotely.
 */

import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { RelayDatabase } from './db.js';
import { AuthService } from './auth.js';
import { loadIdentity } from './identity.js';
import { SyncService } from './sync.js';
import { createRelayServer } from './server.js';

export interface CliOptions {
  dataDir: string;
  adminToken?: string;
  port?: number;
  host?: string;
}

export interface PairCliResult {
  code: string;
  expiresAt: string;
}

export async function run(argv: string[]): Promise<string> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'data-dir': { type: 'string' },
      'device-name': { type: 'string' },
      'device-id': { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      'admin-token': { type: 'string' },
    },
  });

  const command = positionals[0];
  const dataDir = values['data-dir'];
  if (typeof dataDir !== 'string') {
    throw new Error('Missing required --data-dir');
  }

  switch (command) {
    case 'pair':
      return runPair(dataDir, String(values['device-name'] ?? ''));
    case 'revoke':
      return runRevoke(dataDir, String(values['device-id'] ?? ''));
    case 'devices':
      return runDevices(dataDir);
    case 'serve':
      return runServe(dataDir, {
        port: values.port ? parseInt(values.port, 10) : undefined,
        host: typeof values.host === 'string' ? values.host : undefined,
        adminToken: typeof values['admin-token'] === 'string' ? values['admin-token'] : undefined,
      });
    default:
      throw new Error(`Unknown command: ${command ?? '(none)'}. Use pair, revoke, devices, or serve.`);
  }
}

async function openServices(dataDir: string) {
  await mkdir(dataDir, { recursive: true });
  const db = RelayDatabase.open(join(dataDir, 'relay.sqlite'));
  const auth = new AuthService(db);
  const identity = await loadIdentity(join(dataDir, 'anchor.json'));
  return { db, auth, identity };
}

async function runPair(dataDir: string, deviceName: string): Promise<string> {
  if (!deviceName) throw new Error('Missing --device-name');
  const { db, auth } = await openServices(dataDir);
  try {
    const { code } = await auth.generatePairingCode(deviceName);
    return JSON.stringify({ code, expiresInMinutes: 5 }, null, 2);
  } finally {
    db.close();
  }
}

async function runRevoke(dataDir: string, deviceId: string): Promise<string> {
  if (!deviceId) throw new Error('Missing --device-id');
  const { db, auth } = await openServices(dataDir);
  try {
    await auth.revoke({ deviceId });
    return JSON.stringify({ revoked: true, deviceId }, null, 2);
  } finally {
    db.close();
  }
}

async function runDevices(dataDir: string): Promise<string> {
  const { db, auth } = await openServices(dataDir);
  try {
    const devices = await auth.listDevices();
    return JSON.stringify({ devices }, null, 2);
  } finally {
    db.close();
  }
}

async function runServe(dataDir: string, options: Omit<CliOptions, 'dataDir'>): Promise<string> {
  const { db, auth, identity } = await openServices(dataDir);
  const sync = new SyncService(db, identity);
  const adminToken = options.adminToken ?? generateAdminToken();
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const server = createRelayServer({
    db,
    auth,
    sync,
    identity,
    adminToken,
    port,
    host,
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;
  return `Nodus relay listening on ${host}:${actualPort}\nAdmin token: ${adminToken}\n`;
}

function generateAdminToken(): string {
  // Generated tokens change on restart; pass --admin-token to keep access stable.
  return randomBytes(32).toString('base64url');
}
