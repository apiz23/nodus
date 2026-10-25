/**
 * SQLite relay database.
 *
 * Uses Node.js built-in `node:sqlite` (sync API). All migrations run inside a
 * transaction on first open. WAL mode is enabled for crash recovery and
 * concurrent readers.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        appliedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vault_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devices (
        deviceId TEXT PRIMARY KEY,
        deviceName TEXT NOT NULL,
        tokenHash TEXT NOT NULL UNIQUE,
        createdAt TEXT NOT NULL,
        lastSeenAt TEXT
      );

      CREATE TABLE IF NOT EXISTS pairing_codes (
        codeHash TEXT PRIMARY KEY,
        deviceName TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        path TEXT NOT NULL,
        version INTEGER NOT NULL,
        contentHash TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        vaultSeq INTEGER NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );

      CREATE TABLE IF NOT EXISTS change_log (
        vaultSeq INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        op TEXT NOT NULL,
        baseVersion INTEGER NOT NULL,
        version INTEGER NOT NULL,
        path TEXT NOT NULL,
        previousPath TEXT,
        contentHash TEXT NOT NULL,
        content TEXT,
        epoch INTEGER NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_change_log_id ON change_log(kind, id);

      CREATE TABLE IF NOT EXISTS retired_ids (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        retiredAt TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );

      CREATE TABLE IF NOT EXISTS tombstones (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        deletedAt TEXT NOT NULL,
        retainedUntil TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );

      CREATE TABLE IF NOT EXISTS operations (
        operationId TEXT PRIMARY KEY,
        deviceId TEXT NOT NULL,
        deviceSeq INTEGER NOT NULL,
        resultJson TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS device_sequences (
        deviceId TEXT PRIMARY KEY,
        deviceSeq INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS operations_v2 (
        operationId TEXT NOT NULL,
        deviceId TEXT NOT NULL,
        deviceSeq INTEGER NOT NULL,
        resultJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (deviceId, operationId),
        UNIQUE (deviceId, deviceSeq)
      );

      INSERT OR IGNORE INTO operations_v2 (operationId, deviceId, deviceSeq, resultJson, createdAt)
        SELECT operationId, deviceId, deviceSeq, resultJson, createdAt FROM operations;

      DROP TABLE operations;
      ALTER TABLE operations_v2 RENAME TO operations;
    `,
  },
];

interface Migration {
  version: number;
  sql: string;
}

export class RelayDatabase {
  private db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(path: string): RelayDatabase {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA journal_mode = WAL;');
    const relay = new RelayDatabase(db);
    relay.migrate();
    relay.initializeVaultMeta();
    return relay;
  }

  close(): void {
    this.db.close();
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return this.db.prepare(sql);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  /** Durable next vault sequence. Never derive allocation from remaining change rows. */
  getNextVaultSeq(): number {
    const row = this.db
      .prepare("SELECT value FROM vault_meta WHERE key = 'next_seq'")
      .get() as { value: string } | undefined;
    const value = row === undefined ? Number.NaN : Number.parseInt(row.value, 10);
    if (!Number.isInteger(value) || value < 1) {
      return this.maxExistingVaultSeq() + 1;
    }
    return value;
  }

  setNextVaultSeq(next: number): void {
    if (!Number.isInteger(next) || next < 1) {
      throw new Error('next vault sequence must be a positive integer');
    }
    this.db
      .prepare(
        "INSERT INTO vault_meta (key, value) VALUES ('next_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(String(next));
  }

  private initializeVaultMeta(): void {
    this.transaction(() => {
      const max = this.maxExistingVaultSeq();
      const row = this.db
        .prepare("SELECT value FROM vault_meta WHERE key = 'next_seq'")
        .get() as { value: string } | undefined;
      const current = row === undefined ? 0 : Number.parseInt(row.value, 10);
      if (!Number.isInteger(current) || current <= max) {
        this.setNextVaultSeq(max + 1);
      }
    });
  }

  private maxExistingVaultSeq(): number {
    const row = this.db
      .prepare(
        `SELECT MAX(seq) AS seq FROM (
           SELECT MAX(vaultSeq) AS seq FROM change_log
           UNION ALL
           SELECT MAX(vaultSeq) AS seq FROM documents
         )`,
      )
      .get() as { seq: number | null } | undefined;
    return row?.seq ?? 0;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        appliedAt TEXT NOT NULL
      );
    `);

    const current = this.currentVersion();
    if (current >= Math.max(...MIGRATIONS.map((migration) => migration.version))) return;

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const migration of MIGRATIONS) {
        if (migration.version <= current) continue;
        this.db.exec(migration.sql);
        const insert = this.db.prepare(
          'INSERT INTO schema_migrations (version, appliedAt) VALUES (?, ?)',
        );
        insert.run(migration.version, new Date().toISOString());
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Preserve the original migration failure.
      }
      throw error;
    }
  }

  private currentVersion(): number {
    try {
      const row = this.db
        .prepare('SELECT MAX(version) as version FROM schema_migrations')
        .get() as { version: number | null } | undefined;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }
}
