# Phase 3 Sync Protocol

## Transport and framing
- Base URL: `https://<relay>` for production; `http://localhost:<port>` for development.
- All requests/responses are JSON with `Content-Type: application/json`.
- Required header: `X-Nodus-Protocol-Version: 1`.
- Required on every sync request:
  - `X-Nodus-Vault-Id: <vaultId>`
  - `X-Nodus-Epoch: <epoch>`
- Authentication: `Authorization: Bearer <token>`.
- Body limit: 1 MiB; request timeout: 30 s.
- Missing identity headers → `400`. Vault/epoch mismatch → `410 BOOTSTRAP_REQUIRED`.

## Authentication endpoints
### `POST /pair`
Public endpoint with a one-time pairing code. Request: `{ pairingCode: string, deviceName: string }`. Response: `{ deviceId, token }`. Token is shown once; hashed at rest.

### `POST /revoke`
Admin-only. Request: `{ deviceId }`. Response: `{ revoked: true }`.

### `GET /devices`
Admin-only. Response: list of devices with ids, names, creation time, last seen.

## Sync endpoints
### `GET /vault`
Returns `{ vaultId, epoch, protocolVersion }`.

### `POST /push`
Request:
```json
{
  "operationId": "<uuid>",
  "deviceSeq": 42,
  "changes": [
    {
      "kind": "note",
      "id": "<uuid>",
      "op": "create|update|move|delete",
      "baseVersion": 3,
      "version": 4,
      "path": "notes/a.md",
      "contentHash": "sha256",
      "content": "..."
    }
  ]
}
```
Response:
```json
{
  "deviceSeq": 42,
  "results": [
    { "id": "<uuid>", "kind": "note", "status": "applied|conflict|rejected", "version": 4, "vaultSeq": 123 }
  ]
}
```
Rules:
- Duplicate `operationId` returns the stored result without mutation.
- `deviceSeq` must be exactly one greater than the device's authoritative high-water mark.
- Stale `baseVersion` returns `conflict`.
- Retired IDs return `rejected`.
- All accepted mutations share one transaction; conflicts/rejections do not abort sibling changes.

### `GET /pull?cursor=<opaque>&limit=<n>&epoch=<epoch>`
Returns ordered changes after `cursor`:
```json
{
  "vaultId": "<uuid>",
  "epoch": 1,
  "cursor": "<opaque>",
  "changes": [ ... ],
  "bootstrapRequired": false
}
```
If the cursor is older than retained history or the `epoch` does not match, `bootstrapRequired: true` and no changes.

### `GET /operations?fromDeviceSeq=<n>&toDeviceSeq=<m>`
Returns stored operation results for the authenticated device, enabling recovery of lost responses:
```json
{
  "operations": [
    { "operationId": "...", "deviceSeq": 42, "results": [ ... ] }
  ]
}
```
Operation IDs are scoped by `(deviceId, operationId)`.

### `GET /device/state`
Returns `{ deviceId, lastSeq, oldestOperationSeq }` for the authenticated device.

### `GET /snapshot?after=<opaque>&limit=<n>`
Returns one deterministic page at a stable `snapshotSeq`:
```json
{
  "vaultId": "...",
  "epoch": 1,
  "cursor": "<opaque>",
  "snapshotSeq": 42,
  "documents": [{ "kind": "note", "id": "...", "path": "notes/a.md", "version": 2, "contentHash": "..." }],
  "nextCursor": "<opaque-or-null>",
  "tombstones": [{ "kind": "note", "id": "...", "deletedAt": "...", "retainedUntil": "..." }],
  "retiredIds": [{ "kind": "note", "id": "..." }]
}
```
- Pages are ordered by `(kind, id)`.
- Tombstones and retired IDs are returned on the first page.
- `nextCursor` is null when complete.
- The client must fetch content through the versioned document endpoint.

### `GET /docs/{kind}/{id}?version=<n>`
Returns `{ kind, id, path, version, contentHash, content }`.
- Version mismatch → `409 STALE_SNAPSHOT` with current version.
- Retired ID → `410 DOCUMENT_RETIRED`.
- Missing ID → `404`.

## Cursor and bootstrap semantics
- Cursor encodes `{ seq, vaultId, epoch }`.
- `seq` is exclusive: a pull returns changes with `vaultSeq > seq`.
- If the cursor's vault/epoch differs, return `BOOTSTRAP_REQUIRED`.
- If `cursor.seq > latestSeq`, return `BOOTSTRAP_REQUIRED`.
- If retained history starts after `cursor.seq + 1`, return `BOOTSTRAP_REQUIRED`.
- If all history is pruned and `cursor.seq < latestSeq`, return `BOOTSTRAP_REQUIRED`.
- A cursor equal to `latestSeq` remains valid after pruning.
- Bootstrap:
  1. fetch snapshot pages at one `snapshotSeq`;
  2. fetch each document by version;
  3. if a document changed or retired during bootstrap, restart bootstrap;
  4. apply tombstones and retired IDs;
  5. persist the snapshot cursor only after the full bootstrap is durably applied.

## Local client state
- Stored outside Markdown at `.nodus/sync.sqlite`.
- Tables: `meta`, `outbox`, `apply_ledger`, `document_state`.
- `deviceSeq` is allocated in the same local transaction as the outbox insert.
- Pull applies one change, commits the apply ledger and document state, then advances the cursor.
- A crash before cursor advance replays the batch; committed apply-ledger entries are no-ops.
- Tokens are not stored in this database; the caller supplies the device token.

## Conflict copies
- Notes: `<stem> (conflict <UTC>-<device8>).md`, new UUID v4.
- Databases: new UUID, `databases/<new-id>.json`, conflict suffix in the name.
- Collisions add `-2`, `-3`, … deterministically.
- Local edits are copied before remote replacement/deletion.
- Retired IDs are never recreated.

## Invariants
1. Document identity is `(kind, id)`.
2. Duplicate operation never creates a second revision.
3. Stale base version never silently overwrites.
4. Cursor never advances past a contiguous applied sequence.
5. Pull retries are idempotent.
6. Missing client state never implies deletion.
7. Epoch mismatch or compacted history forces bootstrap.
8. Retired IDs cannot be reused.
9. Relay mutations are transactionally consistent.
10. No source file is deleted or overwritten outside the intended operation.
11. Operation IDs are scoped per device.
12. Sequence allocation is durable and survives pruning/restart.
13. Conflict copies use fresh UUIDs and deterministic names.
14. Local apply/cursor transitions are durable before cursor advance.
