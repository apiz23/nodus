import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RelayDatabase } from '../../src/relay/db.js';

async function tmpDb(): Promise<{ db: RelayDatabase; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'nodus-relay-db-'));
  const path = join(dir, 'relay.sqlite');
  const db = RelayDatabase.open(path);
  return { db, path };
}

describe('RelayDatabase', () => {
  it('creates the schema on first open', async () => {
    const { db } = await tmpDb();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('schema_migrations');
    expect(names).toContain('vault_meta');
    expect(names).toContain('devices');
    expect(names).toContain('pairing_codes');
    db.close();
  });

  it('records applied migrations', async () => {
    const { db } = await tmpDb();
    const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: number;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.version).toBe(1);
    db.close();
  });

  it('is idempotent on repeated open', async () => {
    const { db, path } = await tmpDb();
    db.close();
    const second = RelayDatabase.open(path);
    const rows = second.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: number;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    second.close();
  });

  it('enables WAL mode and a busy timeout', async () => {
    const { db } = await tmpDb();
    const mode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    const timeout = db.prepare("PRAGMA busy_timeout").get() as { timeout: number };
    expect(mode.journal_mode.toLowerCase()).toBe('wal');
    expect(timeout.timeout).toBe(5000);
    db.close();
  });

  it('seeds and persists the next vault sequence', async () => {
    const { db, path } = await tmpDb();
    expect(db.getNextVaultSeq()).toBe(1);
    db.setNextVaultSeq(42);
    db.close();

    const reopened = RelayDatabase.open(path);
    expect(reopened.getNextVaultSeq()).toBe(42);
    reopened.close();
  });

  it('reconciles a missing sequence from existing document state', async () => {
    const { db, path } = await tmpDb();
    db.exec(`
      INSERT INTO documents (kind, id, path, version, contentHash, content, vaultSeq, updatedAt)
      VALUES ('note', '11111111-1111-4111-8111-111111111111', 'notes/a.md', 1, 'hash', 'body', 7, '2026-10-25T12:00:00Z')
    `);
    db.exec("DELETE FROM vault_meta WHERE key = 'next_seq'");
    db.close();

    const reopened = RelayDatabase.open(path);
    expect(reopened.getNextVaultSeq()).toBe(8);
    reopened.close();
  });
});

