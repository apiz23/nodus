import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../src/relay/cli.js';

describe('relay CLI', () => {
  it('generates a pairing code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nodus-cli-'));
    const output = await run(['pair', '--data-dir', dir, '--device-name', 'Test']);
    const parsed = JSON.parse(output);
    expect(parsed.code.length).toBeGreaterThan(5);
    expect(parsed.expiresInMinutes).toBe(5);
  });

  it('lists and revokes devices', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nodus-cli-'));
    await run(['pair', '--data-dir', dir, '--device-name', 'Device']);

    const listOut = await run(['devices', '--data-dir', dir]);
    const list = JSON.parse(listOut) as { devices: unknown[] };
    expect(Array.isArray(list.devices)).toBe(true);

    // Revoke a non-existent device should still return revoked true (idempotent delete).
    const revokeOut = await run(['revoke', '--data-dir', dir, '--device-id', '00000000-0000-0000-0000-000000000000']);
    expect(revokeOut).toContain('"revoked": true');
  });
});
