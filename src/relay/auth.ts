/**
 * Device authentication: pairing codes and bearer tokens.
 *
 * Pairing codes are single-use, expiring, and rate-limited. Bearer tokens are
 * 256-bit random values shown once and hashed (SHA-256) at rest.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { RelayDatabase } from './db.js';
import { RelayError } from './errors.js';
import type { DeviceInfo, PairRequest, PairResponse, RevokeRequest } from './contracts.js';
import { RateLimiter } from './rate-limit.js';

const DEFAULT_PAIRING_TTL_MINUTES = 5;
const PAIRING_BYTES = 16;
const TOKEN_BYTES = 32;

export class AuthService {
  private db: RelayDatabase;
  private pairingLimiter: RateLimiter;

  constructor(db: RelayDatabase, options?: { pairingLimiter?: RateLimiter }) {
    this.db = db;
    this.pairingLimiter = options?.pairingLimiter ?? new RateLimiter({ capacity: 5, refillPerSecond: 0 });
  }

  /**
   * Generate a single-use pairing code.
   * Returns the plain code (shown once) and its hash for storage.
   */
  async generatePairingCode(
    deviceName: string,
    ttlMinutes = DEFAULT_PAIRING_TTL_MINUTES,
  ): Promise<{ code: string; codeHash: string }> {
    this.validateDeviceName(deviceName);
    const code = this.randomPairingCode();
    const codeHash = hashHex(code);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    const insert = this.db.prepare(
      'INSERT INTO pairing_codes (codeHash, deviceName, expiresAt, used, createdAt) VALUES (?, ?, ?, 0, ?)',
    );
    insert.run(codeHash, deviceName, expiresAt, new Date().toISOString());
    return { code, codeHash };
  }

  /**
   * Consume a pairing code and mint a device token.
   */
  async pair(req: PairRequest, clientKey = 'global'): Promise<PairResponse> {
    try {
      this.pairingLimiter.check(clientKey);
    } catch {
      throw new RelayError('RATE_LIMITED', 'Too many pairing attempts', { requestId: 'auth' });
    }
    this.validateDeviceName(req.deviceName);
    if (!req.pairingCode || req.pairingCode.length < 4) {
      throw new RelayError('INVALID_PAIRING_CODE', 'Pairing code is required', { requestId: 'auth' });
    }

    const codeHash = hashHex(req.pairingCode);

    return this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT deviceName, expiresAt, used FROM pairing_codes WHERE codeHash = ?')
        .get(codeHash) as
        | { deviceName: string; expiresAt: string; used: number }
        | undefined;

      if (row === undefined) {
        throw new RelayError('INVALID_PAIRING_CODE', 'Pairing code not found', { requestId: 'auth' });
      }
      if (row.used !== 0) {
        throw new RelayError('INVALID_PAIRING_CODE', 'Pairing code already used', { requestId: 'auth' });
      }
      if (new Date(row.expiresAt) <= new Date()) {
        throw new RelayError('PAIRING_CODE_EXPIRED', 'Pairing code has expired', { requestId: 'auth' });
      }

      this.db.prepare('UPDATE pairing_codes SET used = 1 WHERE codeHash = ?').run(codeHash);

      const deviceId = randomUUID();
      const token = randomBytes(TOKEN_BYTES).toString('base64url');
      const tokenHash = hashHex(token);
      const now = new Date().toISOString();

      this.db
        .prepare(
          'INSERT INTO devices (deviceId, deviceName, tokenHash, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?)',
        )
        .run(deviceId, req.deviceName, tokenHash, now, now);

      return { deviceId, token };
    });
  }

  async verifyToken(token: string): Promise<DeviceInfo> {
    if (!token) {
      throw new RelayError('UNAUTHORIZED', 'Token is required', { requestId: 'auth' });
    }
    const tokenHash = hashHex(token);
    const row = this.db
      .prepare('SELECT deviceId, deviceName, createdAt, lastSeenAt FROM devices WHERE tokenHash = ?')
      .get(tokenHash) as
      | { deviceId: string; deviceName: string; createdAt: string; lastSeenAt: string | null }
      | undefined;

    if (row === undefined) {
      throw new RelayError('UNAUTHORIZED', 'Invalid token', { requestId: 'auth' });
    }

    const now = new Date().toISOString();
    this.db.prepare('UPDATE devices SET lastSeenAt = ? WHERE deviceId = ?').run(now, row.deviceId);

    return {
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt ?? undefined,
    };
  }

  async revoke(req: RevokeRequest): Promise<void> {
    if (!req.deviceId) {
      throw new RelayError('INVALID_INPUT', 'deviceId is required', { requestId: 'auth' });
    }
    this.db.prepare('DELETE FROM devices WHERE deviceId = ?').run(req.deviceId);
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const rows = this.db
      .prepare('SELECT deviceId, deviceName, createdAt, lastSeenAt FROM devices ORDER BY createdAt')
      .all() as { deviceId: string; deviceName: string; createdAt: string; lastSeenAt: string | null }[];
    return rows.map((row) => ({
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt ?? undefined,
    }));
  }

  pruneExpiredPairingCodes(): void {
    const now = new Date().toISOString();
    this.db.prepare('DELETE FROM pairing_codes WHERE expiresAt < ? AND used = 0').run(now);
  }

  private validateDeviceName(name: string): void {
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 120) {
      throw new RelayError('INVALID_INPUT', 'deviceName must be a non-empty string <= 120 characters', {
        requestId: 'auth',
      });
    }
  }

  private randomPairingCode(): string {
    // 128 bits, base64url encoded (22 characters).
    return randomBytes(PAIRING_BYTES).toString('base64url');
  }
}

export function hashHex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
