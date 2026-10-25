import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RelayDatabase } from '../../src/relay/db.js';
import { AuthService } from '../../src/relay/auth.js';
import { RelayError } from '../../src/relay/errors.js';

async function tmpAuth(): Promise<{ db: RelayDatabase; auth: AuthService }> {
  const dir = await mkdtemp(join(tmpdir(), 'nodus-auth-'));
  const db = RelayDatabase.open(join(dir, 'relay.sqlite'));
  const auth = new AuthService(db);
  return { db, auth };
}

describe('AuthService', () => {
  it('generates a pairing code and pairs a device', async () => {
    const { auth } = await tmpAuth();
    const { code, codeHash } = await auth.generatePairingCode('My Laptop');
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(codeHash.length).toBe(64);

    const result = await auth.pair({ pairingCode: code, deviceName: 'My Laptop' });
    expect(result.deviceId).toMatch(/^[0-9a-f]{8}-/);
    expect(result.token.length).toBeGreaterThan(30);
  });

  it('rejects a reused pairing code', async () => {
    const { auth } = await tmpAuth();
    const { code } = await auth.generatePairingCode('Device A');
    await auth.pair({ pairingCode: code, deviceName: 'Device A' });

    await expect(auth.pair({ pairingCode: code, deviceName: 'Device B' })).rejects.toThrow(RelayError);
  });

  it('rejects an expired pairing code', async () => {
    const { auth } = await tmpAuth();
    const { code } = await auth.generatePairingCode('Device A', -1);

    const err = await auth.pair({ pairingCode: code, deviceName: 'Device A' }).catch((e) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect(err.code).toBe('PAIRING_CODE_EXPIRED');
  });

  it('verifies a minted token and rejects a revoked one', async () => {
    const { auth } = await tmpAuth();
    const { code } = await auth.generatePairingCode('Device A');
    const { deviceId, token } = await auth.pair({ pairingCode: code, deviceName: 'Device A' });

    const verified = await auth.verifyToken(token);
    expect(verified.deviceId).toBe(deviceId);

    await auth.revoke({ deviceId });
    await expect(auth.verifyToken(token)).rejects.toThrow(RelayError);
  });

  it('rejects an unknown token', async () => {
    const { auth } = await tmpAuth();
    await expect(auth.verifyToken('not-a-real-token')).rejects.toThrow(RelayError);
  });

  it('rate-limits pairing attempts', async () => {
    const { auth } = await tmpAuth();
    let blocked = false;
    for (let i = 0; i < 20; i++) {
      try {
        await auth.pair({ pairingCode: 'badcode', deviceName: 'X' }, 'client-1');
      } catch (e) {
        if (e instanceof RelayError && e.code === 'RATE_LIMITED') {
          blocked = true;
          break;
        }
      }
    }
    expect(blocked).toBe(true);
  });
});
