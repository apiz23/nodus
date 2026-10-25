# ADR 03 — Vault Identity and Epoch

## Status
Approved

## Context
A vault must have a stable identity across restores, and a restore must not silently resurrect deleted state or allow old devices to push stale changes.

## Decision
- Each vault has a `vaultId` (UUID v4) and a monotonically increasing `epoch` (positive integer).
- The `(vaultId, epoch)` pair is the authoritative generation of the relay.
- A small `epoch-anchor` file is stored outside the vault backup set (e.g., next to the relay database or in a separate config directory).
- Restoring a vault backup into a relay increments the epoch beyond any previously authoritative epoch.
- If the epoch anchor is missing or corrupt, the relay mints a new vault identity and requires all clients to bootstrap.

## Consequences
- Old relay backups restored repeatedly produce a higher epoch each time, preventing stale clients from pushing.
- Clients must compare `(vaultId, epoch)` on every sync and bootstrap when the pair changes or the cursor is too old.
- The epoch anchor must never be restored from a vault backup.
