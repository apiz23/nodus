# Phase 3 Threat Model

## Assets
- Vault content (notes, database definitions).
- Sync metadata (versions, operation history, device sequences).
- Authentication credentials (pairing codes, bearer tokens).
- Epoch anchor and relay configuration.

## Threats and mitigations
| Threat | Mitigation |
|---|---|
| Unauthorized relay access | Pairing codes + 256-bit bearer tokens, TLS/private overlay, token hashing at rest, revocation. |
| Replay of old operations | Per-device `deviceSeq` and idempotency keys; duplicate keys return stored results. |
| Stale write overwrites newer content | Conditional writes with `baseVersion`; conflicts create new documents. |
| Deleted ID resurrected | Permanent retired-ID ledger rejects re-use. |
| Relay database tampering | SHA-256 content hashes, epoch anchor outside backups, snapshot validation. |
| Backup symlink/path traversal | `lstat` validation, reject symlinks/junctions/non-regular files, path containment. |
| Token/credential leakage | Tokens shown once, never logged, never in URLs; logs content-free. |
| Crash leaves inconsistent local state | Apply ledger, atomic file writes, cursor only after durable apply. |
| Compromised backup restores old epoch | Restore increments epoch; missing anchor mints new vault identity. |

## Out of scope
- Protection against a fully compromised client (client sees vault content).
- E2EE unless separately designed and approved.
- VPS/public-cloud hosting without TLS/private overlay.
- Multi-user access control.

## Residual risks
- `lstat`→`readFile` TOCTOU in backup validation (low, deterministic exploit blocked).
- Concurrent local writers without file locking (Medium, unchanged from Phase 2).
