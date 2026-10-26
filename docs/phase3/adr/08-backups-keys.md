# ADR 08 — Relay Backups and Encryption

## Status
Partially approved; encryption integration blocked. **Encryptor: planned, not implemented** — no `Encryptor` interface or stub exists in `src/`.

## Context
The relay needs recoverable snapshots; vault backups from Phase 2 remain local-only.

## Decision
- Relay snapshots are consistent point-in-time copies of the SQLite database plus the epoch anchor.
- Snapshot creation takes a brief write transaction or serializes the database, then copies to a staging directory.
- Planned, not implemented: encrypted backup integration would use the `age` format behind a narrow interface (`Encryptor`). No such interface or stub exists in `src/` today.
- Backup decryption keys are stored separately from device authentication tokens.
- Vault backups (Phase 2) exclude device tokens, pairing state, and relay operation metadata.
- Backup validation rejects parent symlinks, non-regular files, and path traversal; residual `lstat`→`readFile` TOCTOU is documented honestly.

## Consequences
- No encryptor exists (see Status). Until `age` integration is implemented and approved, relay snapshots are stored unencrypted.
- Restoring a snapshot into a relay increments the epoch and rebuilds the token table only from the snapshot (which excludes live tokens by default).
