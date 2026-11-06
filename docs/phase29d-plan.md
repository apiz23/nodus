# Phase 29D — Import Execution and Recovery Plan

**Status:** Phase 29D implementation and baseline verification are recorded in the isolated `feature/phase-29d-1-import-freshness` worktree. Phase 29 remains IN PROGRESS; Phase 29D acceptance is pending owner review. No commit or push has been made.

This plan is based on the current portable import/export implementation and the Phase 29A
capability audit. Its approved proposal remains the design reference; the implementation-state
record at the end supersedes older statements that execution/recovery are absent.

## Executive summary

Nodus already has a useful storage-level import pipeline: `planImport` parses and validates a
directory into an in-memory plan, and `FileSystemVault.applyImport` validates destination conflicts
under the vault root lock and uses atomic per-file writes with expected-hash checks. The current UI
offers a read-only preview through `POST /api/import/preview`. There is no user-facing execution
route yet.

The preview is not an execution capability. It does not bind the source package or destination to a
revision, and it does not return a plan token or conflict decisions. The execution path must therefore
re-parse and revalidate the package, take a fresh destination snapshot, and reject stale decisions
before any write. Ordinary `applyImport` writes resources sequentially; a later failure is reported as
`PARTIAL_WRITE`, without general multi-file rollback. Phase 29D must add an explicit, recoverable
transaction workflow rather than treating per-file atomicity as package atomicity.

## Existing architecture and constraints

### Preview path

`POST /api/import/preview` in `src/ui-server/api.ts` validates the typed source path through
`requireBackupSource`, obtains the active `VaultStorage`, and calls `previewImport` from
`src/storage/portable/import.ts`. The UI is in `ui/src/BackupRestoreSection.tsx`, with request types
and calls in `ui/src/api.ts` and `ui/src/backupRequest.ts`.

`previewImport(sourceDir, vault)` calls `planImport(sourceDir)`, then calls
`vault.snapshotForPortableExport()` to compare incoming resources with the destination snapshot.
The returned `ImportPreview` contains source path/format, manifest version, counts, resource
classifications, warnings, errors, and conflicts (`src/storage/contracts.ts`,
`src/ui-server/dto.ts`). It contains no source revision, destination revision, opaque plan ID, or
execution decisions. The route does not call `applyImport` and must remain read-only.

For manifest exports, `planImport` first calls `validatePortableExport`, which validates the v1
manifest digest, inventory, resource paths, sizes, checksums and symlink restrictions
(`src/storage/portable/manifest.ts`). It then walks and reads the package again to parse resources
and checks manifest resource identities/types/paths against the parsed plan. For legacy directories,
it parses supported content but there is no package manifest/checksum contract. This is a sequential
validation flow, not an immutable source snapshot: source files can change between the manifest
validation pass and later reads, and neither source format is bound to a later execution.

### Storage and writes

Portable resources are enumerated by `walkVault`, `payloadsOf` and the portable manifest contract
(`src/storage/fs/scan.ts`, `src/storage/portable/export.ts`,
`src/storage/portable/manifest.ts`). Current kinds include notes, database definitions, saved views,
attachments, view-order manifests, property catalog, automation definitions/history, and template
catalog.

`FileSystemVault.applyImport` (`src/storage/fs/vault.ts`) runs under `withVaultRootLock`. It parses
and validates notes, schemas, views, attachment bytes, catalogs, automation, templates and ordering;
reads current destination state; detects current ID/path conflicts; captures current file hashes; and
rechecks target hashes immediately before each write. Writes are atomic per file. It applies catalog,
notes, schemas, views, attachments, ordering, automation and templates, then removes stale note paths
for supported note moves. A failure after earlier writes becomes `PARTIAL_WRITE` with affected
paths. The specialized `atomicNewFiles` journal is for constrained database-template application;
it is not a general import transaction.

`withVaultRootLock` (`src/storage/fs/root-lock.ts`) serializes cooperating Nodus writers within and
across processes using a process mutex and exclusive lock file. It does not stop external editors,
sync tools, or other filesystem writers. Hash checks reduce stale-write risk but do not provide a
filesystem-wide transaction or atomic compare-and-swap across arbitrary external writers.

## Confirmed Phase 29C acceptance limitation and risk review

1. **Preview capture:** the preview captures parsed incoming resource bytes in an in-memory
   `ImportPlan` only inside the current call, and a consistent destination snapshot for its
   classification. The public DTO retains classifications and diagnostics, not either snapshot.
2. **Source can change:** `nodus-export.json`, any listed resource, package directory inventory, and
   legacy supported files can change after preview. Manifest checksums are verified at preview time,
   but no source digest is retained in the response or revalidated by a future execution route.
   Because the manifest check and subsequent parsing are separate reads, a concurrent source change
   during preview is also not excluded by an immutable source snapshot.
3. **Destination can change:** notes/frontmatter, attachment bytes, schemas, saved views and order,
   property catalog, automation, templates, and relevant path occupancy can change after preview.
   `snapshotForPortableExport()` gives a consistent view for cooperating Nodus writers during that
   snapshot; the lock is released before the response is returned.
4. **Revalidation:** `validatePortableExport` verifies manifest digest/checksums during planning.
   `applyImport` revalidates the in-memory plan and re-reads destination state under lock. There is no
   execute API today that connects a specific preview to a specific plan or decision set.
5. **Conflict decision risk:** a stale preview must never authorize replacement. Today the UI only
   previews; the current storage apply path independently detects current conflicts. A future API
   must carry explicit user choices and refuse a changed source/destination instead of reinterpreting
   old `replace` or `skip` choices against current state.
6. **Lock boundary:** the root lock protects only cooperating Nodus processes. External filesystem
   changes can occur during staging or between a target hash check and atomic replacement. Phase 29D
   must use the strongest available safe primitives, surface residual external-writer limitations,
   and avoid promising global atomicity.
7. **Execution obligations:** execution must revalidate package format, manifest digest, every
   resource checksum/size/identity/path, full inventory and supported dependencies; re-snapshot the
   destination under lock; compare both revision fingerprints; validate each explicit choice against
   the current identity and path; and verify the final destination before reporting success.

No application behavior was changed during this review. These are architectural risks to close in
Phase 29D, not evidence that the current read-only preview mutates data.

## Phase 29D execution invariants

- **Explicit consent:** a user must confirm the final preview and conflict choices. Preview itself
  never mutates data. Duplicate submissions use an execution ID/idempotency key and cannot start a
  second overlapping import.
- **Freshness:** preview produces an opaque, short-lived server-side plan handle bound to the exact
  source inventory/content and destination snapshot. Execute revalidates both. An expired, unknown,
  consumed, or stale handle returns a structured conflict and requires a new preview.
- **Manifest:** manifest-based packages are revalidated from their exact bytes; no fallback to legacy
  interpretation is permitted when `nodus-export.json` exists but is invalid. Legacy input gets a
  deterministic inventory/content fingerprint and the same destination binding.
- **Decisions:** `new` resources are eligible to add; `identical` resources are skipped; conflicts
  require a per-resource explicit choice. `replace` is eligible only if the preview classified the
  same stable resource identity and exact path as replaceable and the current destination still has
  that identity at that path. Path equality alone never permits replacement. No implicit rename,
  merge, or ID remapping.
- **Dependencies:** schemas, property catalogs and required dependency sets are validated before
  publication. References must resolve within the resulting destination or be surfaced as explicit
  diagnostics under an owner-approved policy. A relation target cannot be silently dropped.
- **No partial success claim:** success is returned only after all planned writes and final resource
  verification succeed. A failed or interrupted operation remains visibly incomplete and recoverable.

## Transaction and recovery proposal

Full atomicity across a vault tree is not provided by the current storage abstraction. Reuse its
root lock and atomic file replacement, and add a narrowly scoped import transaction journal rather
than claiming an all-files atomic commit.

1. Under the vault lock, revalidate the preview token/source, recompute the destination fingerprint,
   validate conflicts/dependencies, and freeze the selected operation list.
2. Capture exact validated source bytes into a private transaction staging area on the destination
   filesystem. Validate sizes/checksums again from staged bytes. Staging must not be visible as normal
   notes/attachments/resources and must be excluded from ordinary scans until recovery completes.
3. Before any replacement, persist verified copies of every replaced/deleted destination resource
   and its prior hash/identity. New-file publication must use exclusive creation where supported;
   replacement must recheck the expected existing hash immediately before publish.
4. Persist a versioned journal before mutation. Record transaction ID, source/target fingerprints,
   manifest identity, explicit decisions, ordered operations, backup/staged paths, expected hashes,
   completed operation index, state and timestamps. Journal writes themselves must be atomic and
   validated; never infer completion from file presence alone.
5. Publish in dependency-safe order: supporting catalogs/schemas first where readers require them,
   notes/records and attachments, then views/view order and automation/template resources. Confirm
   exact dependency ordering against existing readers before implementation. Keep original paths and
   IDs; do not remap implicitly.
6. Verify every resulting resource and expected final inventory. Mark committed only after
   verification, then retain or safely remove backups/staging according to the recovery-retention
   decision. Cleanup failure is a recovery state, not success without warning.
7. On startup or before another import, detect unfinished journals and block conflicting writes
   until the user chooses a validated recovery action. Prefer rollback from verified backups for
   incomplete transactions; if rollback cannot complete, preserve journal and all recovery material,
   report exact affected paths, and do not retry blindly.
8. Retry is deterministic: a transaction ID can resume or roll back only after rechecking current
   state against journal hashes. Never repeat an operation based only on an old progress counter.
   Each operation must be idempotently classified as not applied, applied exactly, or divergent.

The transaction directory location, protection from ordinary vault scanning, backup retention and
cross-process recovery behavior require a storage design review before coding. Do not reuse the
template-application journal without proving that its constraints and recovery semantics cover all
resource kinds and replacements.

## Conflict behavior

| Preview classification | Default execution behavior | Replace allowed? |
|---|---|---|
| New ID and unoccupied path | Add after explicit confirmation | Not applicable |
| Same stable ID, same path, same bytes | Skip as identical | No; replacement is unnecessary |
| Same ID/path, different bytes | Require explicit choice: skip or replace | Yes, only with fresh matching identity/path/hash |
| Same ID, different path | Conflict; skip or cancel whole import | No |
| Same path, different ID or resource kind | Conflict; skip or cancel whole import | No |
| Duplicate incoming identity/path | Reject package before execution | No |
| Missing/incompatible dependency | Block affected resource or whole import per reviewed policy | No implicit repair |

Never translate a stale choice into another action. Any changed classification invalidates the
preview and requires a new preview and confirmation.

## Resource coverage and handling

Phase 29B/C currently enumerate the supported Nodus portable package resources described in
`docs/phase29-audit.md` and `src/storage/portable/manifest.ts`: Markdown notes/frontmatter, managed
attachments, database schemas, record values embedded in notes, relations, formulas, rollups, saved
views and ordering, property catalog, automation definitions/history, template catalog, folders and
exclusion diagnostics.

Phase 29D should execute only resources represented and validated by the current plan. It must not
claim to import arbitrary files, ZIPs, CSVs, external product formats, browser-local workspace
preferences, graph view preferences, or unsupported future features. If a package contains an
unsupported required feature, reject before staging. Optional excluded resources remain explicit in
the preview and are not silently reconstructed. Folders are created only as needed by selected
resources; empty-directory restoration policy needs an owner decision.

## API and UI proposal

- `POST /api/import/preview` remains read-only and returns the existing preview DTO plus an opaque
  plan handle and expiry, once freshness binding is implemented.
- Add `POST /api/import/execute` accepting the plan handle, an explicit confirmation marker, and
  per-resource conflict decisions. Do not accept arbitrary client-supplied paths or serialized plans
  as authority. Re-run allowed-root checks and all freshness checks server-side.
- Return a stable transaction ID and structured state (`accepted`, `staging`, `applying`,
  `verifying`, `completed`, `failed-recoverable`, `recovery-required`), counts, affected resources,
  diagnostics and retry/recovery capabilities. Avoid promising live progress if the current local
  API cannot stream/poll safely; a poll endpoint keyed by transaction ID is preferable to fake
  progress.
- UI flow in Settings → Backup & restore: preview; show source format, counts, diagnostics and each
  conflict; require deliberate replace confirmation with affected paths; execute; show progress,
  completion or recovery instructions. Disable duplicate submission while active. Do not display
  success until server-side verification completes.
- Use the existing typed-path and allowed-root conventions. Preview and execution source roots must
  be validated consistently; no invented filesystem picker.

## Security considerations

- Keep source roots inside configured allowed roots; reject a source equal to or nested inside the
  active destination vault and reject destination/source aliasing through real paths.
- Use `lstat`/real-path checks for the selected root and every resource; reject symlinks and
  non-regular entries. Revalidate path containment at staging and publication boundaries.
- Validate portable relative POSIX paths before joining; never trust client path strings or manifest
  paths as destination paths without storage-layer validation.
- Stage exact bytes with restrictive permissions and random transaction IDs. Ensure transaction
  directories cannot escape the vault and are not treated as user notes.
- Bound file counts, total package bytes, per-resource bytes and time/memory use before full parsing;
  current source is a directory, not an archive, but a large directory can still exhaust resources.
- Preserve diagnostic details without exposing arbitrary local file contents or leaking sensitive
  paths beyond the local user interface.
- Maintain the preview-only guarantee: preview routes must not create transaction artifacts or
  modify the vault, backup directories, catalogs or preferences.

## Proposed subphase sequence

The labels below are planning subdivisions only; they do not create new official roadmap phases.

### 29D.1 — Execution contract and freshness binding

- **Scope:** Define request/response DTOs, opaque preview handles, expiry, source fingerprints for
  portable and legacy packages, destination snapshot fingerprints, and explicit conflict choices.
- **Likely files:** `src/storage/contracts.ts`, `src/ui-server/dto.ts`,
  `src/storage/portable/import.ts`, `src/ui-server/api.ts`, related API/storage tests.
- **Tests:** stale source manifest/resource/inventory; stale destination note/schema/attachment/view/
  catalog; malformed/expired/reused token; legacy fingerprint; preview remains read-only.
- **Dependencies:** Existing manifest validators, `snapshotForPortableExport`, allowed-root helper.
- **Acceptance:** No execution can proceed from an unbound or stale preview; all changed-state cases
  return a conflict and require preview again.
- **Risks:** Snapshot fingerprints can be expensive; lock duration and external-writer races need
  measured limits and documented guarantees.

### 29D.2 — Safe staging and conflict application

- **Scope:** Capture validated package bytes into private same-filesystem staging; validate dependency
  closure and apply only explicit add/skip/replace operations using safe path and hash checks.
- **Likely files:** `src/storage/fs/vault.ts`, `src/storage/fs/layout.ts`, portable import modules,
  storage contracts and integration tests.
- **Tests:** all conflict cases; source mutation during staging; path/symlink attacks; failure before
  first write; replacement requires matching ID/path; exclusive new-file publication; unrelated
  destination content preserved.
- **Dependencies:** 29D.1 and owner decision on all-or-nothing versus resource-level skip behavior.
- **Acceptance:** Invalid or stale packages produce zero target changes; each applied file is the exact
  staged/validated byte sequence; path-only collision never overwrites.
- **Risks:** Staging directory visibility, same-filesystem assumptions and long-running lock scope.

### 29D.3 — Recovery journal, rollback and retry semantics

- **Scope:** Journal operations and prior bytes for replacements/deletions; detect interruption; add
  validated rollback/retry/recovery states and health diagnostics.
- **Likely files:** `src/storage/fs/vault.ts`, storage layout/scan/health code, `docs/storage.md`,
  storage reliability and transaction tests.
- **Tests:** injected failure after each operation boundary; process restart; corrupted journal;
  rollback failure; deterministic resume; idempotency and no duplicate resources.
- **Dependencies:** 29D.2; agree recovery policy and retention duration first.
- **Acceptance:** Every partial transaction is detectable; recovery preserves journal/backups on
  uncertainty; no blind retry or false completion.
- **Risks:** Recovery can itself fail due permissions, disk-full, or external edits; preserve evidence
  and block unsafe writes.

### 29D.4 — API execution workflow

- **Scope:** Add explicit execute and transaction-status/recovery APIs, DTOs, validation, duplicate
  submission protection and structured errors.
- **Likely files:** `src/ui-server/api.ts`, `src/ui-server/dto.ts`, `src/storage/contracts.ts`,
  import API tests.
- **Tests:** consent required, malformed/stale plan, allowed-root enforcement, duplicate execute,
  progress states, partial failure, recovery and no execution through preview route.
- **Dependencies:** 29D.1–29D.3 storage contracts.
- **Acceptance:** API never trusts client conflict choices without revalidating them, and reports
  completion only after final verification.
- **Risks:** Local API process restart invalidates in-memory plans; transaction state must be persisted
  separately from ephemeral preview handles.

### 29D.5 — Import UI and recovery experience

- **Scope:** Add reviewed conflict confirmation, progress/status, failure and recovery presentation
  to existing Backup & restore workflow.
- **Likely files:** `ui/src/BackupRestoreSection.tsx`, `ui/src/api.ts`, `ui/src/backupRequest.ts`,
  shadcn/ui dialog/alert primitives and browser tests.
- **Tests:** review and cancel, replacement warning, keyboard/focus, no duplicate submit, loading,
  errors, retry/recovery states, no misleading success.
- **Dependencies:** stable API states and owner decision on replacement confirmation wording.
- **Acceptance:** Users can understand exactly what changes before confirming and can find recovery
  instructions after failure.
- **Risks:** An unclear per-resource choice UI could encourage broad destructive replacement; favor
  explicit resource/path listings and conservative defaults.

### 29D.6 — End-to-end reliability and acceptance

- **Scope:** Exercise complete portable and legacy workflows, recovery, compatibility and performance;
  finalize docs and roadmap evidence without marking Phase 29 complete prematurely.
- **Likely files:** portable import/export tests, API/browser smoke scripts, `docs/storage.md`,
  `docs/phase29-audit.md`, `docs/ROADMAP.md`.
- **Tests:** full suite, typecheck, external production build, browser workflow, full isolated-vault
  before/after inventory/hash checks, bounded large-workspace tests, legacy import regressions.
- **Dependencies:** 29D.1–29D.5.
- **Acceptance:** Portable and legacy imports are explicitly confirmed, revision-bound, recoverable,
  deterministic on retry, compatibility-tested and documented; remaining limitations are owner
  reviewed before status changes.
- **Risks:** Test failures or unsupported resource gaps must block acceptance rather than be hidden.

## Open questions for project-owner review

1. Should a missing dependency block the entire package, or may unrelated resources be imported while
   the dependent resource is skipped? The safe default is block the affected dependency group and
   require an explicit revised plan.
2. Should user-selected `skip` permit a package to complete while omitting conflicting resources, or
   should any skipped conflict make the result “completed with omissions”? The response should report
   omissions explicitly either way.
3. How long should replacement backups and completed transaction journals be retained, and should
   cleanup be user-controlled?
4. Should recovery default to rollback, or offer resume only after verifying each resource against the
   journal? The safe default is rollback incomplete work, with resume as a deliberate recovery action.
5. Is a same-vault filesystem staging directory acceptable if hidden from normal browsing and surfaced
   in health checks, or is an app-managed temporary sibling directory required? A sibling directory
   complicates same-filesystem atomic publication and destination confinement.
6. What progress transport is appropriate for the local API: polling persisted transaction state or
   server-sent events? Polling is simpler and recoverable across UI reloads.
7. The current D.6 bounds are 10,000 resources and 256 MiB aggregate bytes, with a 64 MiB
   per-resource cap, a 20,000-entry filesystem inventory cap, a 16 MiB manifest cap, and 64 path
   segments. Owner review may adjust them before Phase 29D acceptance; progress and cancellation for
   near-limit imports are not implemented.
8. Should importing a full package merge only, as the current storage behavior does, or should a
   future explicit replace-vault mode be considered? This plan assumes merge only.

## Acceptance gate for Phase 29D

Phase 29D is ready for owner acceptance only after all six planned implementation work packages are
reviewed and verified; portable and legacy paths have no silent conflict reinterpretation; stale
previews fail closed; failure injection demonstrates detectable recovery; user data outside selected
operations is unchanged; and all verification is recorded against the final implementation. The
owner-requested 29D.7 operational follow-up additionally reviews near-limit behavior and the
manifest-free interrupted-export ambiguity. Phase 29 must remain IN PROGRESS until its complete
official roadmap scope is separately reviewed.

## Implementation-state record — 2026-11-05

| Work package | State in this worktree | Evidence / boundary |
|---|---|---|
| 29D.1 freshness contract | Implemented | Process-local five-minute opaque handles, deterministic source/destination fingerprints, per-resource choices; covered by `test/storage-portable-freshness.test.ts`. |
| 29D.2 staging and conflict application | Implemented | Exact bytes staged and hashed, dependency validation, per-resource explicit choices, exclusive adds, hash-bound replacement, safe folder creation; covered by `test/storage-import-execution.test.ts`. |
| 29D.3 journal and recovery | Implemented with limits | Durable journal, verified replacement backup, inode/hash-checked rollback, retry from staged bytes, health visibility. Ambiguous crash windows fail closed for manual recovery. Journals/backups have no retention/cleanup policy. |
| 29D.4 API | Implemented | Execute, operation list/status, rollback, retry. Execution is synchronous; status is durable after an operation boundary but does not stream live progress. |
| 29D.5 UI | Implemented | Settings → Backup & restore review, explicit replacement consent, confirmation, loading/errors/success, safe retry/rollback presentation using existing shadcn primitives. |
| 29D.6 reliability gate | Implemented and verified; owner acceptance pending | `docs/phase29d-handoff.md` records measured 2,204-resource planning/preview, explicit operational limits, injected ENOSPC staging failure, and real child-process SIGKILL/restart browser recovery at staging, addition, replacement, rollback, and ambiguous external-edit boundaries. Final regression evidence is recorded there; no Phase 29D acceptance is claimed. |
| 29D.7 operational follow-up | Implemented and verified with documented limits; owner acceptance pending | Add an explicit `manifest-validated` versus `unverified-legacy` preview classification and completeness warning without disabling legacy import. API tests cover valid, corrupt, manifest-free incomplete, and temp-bearing interrupted packages; the browser smoke verifies the warning and legacy import. Near-limit and process-recovery evidence and the remaining platform, power-loss, retention, cleanup-diagnostic, and memory risks are recorded in `docs/phase29d-handoff.md`. |

### Implemented transaction semantics

The user-facing route accepts only a one-use server-side preview handle and explicit confirmation/decisions. Client paths and serialized plans are not trusted. Source planning is reconstructed on the server, then storage checks the canonical destination path and revalidates the destination fingerprint under the vault root lock immediately before publication. Validated bytes are staged privately and checked again by exact size and SHA-256. Replace requires matching kind, stable ID, exact path, and previewed destination hash; an addition uses exclusive hard-link publication. Existing dependency validators run before publication.

This is a recoverable multi-file workflow, not package-wide atomicity. A durable journal tracks each resource and created folder, baseline state, hashes, decisions, staged bytes, and replacement backups. Final success follows post-publication hash/size verification. Rollback/retry only changes resources still provably at the original or operation-owned revision. If inode ownership or workspace state is ambiguous, the implementation preserves evidence and refuses to guess. External filesystem writers do not honor the vault lock and can race an atomic replacement; no filesystem-wide compare-and-swap is claimed. The candidate replacement inode and temporary basename are durably recorded before rename; restart tests verify safe cleanup before rename and rollback after rename. A crash before the first journal becomes durable can leave an orphan transaction directory, but publication has not started and manual preservation/inspection is required.

Settings shows a request loading state; there is no live progress stream or cancellation. Operation journals, staged bytes, and replacement backups are retained indefinitely; no pruning occurs because there is no owner-approved retention policy and incomplete recovery material must never be removed. This is conservative but has unbounded disk growth. Journal SHA-256 detects accidental corruption but is not a keyed authenticity mechanism. These are known limits for owner review, not claims of full transactional guarantees.

### 29D.6 resource limits and measured workload

Import planning enforces at most 10,000 resources, 20,000 total filesystem inventory entries, 64 MiB per resource, 256 MiB aggregate resource bytes, 16 MiB for the portable manifest, and 64 path segments. Descriptor-based reads are bounded, reject symlinks, compare opened-file identity with the initial lstat result, and detect observed size/mtime/inode changes. The portable exporter uses the same manifest bounds, so it will not write a v1 export whose manifest is rejected by this importer. Managed attachments retain the stricter 10 MiB validator.

On Node `v24.22.2`, an isolated workload of 2,204 resources (1,500 small Markdown notes, 500 Markdown database records, 200 destination conflicts, one database schema, an 8 MiB Markdown note, a 10 MiB attachment, and a 40-level folder path) contained 18.32 MiB of resource bytes. `planImport` took 1,504 ms and preview took 1,618 ms; process RSS increased from 130 MiB to 199 MiB. A separate D.7 operational workload reached 266,334,369 resource bytes (99.22% of the aggregate limit) across 20 resources and 43 filesystem entries; the largest resource was 67,104,929 bytes. Import completed with matching final hashes in 34.028 seconds but peaked at 1,656,372 KiB RSS (~1.58 GiB). This does not exercise 10,000-resource execution, sustained OS memory pressure, or a full boundary matrix; temporary/final disk-use breakdown was not retained. Treat high RSS and host-dependent capacity as an unresolved operational risk, not an SLA.

No automated cleanup is performed. Completed and failed-terminal transaction directories remain on disk indefinitely. A future retention design must retain every stage, backup, and journal required by `staging`, `staged`, `publishing`, `recovery-required`, or `corrupt` operations; the owner should review a manual cleanup/export policy before any deletion behavior is introduced.

### 29D.7 incomplete-export and operational observations

The portable manifest is written last, but the legacy importer accepts manifest-free directories. A partial export without a surviving `.nodus-tmp-*` therefore cannot be distinguished from a legitimate legacy directory. Preview now marks the former package shape as `unverified-legacy`, warns that completeness cannot be established, and preserves explicit legacy execution after user confirmation. A present invalid manifest fails closed; a leftover temp file rejects preview. The API and Backup & Restore UI use the same distinction. This warning does not authenticate a legacy source or convert it into a verified complete export.

An earlier isolated D.7 fault injection showed that a cleanup `EACCES` can be suppressed while the primary write error is returned. The staging journal remains discoverable and explicit recovery reports the failed staging operation, but the original failure response does not include the cleanup failure. No automatic cleanup/retention is implemented: completed journals, stage data, and replacement backups remain indefinitely pending an owner-approved policy. External filesystem writers can race operations despite the cooperative vault lock. Operational testing was on local macOS/APFS only; other OS/filesystem combinations and power-loss durability are unverified. Atomic writes sync file bytes and attempt directory sync where supported, but directory-sync errors are ignored. No package-wide atomicity or power-loss guarantee is claimed.

### Final verification record — 2026-11-05

On Node `v24.22.2`, final verification against this worktree passed:

- `pnpm exec vitest run --no-cache --maxWorkers=1` — 133 files, 1,323 tests (187.58 seconds).
- Final focused import verification — 5 files, 42 tests; typecheck passed.
- `pnpm run typecheck` — passed.
- `pnpm run test:database-views` — passed. One earlier run transiently timed out waiting for a saved-view response; the rerun passed and did not establish a source defect.
- `pnpm run test:workspace` — passed against the final source state, including preview and real legacy publication UI smoke coverage.
- `pnpm run test:import-recovery` — passed with actual child-process interruption/restart at staging, add, replacement pre/post-rename, rollback, and ambiguous-edit boundaries.
- `pnpm exec vite build --config ui/vite.config.ts --outDir /private/tmp/nodus-phase29d6-build.Sq4OIW` — passed; external `index.html` verified. Vite reported its >500 kB App chunk advisory.
- `git diff --check` and `git diff --cached --check` — passed after documentation updates.

Additional recovery protection: ordinary vault snapshots used by backup/export reject incomplete or corrupt import journals with `PARTIAL_WRITE`; import-internal baseline/final snapshots explicitly allow only their own operation while holding the vault root lock. Regression assertions verify snapshots are blocked during interrupted publication and available again after rollback. This does not make direct external writers participate in the lock and does not make multi-resource publication atomic. Phase 29D remains unaccepted pending owner review.
