# Phase 3 Implementation Roadmap

## Stage 0 — Gates (done)
- Verified Node.js `>=24.0.0` and unflagged `node:sqlite` (experimental warning remains); Node 22.12.0 requires `--experimental-sqlite`.
- Baseline tests/typecheck pass (206 tests).

## Stage 1 — Planning (done)
- Created `docs/phase3/` README, ADRs, protocol, threat-model, acceptance-tests, roadmap.

## Stage 2 — Relay foundation
- Sync contracts (`src/sync/contracts.ts`).
- SQLite relay repository with migrations (`src/relay/db.ts`).
- Vault identity/epoch manager (`src/relay/identity.ts`).
- Pairing, token hashing, revocation (`src/relay/auth.ts`).
- HTTP server, endpoints, rate limiting, structured errors, logging (`src/relay/server.ts`).
- Admin CLI for pair/revoke/health (`src/relay/cli.ts`).
- Tests for auth, device lifecycle, health endpoints.

## Stage 3 — Correct sync protocol (complete)
- Document/version repository and change feed.
- Push/pull/operations/snapshot endpoints.
- Conditional writes, idempotency, tombstones, retired-ID ledger.
- Transactional mutation pipeline.
- Tests for duplicate push, lost response, stale version, retired ID, compaction, path collisions, rollback, restart.

## Stage 4 — CLI sync client
- Pair command and token storage (credential file with warnings).
- Outbox, apply ledger, conflict-copy naming.
- Pull/apply with crash recovery and cursor safety.
- Startup scan, filesystem watcher, reconciliation.
- Tests for crash injection and concurrent local edits.

## Stage 5 — Conflicts and restore safety
- Conflict policies for edit/edit, edit/delete, move conflicts, database conflicts.
- Tombstone compaction and bootstrap-required detection.
- Restore epoch increment and anchor handling.
- Tests for repeated restores and missing anchor.

## Stage 6 — Backups and operational recovery
- Consistent relay snapshots.
- Encrypted backup interface (`age` stub).
- Backup validation hardening and platform-aware tests.
- Restore runbook and operational documentation.
