# Phase 31 — Automation & Workflow Engine

**Status:** Phase 31A scope and product decisions are approved. The Phase 31B implementation breakdown is approved as a plan, but implementation is **not authorized**. Phase 12 remains the only implemented automation engine. Do not infer runtime support or platform support from this design.

This document records Phase 12 behavior, the approved Phase 31 contract, and the implementation gates. It does not change source formats or runtime behavior.

## 1. Phase 12 capability inventory

Phase 12 provides local, declarative database automations:

- Strict version 1 JSON definitions in `.nodus-automations/automations.json`, with UUID identities, database ID, trigger, AND conditions, and one to twenty ordered actions.
- Triggers for record creation, watched-property updates, record deletion, and entering a matching condition.
- Set/clear property, update date, and set checkbox actions. Relation assignment is partly understood by the validator but relation-property actions are excluded from Phase 31.
- Enabled automations are database-scoped, sorted by automation UUID, and run in saved action order. Internal action writes do not recursively emit automation events.
- Event execution is synchronous in the local API request path. There is no scheduler, background worker, network action, or arbitrary-code execution.
- Each action is revalidated and written through the structured property API. Writes are individually revision-checked, root-locked, and atomically published. An action list is not a transaction: successful earlier actions remain if a later action fails.
- History v1 claims `(eventId, automationId)` and suppresses duplicate observations. It records a completed-action count and bounded error, not an immutable plan or per-action result ledger.
- API history listing is limited to 200 results; persisted history is currently append-only and unbounded.
- An interrupted `running` entry is not replayed because some actions may already have been applied.

Evidence: `src/database/automations.ts`, `src/storage/contracts.ts`, `src/storage/fs/layout.ts`, `src/storage/fs/root-lock.ts`, `src/storage/fs/atomic.ts`, `src/storage/fs/vault.ts`, `src/ui-server/api.ts`, `ui/src/DatabaseAutomations.tsx`, `docs/database-automations.md`, `docs/storage.md`, `src/storage/backup/backup.ts`, and `src/storage/portable/{export,import}.ts`. Focused tests are in `test/database-automations.test.ts` and `test/database-automations-api.test.ts`.

## 2. Approved Phase 31 scope and decisions

Phase 31 extends the Phase 12 database-scoped, event-driven, local workflow behavior with a versioned execution journal and explicit failure diagnostics. Execution remains synchronous in the API request path. Best-effort event delivery is accepted: a crash after the source-record write but before journal creation can cause the automation event to be missed. Phase 31 does not promise exactly-once event delivery or exactly-once side effects.

| Area | Approved contract |
|---|---|
| Scope | One database per workflow and event; no cross-database actions. |
| Execution | Local and event-driven; synchronous request path. No scheduler or background worker. |
| Actions | Declarative, schema-validated local property writes only. No scripts, arbitrary JavaScript, plugins, network, cloud, accounts, or collaboration. Relation-property actions are deferred. |
| Source-event delivery | Best effort. The source write may succeed while a crash before journal creation loses the event. No outbox is in Phase 31B. |
| Event identity | New source mutations receive a server-generated random identity. It is carried in the event and persisted before automation side effects. Clients cannot supply or authorize it. Phase 12 history identities remain legacy keys during migration. |
| Interruption | An interrupted run becomes `needs_review` only after the executor lock proves the prior owner no longer holds execution ownership. No resume, automatic retry, replay, or compensation. |
| Failure | Preserve confirmed prior action effects; stop after a known action failure and report the successful prefix and failed action. Ambiguous outcomes require review. |
| Retention | Keep latest 200 terminal details; compact older `succeeded` and `failed` details to receipts. Preserve unresolved runs. Receipts are retained indefinitely initially. |
| Durability | Atomic rename is not universal power-loss durability. Journal persistence failures required for the process-crash contract stop execution before action side effects. |

### Approved execution limits

| Limit | Maximum | On exceedance |
|---|---:|---|
| Matching automations per event | 20 | Reject the entire event before any automation action; record a bounded diagnostic if journal storage is available. |
| Actions per automation | 20 | Preserve the existing definition limit; reject invalid definitions before execution. |
| Total actions per event | 100 | Reject the entire event before any action. Do not partially run the first 100. |
| Serialized event-operation journal record | 1 MiB | Reject before side effects; do not truncate the plan. |
| Cooperative execution budget | 10 seconds | Check between actions; after an in-flight operation returns, persist its known outcome and stop before the next action. Record a partial failure when the budget is exceeded. |

The 10-second budget is cooperative, not a hard real-time guarantee. Filesystem operations and sync calls may block and cannot safely be cancelled at an arbitrary point. Therefore the lock can be held longer than 10 seconds if an individual operation stalls; measure and report lock duration.

## 3. Executor ownership and locking contract

The approved design is a native Node-API lock adapter using POSIX `flock` on macOS/Linux and Windows `LockFileEx` on a fixed byte range. The lock is held for the complete event execution, including journal transitions and final state persistence. The same exclusive lock prevents a second Nodus executor from running concurrently for that vault. Vault mutations continue through the existing root-lock coordinator; extend/reuse its scoped operation surface instead of adding a competing Nodus writer lock.

The executor lock file is the persistent regular vault-root file `.nodus-automation-executor.lock`, kept outside the strict `.nodus-automations/` resource inventory. It is excluded from backup/portable resource contents; portable export may report it as an excluded unsupported file. Do not unlink or replace it while processes may hold locks. Lock ownership is the authority; timestamps, heartbeats, hostname, and PID metadata are diagnostic only.

Initial target filesystems are macOS/APFS, Linux/ext4/XFS/Btrfs, and Windows/NTFS. This is a proposed target matrix, not a current support claim. A platform/filesystem becomes supported only after the lock contention, process-termination, restart, and relevant durability tests pass there. Network filesystems, cloud-synced folders, removable filesystems, and any unsupported or uncertain locking backend fail closed: do not execute actions and do not classify an existing run as interrupted.

| Liveness result | Evidence | Behavior |
|---|---|---|
| Active/owned | Kernel reports the exclusive executor lock is held | Do not recover or mutate the run. “Active” means ownership remains held; it does not claim the process is scheduled at that instant. |
| Inactive | A new process successfully acquires the lock on a tested filesystem | Prior executor no longer owns the lock; classify interrupted work as `needs_review`, never resume it. |
| Uncertain | Unsupported filesystem/backend, unexpected lock error, or inconsistent metadata | Fail closed. Preserve the journal state and expose an unresolved diagnostic. |

The existing `.nodus-vault-write.lock` can remain after process termination and has a documented manual recovery procedure. Phase 31 must not remove it automatically. If it blocks opening the vault, use the documented writer-quiescence and exact-lock recovery procedure before journal classification. Legacy Phase 12 processes do not use the new executor lock; migration therefore requires those processes to be quiescent.

## 4. Versioned journal and execution contract

### Record layout

Use one event-operation file so all eligible automation plans and their ordering are persisted before any action. The file holds per-automation run states and action progress, and can later be compacted to a receipt without losing dedupe identities.

```text
.nodus-automations/
  automations.json
  history.json                 # legacy Phase 12 v1, retained during migration
  journal/
    events/<event-id>.json     # strict versioned event operation or compact receipt
    migration-v1.json          # written only after legacy receipt coverage verifies
```

Each strict record includes: format and version; server-generated event/source-mutation identity; database, record, trigger, and source revision/hash; schema hash; automation IDs sorted by UUID; each definition hash and frozen ordered action plan; plan hash; event/run states; per-action IDs, intent, expected revision, known outcome, result revision/hash, and bounded diagnostic; timestamps and monotonic record revision. Exact keys, IDs, paths, string/array sizes, record size, and state transitions must be validated. A plan cannot change after `prepared`.

The operation record is the dedupe authority. Its key includes event identity and automation identity. A compact receipt retains those identities, terminal classification, timestamp, and plan/outcome digest while removing detail. No client-supplied ID or plan authorizes execution.

### Run states and transitions

| State | Allowed transition | Meaning |
|---|---|---|
| `prepared` | `running`, `needs_review` | Whole event plan is persisted; no automation side effect has started. |
| `running` | `succeeded`, `failed`, `needs_review` | Actions execute in deterministic order with durable intent/outcome. |
| `succeeded` | none | Every planned action has a confirmed successful outcome. |
| `failed` | none | Known failure stopped later actions; prior confirmed actions remain applied. |
| `needs_review` | none in Phase 31B | Interruption or ambiguous effects need inspection. The run is never resumed automatically. |

Preflight validation failures are recorded as terminal failures with no action effects. Legacy `skipped` remains readable in history v1; nonmatching events do not create new run records. There is no `cancelled` state: a disconnected client is not a safe cancellation signal.

### Persistence order

1. Acquire executor ownership and the coordinated vault write session.
2. Reread source revision, schema, and definitions; build and validate every matching plan and enforce all limits before any action.
3. Persist the complete `prepared` event record and confirm all required journal writes before proceeding.
4. Persist `running`.
5. For each action in automation UUID/action-array order: persist intent; perform a revision-checked property write; persist the confirmed outcome and resulting revision/hash.
6. Persist terminal `succeeded` or `failed`; if the outcome or executor state is ambiguous, classify as `needs_review` only after lock-based inactivity is established.
7. Release the vault session and executor lock.

If a property write succeeds but the process stops before persisting its result, the action is ambiguous. A matching property value/hash is diagnostic only, not proof that the automation owned the write. Mark the run `needs_review`; never retry, replay, or roll back automatically. This is not exactly-once execution.

## 5. Atomic-write and durability contract

`src/storage/fs/atomic.ts` writes a temporary sibling, syncs the temporary file, closes it, renames it over the destination, then attempts to sync the parent directory. Parent-directory sync errors are swallowed; Windows skips that step. Same-directory rename gives atomic visibility on filesystems that implement it, but the implementation does not guarantee rename persistence through power loss on every platform/filesystem.

For Phase 31, a failure to create, write, sync, validate, or rename a required journal record is fatal before automation side effects. Directory sync remains platform-dependent; failures must be surfaced as a durability warning/state, not described as power-loss-safe. If a platform cannot meet the required process-crash journal contract, fail closed and do not execute automations there. Even where tests pass, do not claim universal power-loss durability, hardware-cache flush guarantees, or coordination with external writers.

## 6. Retention and compaction

- Retain the latest 200 terminal details (`succeeded` and `failed`) per vault.
- Compact older terminal details into receipts; do not delete their dedupe identity.
- Never compact `prepared`, `running`, or `needs_review` records. Preserve unresolved details until a separately approved user-facing archive/removal policy exists.
- Compact in bounded batches under the vault write lock. Each atomic replacement must leave either the detailed record or a receipt with the same dedupe identity.
- Retain receipts indefinitely initially. The content-derived Phase 12 IDs are not a formal unique mutation sequence; new server-generated mutation IDs avoid conflating repeated transitions, but no replay horizon is approved. Indefinite receipt retention is the conservative initial policy and has unbounded small-record growth.

## 7. Migration, backup, and portable compatibility

- Keep `automations.json` v1 unchanged. Do not silently rewrite automation definitions.
- Preserve each v1 history `(eventId, automationId)` as a legacy receipt without changing its identity. Do not invent missing plans or action outcomes.
- Migration is idempotent: hash and validate history v1, create/verify receipts, then write a completion marker containing source hash and count. On interruption, rerun from the unchanged source. Do not delete history v1 in Phase 31B.
- Legacy `running` entries have no executor identity or plan. Quiesce all legacy Nodus processes before migrating them to `needs_review`; otherwise block migration and keep them inert.
- New backup support adds a versioned journal resource in a new backup manifest version (proposed v8); continue reading backup versions 1–7 unchanged.
- Portable export/import adds a journal format/resource version while retaining reads for the existing portable format. Import validates path, type, size, hash, IDs, and exact schema; reject symlinks and traversal.
- Imported `prepared` or `running` records are inert and become `needs_review` with their source state retained as provenance. Restore/import never triggers automation execution.

## 8. Phase 31B implementation breakdown

The B.1–B.5 packages are implementation-ready work packages, not authorization to start. Dependencies are sequential unless evidence supports parallel documentation-only work. Every package must preserve Phase 12 definition and trigger semantics except for the approved, visible execution-limit rejection behavior. No Phase 12 action may silently execute under a weaker fallback when Phase 31 locking or journal durability is unavailable.

### Phase 31B.1 — Executor Ownership & Locking

**Scope:** Build the Node-API lock adapter for POSIX `flock` and Windows `LockFileEx`; implement persistent lock-file handling, in-process queueing, active/inactive/uncertain results, and safe integration with the existing vault root-lock session. Do not use timeouts, heartbeats, or PID metadata to infer inactivity.

**Likely files/modules:** `src/storage/fs/root-lock.ts`; new executor-lock module under `src/storage/fs/`; native Node-API source/build packaging; `package.json` and lockfile only if required; storage lock documentation; focused `test/storage-*-lock.test.ts` and platform test harness.

**Dependencies:** Approved product lock strategy; verified Node-API toolchain and CI runners for macOS/APFS, Linux/local ext4-class, and Windows/NTFS. Confirm lock files are regular files, stable inodes, and not exported as user data.

**Acceptance criteria:** Two Nodus processes cannot own the same vault execution lock; the owner retains it through terminal journal persistence; process termination releases kernel ownership; uncertain errors fail closed; unsupported filesystems never start actions; ordinary Nodus writers share the same coordination boundary; no stale lock file is auto-deleted.

**Required tests:** Cross-process contention, normal release, abrupt child-process termination, restart acquisition, duplicate executor attempts, lock-file replacement/symlink rejection, process-handle inheritance, unsupported backend/filesystem, and every supported OS/filesystem matrix entry.

**Failure/rollback:** Disable Phase 31 executor activation on any platform whose adapter fails. Keep Phase 12 behavior untouched; do not fall back to timestamp locks. Preserve lock metadata and unresolved records for manual inspection. Roll back the adapter as a feature-gated unit before journal writes begin.

**Out of scope:** Changing general vault-lock semantics, stale-lock auto-recovery, network-filesystem support, distributed locking, background workers, leases based on heartbeat expiry.

### Phase 31B.2 — Durable Journal Foundation

**Scope:** Add strict event-operation and compact-receipt schemas, serializers, size/path/state validation, atomic create/update, plan immutability, journal read/list APIs, and journal-specific required-write error reporting. Do not invoke automation actions.

**Likely files/modules:** `src/database/automations.ts` or a dedicated journal-format module; `src/storage/contracts.ts`; `src/storage/fs/layout.ts`; `src/storage/fs/atomic.ts`; `src/storage/fs/vault.ts`; new `test/database-automation-journal*.test.ts` and atomic-write fault tests.

**Dependencies:** B.1 lock contract; approved 1 MiB record cap and run-state definitions; explicit process-crash versus power-loss durability contract.

**Acceptance criteria:** Strict versioned records reject invalid fields, IDs, states, oversized content, and plan mutations. The complete event plan is created before effects can be called. Atomic replacement leaves old or new complete JSON on process termination. Required journal write/sync/rename errors prevent later action entry. Per-event limits can be validated before any side effect.

**Required tests:** Parser/serializer round-trip and malformed inputs; duplicate event create race; plan-hash immutability; every temp-write/sync/rename failure; crash before/after rename; record-size boundaries; unknown format preservation; symlink/path traversal rejection.

**Failure/rollback:** Journal parse or durability error leaves original bytes untouched, blocks execution, and preserves temporary/recovery evidence where ownership is uncertain. Do not delete malformed records or regenerate from history automatically. New journal APIs remain unused until B.3.

**Out of scope:** Automation execution, v1 history deletion, backup format publication, automatic recovery/retry, power-loss guarantees on unverified storage.

### Phase 31B.3 — Automation Execution Integration

**Scope:** Connect the new journal to the existing local event handler. Generate a server-side source-mutation UUID; validate and snapshot all matching automation definitions, schema, source revision, and ordered actions; enforce limits; execute synchronously through the coordinated write session; persist per-action intents/outcomes and terminal states.

**Likely files/modules:** `src/ui-server/api.ts`; `src/database/automations.ts`; `src/storage/contracts.ts`; `src/storage/fs/vault.ts`; UI/API DTOs only if diagnostics need new fields; `test/database-automations-api.test.ts`, focused concurrency/partial-failure tests, and automation browser smoke.

**Dependencies:** B.1 lock availability and B.2 journal persistence verified on target platforms. Product acceptance of best-effort event delivery and the approved numeric limits.

**Acceptance criteria:** Preserve existing trigger matching, UUID ordering, and action ordering. Validate all plans and limits before the first action. Over-limit events apply zero actions. The source-mutation identity is server-generated and persisted before automation side effects. Known partial failures report exact completed/failed actions. Ambiguous writes become `needs_review` after proven inactivity and never replay. A crash after source write but before plan creation may miss the event and is visibly documented.

**Required tests:** Trigger regression for every Phase 12 event; same event concurrently delivered once; repeated identical source transitions get distinct IDs; stale source/schema stops safely; 20/21 automation, 20/21 per-automation actions, 100/101 total actions, 1 MiB record, cooperative deadline; partial action failure; client disconnect; lock conflict; crash in source-write/journal gap; crash between action effect and outcome.

**Failure/rollback:** If lock or required journal write is unavailable, do not start actions. Keep the event diagnostic where possible; do not run legacy execution as fallback for that event. Roll back the Phase 31 integration behind a clear gate while leaving Phase 12 definitions and history readable.

**Out of scope:** Durable outbox, automatic retry/replay, compensation, cross-database actions, relation actions, scheduler, worker, scripts, network actions.

### Phase 31B.4 — Recovery, Retention & Portability

**Scope:** Implement manual/restart diagnostics, lock-backed interruption classification, v1 history receipt migration, 200-detail retention, receipt compaction, backup and portable import/export support. Imported incomplete operations remain inert.

**Likely files/modules:** `src/storage/fs/vault.ts`; `src/storage/backup/backup.ts`; `src/storage/fs/layout.ts`; `src/storage/portable/manifest.ts`, `export.ts`, `import.ts`; `src/storage/contracts.ts`; `docs/database-automations.md`, `docs/storage.md`; migration, backup, and import tests.

**Dependencies:** B.1 ownership proof; B.2 journal schema; B.3 terminal and unresolved states; existing backup v1–v7 and portable-v1 fixtures.

**Acceptance criteria:** V1 history migration is idempotent and source-preserving; conflicting/corrupt history blocks migration. Keep latest 200 terminal details, compact older success/failure details, retain all unresolved records and all dedupe receipts. Backup v1–v7 and existing portable exports remain readable. New backup/portable formats round-trip plans, details, and receipts. Import/restore never executes an operation; incomplete imports are marked for review.

**Required tests:** Migration interruption/restart at each write; legacy `running` with and without process quiescence; duplicate history entries; receipt collision; compaction crash before/after replacement; retention boundaries; v1–v7 backup reads; new backup round-trip; portable old/new format round-trip; imported incomplete operation inertness; invalid paths, hashes, symlinks, and unknown versions.

**Failure/rollback:** Do not delete history v1 or partial journal data if verification fails. Keep migration marker absent until full receipt coverage validates. Disable new journal execution and retain backup/archive evidence on import/backup incompatibility.

**Out of scope:** User-directed retry, pruning receipts, resolving operations by replay, backup encryption, cloud sync, power-loss guarantees beyond tested contracts.

### Phase 31B.5 — Acceptance & Fault-Injection Testing

**Scope:** Prove the integrated behavior, platform lock matrix, failure semantics, retention, migration, and portability. This is the final gate before any Phase 31 completion claim.

**Likely files/modules:** Automation, storage, backup, and portable tests; native lock platform test harness; browser smoke scripts; `docs/database-automations.md` and roadmap evidence entries.

**Dependencies:** B.1–B.4 complete; supported-platform CI available; no unresolved data-integrity or ambiguous recovery defect.

**Acceptance criteria:** All approved limits and transitions are exercised. No test shows automatic replay. Process-crash and power-loss results are reported separately. Only platform/filesystem combinations whose lock and process-termination tests pass are called supported. Full suite, core/UI typechecks, production build, and browser checks pass.

**Required tests:** Fault injection at every journal and action boundary; subprocess kill/restart; active/uncertain ownership; lock contention across supported platforms; event loss window; partial failures; compaction and migration; backup/portable compatibility; full regression suite and UI workflow smoke.

**Failure/rollback:** Any uncertain outcome remains `needs_review`; any durability or platform failure removes that platform from the supported matrix and blocks Phase 31 acceptance. Preserve journal evidence; do not weaken tests or introduce automatic replay to pass.

**Out of scope:** Declaring unsupported filesystems supported, platform claims without executed tests, online collaboration, cloud sync, exact-once guarantees.

## 9. Explicit non-goals

- No change to automation definition v1 semantics or silent Phase 12 behavior changes.
- No scheduler, background worker, automatic retry/replay, compensation, cancellation, or user-directed retry.
- No cross-database workflows, relation-property actions, arbitrary code, plugins, network/cloud actions, accounts, or collaboration.
- No durable source-event outbox in Phase 31B; best-effort delivery and its missed-event window remain a documented limitation.
- No universal power-loss durability or support claims for network/uncertain filesystems.

## 10. Readiness and authorization

Product decisions for the lock approach, best-effort event delivery, numeric limits, retention, and power-loss limitation are approved. Phase 31B.1–31B.5 are implementation-ready work packages, but **only 31B.1 and F3 implementation are authorized; F1/F2 are accepted with limitations on macOS/APFS, while F4/H2/31B.2+ remain unauthorized**. Platform support is earned only by passing the stated tests; approval of the design is not evidence that any platform currently passes.

## F3 implementation record — 2026-11-16

Approved scope: Native Cleanup Diagnostics & Failure Handling. Structured errors
and bounded native diagnostics expose unlock/file-close/directory-close failures
without changing accepted F1/F2 lifecycle. No cleanup retry or executor activation.
See native/executor-lock/IDENTITY.md for exact semantics and test limitations.
F3 review remains pending; full 31B.1 cross-platform acceptance remains open.
