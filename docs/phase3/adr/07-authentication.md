# ADR 07 — Device Authentication

## Status
Approved

## Context
Only the owner's devices may access the relay.

## Decision
- Pairing uses short, expiring, single-use, rate-limited pairing codes.
- A successful pair returns a 256-bit cryptographically random bearer token, shown once to the client and hashed (SHA-256) at rest.
- Tokens are scoped to the vault and device; revocation removes the token row and any active sessions.
- Transport uses TLS or a private overlay; tokens are sent in an `Authorization: Bearer <token>` header, never in URLs.
- No refresh-token families, custom request signing, passkeys, or remote recovery in the MVP.

## Consequences
- A lost token cannot be recovered; revoke it and pair a new device.
- Pairing codes must be delivered out-of-band (displayed on the relay console/CLI).
- Logs must never contain tokens, pairing codes, note content, titles, or paths.
