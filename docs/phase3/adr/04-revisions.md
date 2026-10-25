# ADR 04 — Revisions, Sequences, and Idempotency

## Status
Approved

## Context
Sync requires deterministic ordering, stale-write detection, and safe retries.

## Decision
- Each document has a per-document monotonic `version` (integer) and a SHA-256 `contentHash`.
- The relay maintains a single vault-wide monotonic `vaultSeq` within an epoch.
- Every accepted mutation creates one change-feed row with `vaultSeq`, document identity, baseVersion, resulting version, contentHash, and operation type.
- Each device has its own monotonic `deviceSeq`; the relay stores the authoritative high-water mark and returns an `operationId` + result for every push.
- Clients send an idempotency key (`operationId`) with each push; duplicate keys return the previously stored result without a second mutation.
- Pull endpoints return changes ordered by `vaultSeq` with an opaque cursor derived from the last returned sequence.

## Consequences
- A stale `baseVersion` is rejected explicitly with a conflict error, never silently last-write-wins.
- Lost responses can be recovered via the operation-results endpoint.
- A device-sequence gap is resolved by fetching operation results for the missing range; if pruned, the client bootstraps.
