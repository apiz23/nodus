import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bumpEpoch, loadIdentity } from '../../src/relay/identity.js';

describe('vault identity', () => {
  it('creates a new identity when the anchor is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nodus-id-'));
    const anchor = join(dir, 'anchor.json');
    const identity = await loadIdentity(anchor);
    expect(identity.epoch).toBe(1);
    expect(identity.vaultId).toMatch(/^[0-9a-f]{8}-/);
  });

  it('loads an existing identity', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nodus-id-'));
    const anchor = join(dir, 'anchor.json');
    const first = await loadIdentity(anchor);
    const second = await loadIdentity(anchor);
    expect(second.vaultId).toBe(first.vaultId);
    expect(second.epoch).toBe(first.epoch);
  });

  it('bumps the epoch atomically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nodus-id-'));
    const anchor = join(dir, 'anchor.json');
    const first = await loadIdentity(anchor);
    const bumped = await bumpEpoch(anchor);
    expect(bumped.vaultId).toBe(first.vaultId);
    expect(bumped.epoch).toBe(first.epoch + 1);
    const reloaded = await loadIdentity(anchor);
    expect(reloaded.epoch).toBe(bumped.epoch);
  });

  it('rejects a corrupt anchor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nodus-id-'));
    const anchor = join(dir, 'anchor.json');
    const fs = await import('node:fs/promises');
    await fs.writeFile(anchor, '{ not json', 'utf8');
    await expect(loadIdentity(anchor)).rejects.toThrow('Corrupt vault identity anchor');
  });
});
