# Phase 3 Stage 2 — Relay Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the SQLite-backed personal sync relay with vault identity, device pairing, hashed bearer tokens, and admin HTTP endpoints.

**Architecture:** A Node.js HTTP server uses `node:sqlite` for durable storage. Schema migrations run on startup. Vault identity and epoch are stored in an anchor file next to the database. Authentication uses single-use pairing codes and SHA-256-hashed bearer tokens. All endpoints return structured errors and never log secrets.

**Tech Stack:** TypeScript, Node.js `>=22.12.0`, `node:sqlite`, `node:crypto`, `node:http`, `node:https`, Vitest.

**Spec:** `docs/phase3/README.md`, `docs/phase3/adr/02-relay-storage.md`, `docs/phase3/adr/03-vault-identity.md`, `docs/phase3/adr/07-authentication.md`, `docs/phase3/protocol.md`

## Global Constraints
- Node.js engine `>=22.12.0`; `node:sqlite` is available and verified.
- No new runtime dependencies without explicit approval.
- No Phase 1 formats or Phase 2 storage semantics change.
- Sync metadata lives outside Markdown frontmatter.
- No tokens, pairing codes, note content, titles, or paths in logs.
- Tests use isolated temp directories and clean up after themselves.
- No commits, pushes, or network calls.

## Review Focus
1. **Pairing code reuse / expiry** — a used or expired code must be rejected; tests must exercise both.
2. **Token hashing** — the server must never store or return a raw token twice.
3. **Vault epoch increment on restore** — not yet implemented in Stage 2, but identity manager must expose epoch bump for later stages.
4. **Schema migration idempotency** — starting the relay twice must not corrupt the database.
5. **Rate limiting / bounded payloads** — oversized JSON or rapid pair attempts must be rejected.

## File structure
- `src/sync/contracts.ts` — shared sync types (DocumentId, Change, Operation, etc.).
- `src/relay/contracts.ts` — relay HTTP request/response types and error shapes.
- `src/relay/errors.ts` — RelayError with codes and redaction helpers.
- `src/relay/db.ts` — SQLite DatabaseSync wrapper, migrations, WAL, CRUD helpers.
- `src/relay/identity.ts` — vault id + epoch anchor file read/write/increment.
- `src/relay/auth.ts` — pairing code generation/consumption, token minting/hashing/verification, device revocation.
- `src/relay/rate-limit.ts` — simple in-memory rate limiting for pairing and auth.
- `src/relay/server.ts` — HTTP server, routing, middleware (auth, JSON bounds, request IDs).
- `src/relay/cli.ts` — admin CLI entry point for pair/revoke/health.
- `test/relay/db.test.ts` — migrations, identity, WAL smoke test.
- `test/relay/auth.test.ts` — pairing, token hash, revocation, reuse.
- `test/relay/server.test.ts` — health, vault info, pair, revoke, devices, auth rejection, payload bounds.

## Task 1: Sync and relay contracts
**Files:**
- Create: `src/sync/contracts.ts`
- Create: `src/relay/contracts.ts`
- Create: `src/relay/errors.ts`
- Test: `test/relay/contracts.test.ts` (types compile, error construction)

**Interfaces:**
- Produces: `DocumentRef`, `ChangeRecord`, `PushRequest`, `PushResult`, `PullResponse`, `VaultInfo`, `PairRequest`, `PairResponse`, `RelayError`, `RelayErrorCode`.

- [ ] Step 1: Write types matching the protocol invariants (no implementation beyond interfaces).
- [ ] Step 2: Run `npm run typecheck`; expected PASS.

## Task 2: SQLite relay repository
**Files:**
- Create: `src/relay/db.ts`
- Test: `test/relay/db.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `RelayDatabase` class with `open(path)`, `close()`, `migrate()`, `exec(sql)`, `prepare(sql)`, and typed helpers for `devices`, `pairing_codes`, `vault_meta`, `documents`, `change_log`.

- [ ] Step 1: Write failing migration test expecting tables to exist after `RelayDatabase.open(tmpFile)`.
- [ ] Step 2: Implement `RelayDatabase` using `DatabaseSync`, WAL, versioned migrations table.
- [ ] Step 3: Run `npm test test/relay/db.test.ts`; expected PASS.

## Task 3: Vault identity and epoch
**Files:**
- Create: `src/relay/identity.ts`
- Test: `test/relay/identity.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `VaultIdentity { vaultId, epoch }`, `loadIdentity(anchorPath)`, `bumpEpoch(anchorPath)`.

- [ ] Step 1: Write tests for missing anchor (creates new identity), existing anchor (loads), and bumpEpoch.
- [ ] Step 2: Implement identity manager with JSON anchor file and atomic write/rename.
- [ ] Step 3: Run tests; expected PASS.

## Task 4: Authentication
**Files:**
- Create: `src/relay/auth.ts`
- Create: `src/relay/rate-limit.ts`
- Test: `test/relay/auth.test.ts`

**Interfaces:**
- Consumes: `RelayDatabase` (for device/token/pairing_code tables).
- Produces: `AuthService` with `generatePairingCode()`, `pair(code, deviceName)`, `revoke(deviceId)`, `verifyToken(token)`, `hashToken(token)`.

- [ ] Step 1: Write tests for code generation, pair success, reused code rejection, expiry, token verification, revocation, unknown token rejection.
- [ ] Step 2: Implement auth service using `randomBytes` and SHA-256 hashing; rate-limit pairing attempts.
- [ ] Step 3: Run tests; expected PASS.

## Task 5: HTTP server and admin endpoints
**Files:**
- Create: `src/relay/server.ts`
- Create: `src/relay/cli.ts`
- Test: `test/relay/server.test.ts`

**Interfaces:**
- Consumes: `RelayDatabase`, `AuthService`, `VaultIdentity`, `RelayError`.
- Produces: `createRelayServer(options)`, server handles `GET /health`, `GET /vault`, `POST /pair`, `POST /revoke`, `GET /devices`; returns JSON; redacts errors.

- [ ] Step 1: Write tests for health, vault info, successful pair, pair with bad code, revoke, list devices, missing auth, invalid JSON, oversized payload.
- [ ] Step 2: Implement HTTP server with bounded JSON parsing, request IDs, and structured error responses.
- [ ] Step 3: Implement minimal CLI wrapper parsing `pair`/`revoke`/`health` subcommands.
- [ ] Step 4: Run full suite; expected all 206 existing tests + new relay tests PASS.

## Task 6: Integration and reporting
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Inspect diff for unrelated changes.
- [ ] Report Stage 2 completion, remaining risks, and Stage 3 prerequisites.
