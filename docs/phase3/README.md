# Nodus Phase 3 — Personal Cross-Device Sync

## Goal
Add secure, local-first, personal cross-device synchronization to Nodus while preserving Phase 1 note/database formats and Phase 2 storage, import/export, and backup behavior.

## Scope (in)
- A personal sync relay backed by SQLite.
- Device pairing and per-device bearer-token authentication.
- Revisioned, idempotent sync protocol with explicit conflicts.
- Crash-safe CLI sync client with durable outbox and apply ledger.
- Tombstones, retired-ID ledger, and safe restore epochs.
- Consistent relay snapshots and a pluggable encrypted-backup interface.

## Scope (out)
- Multi-tenant accounts or public content endpoints.
- CRDTs, automatic merge, or a web editor.
- Custom cryptography, request-signing schemes, refresh-token families, passkeys, or remote recovery.
- VPS/hosting deployment beyond TLS/private-overlay documentation.
- Telemetry, analytics, AI, or hidden network calls.

## High-level topology
```
┌─────────┐  HTTPS/private overlay  ┌──────────────┐  same  ┌─────────┐
│ Client A│◄───────────────────────►│ Personal relay│◄──────►│ Client B│
└─────────┘                         └──────────────┘        └─────────┘
```
- One relay per person/vault.
- The relay is the source of truth for versioned metadata; clients retain authoritative local files.
- All transport is over TLS or a private overlay; localhost development uses plain HTTP only.

## Document set
- `adr/` — architecture decision records
- `protocol.md` — wire protocol and invariants
- `threat-model.md` — assets, threats, mitigations
- `acceptance-tests.md` — required test coverage
- `roadmap.md` — implementation stages

## Decisions already approved
- Runtime: Node.js `>=24.0.0` with built-in `node:sqlite` (verified on 24.0.0; experimental warning remains; 22.12.0 requires `--experimental-sqlite`).
- Sync metadata is stored outside Markdown frontmatter and outside the vault files.
- Document identity remains `(kind, id)`; titles and paths are not identities.
- Conflicts create a new note/database with a fresh UUID, never silently overwrite.
- Tombstone retention: 90 days default, configurable upward, minimum 30 days.
- Retired-ID ledger retained indefinitely.
- Backup encryption format: `age` (to be integrated behind an interface once approved).

## Decisions still blocked
- Whether to ship `age` as a runtime dependency or keep it behind an optional CLI path.
- OS keychain integration vs. permission-restricted credential file as the default.
