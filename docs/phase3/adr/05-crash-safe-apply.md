# ADR 05 — Crash-Safe Local Apply

## Status
Approved

## Context
The CLI client must apply remote changes to local files without losing data if the process crashes mid-operation.

## Decision
- The client keeps a durable apply ledger (SQLite or JSONL) recording each intended change, reserved conflict-copy UUID/path, and cursor state.
- Before touching files, the client writes an apply-intent row.
- File writes use the existing Phase 2 atomic temp-file + rename pattern.
- The cursor advances only after every change through that contiguous `vaultSeq` has been durably applied and recorded.
- If local edits are detected during remote apply, the local content is preserved as a conflict copy with a new UUID before the remote change is written.
- On startup, the client replays the apply ledger to complete or roll back interrupted operations, then performs a full content-hash scan and reconciles with the relay.

## Consequences
- A crash between intent and rename, or between rename and ledger commit, is recoverable.
- Conflict-copy creation is idempotent: replaying the ledger reuses the reserved UUID/path.
- Missing or corrupt local sync metadata triggers recovery/bootstrap, never inferred deletions.
