/**
 * Vault identity and epoch anchor.
 *
 * The anchor file lives outside the vault backup set (typically next to the
 * relay database). Restoring a backup into a relay must increment the epoch
 * so that stale clients cannot push old changes.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { VaultIdentity } from '../sync/contracts.js';

export interface IdentityAnchor extends VaultIdentity {
  createdAt: string;
  updatedAt: string;
}

export async function loadIdentity(anchorPath: string): Promise<VaultIdentity> {
  const anchor = await loadAnchor(anchorPath);
  return { vaultId: anchor.vaultId, epoch: anchor.epoch };
}

export async function bumpEpoch(anchorPath: string): Promise<VaultIdentity> {
  const current = await loadAnchor(anchorPath);
  const next: IdentityAnchor = {
    ...current,
    epoch: current.epoch + 1,
    updatedAt: new Date().toISOString(),
  };
  await writeAnchor(anchorPath, next);
  return { vaultId: next.vaultId, epoch: next.epoch };
}

async function loadAnchor(anchorPath: string): Promise<IdentityAnchor> {
  let text: string;
  try {
    text = await readFile(anchorPath, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      return createIdentity(anchorPath);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Corrupt vault identity anchor');
  }
  if (!isIdentityAnchor(parsed)) {
    throw new Error('Corrupt vault identity anchor');
  }
  return parsed;
}

async function createIdentity(anchorPath: string): Promise<IdentityAnchor> {
  const now = new Date().toISOString();
  const anchor: IdentityAnchor = {
    vaultId: randomUUID(),
    epoch: 1,
    createdAt: now,
    updatedAt: now,
  };
  await writeAnchor(anchorPath, anchor);
  return anchor;
}

async function writeAnchor(anchorPath: string, anchor: IdentityAnchor): Promise<void> {
  await mkdir(dirname(anchorPath), { recursive: true });
  const temp = `${anchorPath}.tmp.${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(anchor, null, 2)}\n`, 'utf8');
  await rename(temp, anchorPath);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function isIdentityAnchor(value: unknown): value is IdentityAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.vaultId === 'string' &&
    typeof v.epoch === 'number' &&
    Number.isInteger(v.epoch) &&
    v.epoch >= 1 &&
    typeof v.createdAt === 'string' &&
    typeof v.updatedAt === 'string'
  );
}
