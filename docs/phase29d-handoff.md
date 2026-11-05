# Phase 29D implementation handoff

**Official milestone:** Phase 29 — Advanced Import & Export (**IN PROGRESS**)

**Work packages:** 29D.1–29D.6 implementation and final reliability verification are recorded in this isolated worktree; formal acceptance remains pending owner review.

**Status:** Phase 29D is implemented and verified in this isolated worktree, but remains unaccepted pending owner review. Phase 29C remains owner-accepted. No commit or push has been made.

## 29D.1 contract

`POST /api/import/preview` remains read-only. A successful response includes its existing preview plus a cryptographically random opaque `previewId` and `expiresAt`. The local API retains at most 64 contracts for five minutes in process memory. A process restart invalidates the handles, requiring a new preview. The handle binds the canonical source path, canonical destination vault path, source and destination fingerprints, and per-conflict identity/path/content hashes plus safe choices. It stores no resource payload bytes.

Portable source fingerprinting covers the exact raw `nodus-export.json` bytes, all recognized plan resources including byte size and SHA-256, visible folder inventory, format, and manifest exclusions. Before a portable plan is returned, each parsed resource's bytes are compared to the manifest's size and checksum, then the manifest inventory is checked again for missing/extra paths, folders, and symlinks. Legacy fingerprinting covers resources and folders recognized by the existing importer; arbitrary unsupported files that are not imported are not silently treated as importable resources.

Destination fingerprinting uses `FileSystemVault.snapshotForPortableExport()` and a canonical, sorted SHA-256 representation of managed resources, property catalog, view ordering, automation and template resources, visible folders, and exclusions. That snapshot is coherent relative to Nodus writers honoring the vault root lock.

`validateImportPreviewFreshness` replans the source and captures a new destination snapshot. It rejects source/destination root changes, modified or invalid source packages, changed resource bytes/identity/path/folders, and changed destination snapshots with `STALE_PREVIEW`. Expired handles are reported as `PREVIEW_EXPIRED`; both map to HTTP 409. Conflict-decision validation requires exactly one decision for each previewed conflict, rejects duplicate or mismatched identities/paths, and only accepts choices recorded as safe. Replace is limited to a resource whose same-kind ID and path matched at preview time.

## Concurrency and execution boundary

The freshness validator is a read-only observation, **not** permission to write. Execution now reconstructs the source plan from the server-side handle, stages exact validated bytes, checks the canonical target vault path, and revalidates the destination snapshot under the vault root lock through publication/final verification. The lock coordinates cooperating Nodus processes only; direct external filesystem writers are not blocked.

The preview endpoint itself remains read-only. The execution endpoint requires one-use preview confirmation and explicit per-resource decisions. A durable journal tracks exact staged bytes, replacement backups, per-file publication, baseline fingerprints and created folders. Rollback/retry use hashes and inode identity, preserving ambiguous changes for manual recovery. Multi-file publication is recoverable but not package-atomic. See `docs/storage.md` for exact API and filesystem semantics.

## Verification evidence

Final verification for this worktree used Node `v24.22.2`:

- Focused final temporal/import verification: `pnpm run typecheck && pnpm exec vitest run test/storage-import-execution.test.ts test/storage-import-limits.test.ts test/storage-portable-freshness.test.ts test/storage-portable-manifest.test.ts test/ui-import-preview-api.test.ts --maxWorkers=1` — typecheck passed; 5 files, 42 tests passed.
- Full suite: `pnpm exec vitest run --no-cache --maxWorkers=1` — 133 files, 1,323 tests passed (187.58 seconds).
- `pnpm run typecheck` — passed.
- `pnpm run test:database-views` — passed; Calendar/database browser smoke completed. A prior attempt transiently timed out waiting for a saved-view response; the rerun passed, and no source defect was established as the cause.
- `pnpm run test:workspace` — passed against the final source state; workspace smoke included real legacy preview-to-execution publication plus preview, explicit conflict choices, replacement consent, loading/completion, stale-preview rejection, refreshed retry, API error, legacy/empty states, and absence of an unintended apply action.
- `pnpm run test:import-recovery` — passed against the final source state. Real child-process SIGKILL/restart and browser recovery covered durable staging interruption, addition publication before journal update, replacement temporary inode recorded before rename, replacement rename before publication journal update, interruption after rollback writes, and preservation of an ambiguous external edit.
- Production build: `pnpm exec vite build --config ui/vite.config.ts --outDir /private/tmp/nodus-phase29d6-build.Sq4OIW` — passed; `/private/tmp/nodus-phase29d6-build.Sq4OIW/index.html` exists. Vite warned that the App chunk exceeds 500 kB minified (940.34 kB).
- The build output remained outside the repository. The target worktree `dist/` remained absent; the original checkout's ignored `dist/` inventory was checked before and after and remains at 18 files / 1,789,889 bytes.
- `git diff --check` and `git diff --cached --check` — passed after the final documentation update. Local links among the Phase 29 roadmap, audit, storage guide, plan, and handoff were checked.

These checks verify the current uncommitted worktree. They do not constitute Phase 29D or Phase 29 acceptance.

## 29D.2–29D.5 implementation boundary

- **29D.2:** private staging, staged-byte size/hash verification, dependency validation, explicit Add/Skip/Replace, exclusive add paths, hash-bound replacement, and safe folder creation.
- **29D.3:** durable journal, verified replacement backups, ownership-checked rollback, deterministic staged retry, crash-state discovery through storage health, and preservation of ambiguous data.
- **29D.4:** execute/list/status/recover/retry local API routes. Duplicate preview-handle use fails closed. Execution is synchronous; polling cannot observe intra-request progress while the vault lock is held.
- **29D.5:** Settings → Backup & restore review/decision/consent/confirmation and recovery UI using existing shadcn components. The interface shows request loading and confirmed results; live progress and cancellation are not implemented.

## Known limitations and remaining acceptance evidence

- Publication is recoverable, not package-atomic. The candidate replacement inode is durably journaled before rename, closing the tested rename-before-publication-journal window. External filesystem writers can still race atomic replacement and are outside the cooperating lock guarantee.
- Journals, staged payloads, and replacement backups are retained indefinitely; no cleanup occurs. This preserves recovery material but causes unbounded disk growth. Journal digests are unkeyed and detect accidental corruption, not malicious local edits.
- Empty source folders are restored whenever at least one resource is selected. Import remains directory-based; ZIP packages are unsupported.
- Preview handles remain process-local and expire after five minutes. Restarting the UI server invalidates a preview and requires re-previewing.
- Startup does not automatically roll back incomplete imports; pending/corrupt operations are detected and surfaced for explicit recovery. A process killed while holding the root lock leaves a stale lock that Nodus will not automatically steal. The documented manual stale-lock procedure is required before recovery can acquire that vault.
- A crash after creating an operation directory but before its first durable journal may leave an unreadable orphan directory. Publication has not started at that boundary; preserve the vault and manually inspect the orphan rather than deleting it automatically.
- Import bounds are 10,000 resources, 20,000 filesystem inventory entries, 64 MiB per resource, 256 MiB aggregate resource bytes, 16 MiB manifest, and 64 path segments. This bounds input allocation, but execution at the configured maximum and sustained memory pressure have not been measured.
- Snapshot, backup, and export APIs now fail closed while an import journal is staged, publishing, recovery-required, or corrupt. Import-internal snapshots may exclude only their own operation while holding the root lock. Regression assertions verify snapshot refusal during interrupted publication and for a corrupt journal, plus availability after rollback.
- The full suite and smoke checks passed, but they do not eliminate the documented external-writer race, stale-lock recovery requirement, or orphan-operation-directory window before the first durable journal.

### Crash-state handling observed in D.6

Nodus does not automatically mutate a workspace on startup. It discovers durable transaction state and presents explicit recovery/retry actions in Backup & restore. “Recoverable” below means the user can safely invoke one of those actions after the application has reopened and the vault lock is available.

| Crash point / observed state | Verified behavior | Automatic vs manual |
|---|---|---|
| After durable `staging` journal, before stage files or publication | Restart discovers `staging`; explicit recovery marks `STAGING_INTERRUPTED`; destination remains unchanged. | Explicit safe recovery; no automatic rollback at startup. |
| Addition linked into destination before its publication bit is journaled | Staged and destination inode/hash are compared; explicit retry completes without duplicate files. | Explicit retry/rollback is supported if ownership remains provable. |
| Replacement temp inode journaled before atomic rename | Restart verifies the recorded temp sibling's basename, inode, size, and hash; rollback removes only that owned temp and leaves original destination bytes intact. | Explicit rollback is supported; unrelated or modified temp files are preserved and require manual recovery. |
| Replacement renamed after the candidate inode was durably recorded but before published state was journaled | Verified backup remains; explicit rollback restores original bytes when the destination still has the recorded operation inode and expected hash. | Explicit rollback is supported if ownership remains provable. |
| Rollback restored files before the terminal `rolled-back` journal write | Restart sees the older `publishing` state; a second rollback recognizes already-restored original hashes and completes idempotently. | Explicit rollback is supported. |
| Destination externally edited after crash, or inode/hash/journal is ambiguous | Recovery reports `recovery-required`, preserves the external bytes and verified backup, and refuses to overwrite. | Manual inspection and recovery required. |
| Operation directory created before the first durable journal | There is no destination publication at this point, but the operation directory may be reported as corrupt/unreadable. | Manual preservation and inspection required; no blind cleanup. |
| Process killed while holding the root lock | Lock remains; Nodus does not auto-steal it. Recovery requests fail closed until stopped-writer manual lock recovery is performed. | Manual lock recovery required before any recovery action. |

No state is silently discarded. Replacement backups and journals are retained indefinitely. The process tests cover these local macOS/filesystem scenarios only; power loss, Windows/Linux, network or synchronized filesystems, and hostile external races are not established by this evidence.

## Phase 29D.6 reliability evidence

Node `v24.22.2` was used. An isolated workload of 2,204 resources (1,500 small Markdown notes, 500 Markdown database records, 200 destination conflicts, one database schema, an 8 MiB Markdown note, a 10 MiB attachment, and a 40-level folder path) contained 18.32 MiB of resource data. `planImport` took 1,504 ms and preview took 1,618 ms; RSS increased from 130 MiB to 199 MiB. This measures planning/preview only, not full execution or the configured maximum.

`pnpm run test:import-recovery` uses Playwright with a real local API child process. It SIGKILLs that process at controlled boundaries, restarts it, and exercises the actual recovery UI. Verified: interruption after durable staging intent and recovery; addition publication before its journal status update and safe retry; replacement temp inode journaled before rename and owned temp cleanup; replacement rename before publication journal update and verified rollback; process interruption after rollback restored files but before terminal journal update and idempotent rollback; and a post-crash external edit that becomes `recovery-required`, preserves external bytes, and retains the verified replacement backup. The isolated test copies the killed process's lock file and performs the documented manual stale-lock removal before restart; automatic lock recovery is not claimed.

`test/storage-import-execution.test.ts` injects `ENOSPC` while finalizing staged data and verifies no destination resource was published and the durable staging operation can be safely marked interrupted. `test/storage-import-limits.test.ts` verifies resource count, per-resource, aggregate bytes, path-depth bounds, and pre-parse rejection from inventory sizes. These safeguards bound input allocation but do not prove maximum-size execution fits every host.

See [the Phase 29 plan](phase29d-plan.md), [audit](phase29-audit.md), [storage contract](storage.md), and [official roadmap](ROADMAP.md) for the broader portability and acceptance context.
