# ADR 06 — Conflicts and Tombstones

## Status
Approved

## Context
Concurrent edits must not silently overwrite each other, and deleted IDs must not be reused.

## Decision
- **Edit/edit:** The losing side is preserved as a conflict copy with a new UUID and a deterministic path suffix (`conflict-<utc>-<device>` with collision-safe numeric suffixes).
- **Edit/delete:** Local edits are preserved as a conflict copy; the deletion proceeds unless the user resolves otherwise.
- **Move conflicts:** Conditional moves reject occupied or case/NFC-colliding destinations with `CONFLICT`.
- **Database conflicts:** Rejected for manual resolution; never auto-merged.
- **Tombstones:** Stored on the relay with a `retainedUntil` timestamp. Default retention 90 days, minimum 30 days, configurable upward.
- **Retired IDs:** Every deleted document ID is added to a permanent retired-ID ledger. Any future create/edit/move referencing a retired ID is rejected and, if it originated locally, preserved as a conflict copy.
- A pull cursor older than retained tombstone history returns `BOOTSTRAP_REQUIRED`.

## Consequences
- Users may accumulate conflict copies; resolution is manual in the MVP.
- Relay storage grows with tombstones and retired IDs, but bounded by retention policy.
