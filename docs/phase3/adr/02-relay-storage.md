# ADR 02 — Relay Storage and Runtime

## Status
Approved

## Context
The relay needs durable, transactional storage for documents, change feed, operation results, device sequences, and authentication state.

## Decision
- Use the built-in Node.js `node:sqlite` module.
- Run SQLite in WAL mode (`PRAGMA journal_mode=WAL`) for concurrent readers and crash recovery.
- Schema is versioned; startup runs idempotent migrations in a transaction.
- Backup of the relay database is performed via file copy while holding a brief write transaction, or via SQLite serialization; online backup is not required for the MVP.
- All relay mutations run inside a single SQLite transaction so that document state, change-log entry, operation result, and device sequence are committed atomically.

## Consequences
- No extra native dependency for the core relay.
- `node:sqlite` is verified on Node.js `>=24.0.0` (experimental warning remains); Node 22.12.0 requires `--experimental-sqlite`.
- WAL requires the `.wal` and `.shm` files to travel with the main database during manual copy.
