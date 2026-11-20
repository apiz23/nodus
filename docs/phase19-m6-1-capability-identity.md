# Phase 19 M6.1 — Capability & Identity Gate

**Status:** M6.1 implementation in isolated review branch; not merged or owner-accepted.

**Baseline:** `6bae516adecc29f7275c8df8da4ef5aedaf9e738` (PR #26 squash merge).
**Scope:** identity and evidence contracts, validation, and fail-closed capability refusal only.

## 1. Objective and boundary

M6.1 defines the identities and evidence a later publication implementation would need, and a filesystem capability gate that refuses every currently unqualified target. It does not create a destination, stage note bytes, publish files, add journal transitions, recover publication, qualify a native filesystem, or add UI/API workflows.

The owner-approved M1–M5 scope remains reconstructed scope, not a claim that the original historical milestone mapping was recovered.

## 2. Accepted M1–M5 architecture retained

The baseline in [`phase19-reconstruction.md`](phase19-reconstruction.md) and [`storage.md`](storage.md#note-copy-operation-journal-phase-19m) establishes:

- Preview and confirmation use a repeated bounded inventory and an expiring, instance-local token.
- The v1 `Prepared` journal binds source bytes, destination path/collision key, copy identity/content hash, vault identity, and resolver evidence.
- Copy preparation records evidence only. A `Prepared` operation has not published a destination.
- Cancellation is permitted only after the existing storage owner revalidates the prepared evidence under the shared vault root lock. It records `Cancelled` without changing workspace files.
- `Cancelled` is the only resolved copy state. `NeedsReview`, corrupt evidence, and unsupported journal states continue blocking conflicting transfer work.
- Import, copy, restore, backup and export retain their existing dual-journal admission and shared-lock boundaries.
- Ambiguous external changes remain a manual-recovery case. Journal digests detect accidental corruption, not malicious local edits.

M6.1 changes none of the journal reader, writer, state-resolution, cancellation, recovery, or admission code.

## 3. Publication identity

`src/storage/copy-publication.ts` defines an immutable, separately validated identity with:

- `ownerJournalOperationId` and `preparedOperationId`, required to identify the same M1–M5 operation;
- `preparedEventSha256`, binding the identity to the exact v1 `Prepared` event bytes;
- a separate `attemptId` for one future publication attempt;
- vault instance and lineage IDs;
- source note ID, validated vault-relative path, and raw-byte digest;
- destination note ID, validated path, canonical collision key, expected serialized-content digest, and byte length.

The parser requires exact object keys, UUID v4 identifiers, lowercase SHA-256 encodings, note-path validation, the existing case/NFC collision rule, distinct source/destination identities, and the existing 32 MiB serialized-copy bound. It does not treat an operation directory, event filename, or destination pathname as proof of identity. `matchesPreparedCopyIdentity` compares every publication identity field to a projection from an already validated prepared plan.

The filesystem object identity carried by future evidence is an opaque observed device/file identity. It is not predicted from a path and does not claim portability or immunity to filesystem identity reuse.

## 4. Publication evidence

The evidence document binds the full publication identity, a prepared-event digest, an attempt state, source observation, destination observation, observer provenance, and an optional exclusive no-replace receipt. The parser rejects malformed fields, cross-operation evidence, source/destination mismatches, contradictory receipt/observation pairs, and receipt digests that do not match their canonical fields. Receipt digests are unkeyed corruption checks, not signatures or proof of authorship.

The result type names four future outcomes: definitely not published, definitely published, ambiguous, and invalid. In M6.1, `assessCopyPublicationEvidence` returns only `invalid` or `ambiguous`:

- missing, incomplete, stale, or unqualified observations remain ambiguous;
- a matching destination file without an operation-bound receipt is ambiguous;
- even internally consistent receipt-shaped input remains ambiguous because M6.1 has no trusted fresh-filesystem evidence verifier;
- malformed, mismatched, or contradictory evidence is invalid and must fail closed.

No journal statement alone establishes that a destination exists. The future implementation must re-observe destination identity through a qualified adapter; serialized claims and hashes alone cannot authorize recovery or success.

## 5. Filesystem capability model

`src/storage/fs/publication-capability.ts` distinguishes `supported`, `unsupported`, `not-qualified`, `unavailable`, and `disabled` assessments. A positive indication that a runtime API exposes exclusive creation is insufficient for qualification. A supported result requires an exact platform/filesystem/operation entry in `FILESYSTEM_PUBLICATION_ALLOWLIST`.

The allowlist is frozen and **empty**. macOS/APFS, Linux filesystems, Windows filesystems, and all other targets are therefore not enabled. Missing or malformed observations fail as unavailable; unsupported primitives/platforms are unsupported; an explicit `requested: false` is disabled. `requireFilesystemPublicationCapability` throws `PUBLICATION_CAPABILITY_REFUSED` (HTTP status mapping 501) and has no overwrite or rename fallback.

## 6. Journal compatibility decision

M6.1 selects the future-extension timing option: **do not serialize new publication identity/evidence into v1 plans or events in this slice**. Existing v1 `Prepared` records remain unchanged and readable. No global journal version bump, optional v1 field, new operation state, or reinterpretation is introduced.

When a later M6 slice is separately authorized, it must review the concrete publication protocol before selecting a journal representation. The current preference is to keep publication receipts separate from the immutable v1 prepared plan and bind them to its operation ID and event digest; the durable location, append protocol, state transitions, and migration/compatibility rules remain deferred to that design review.

## 7. Security invariants

- Capability refusal happens before any publication code; M6.1 contains no destination writer.
- The allowlist remains empty regardless of runtime API claims.
- Missing evidence is not a no-publication proof; ambiguous evidence cannot resolve as success.
- Evidence must bind the vault, journal operation, prepared event, attempt, source, and intended destination.
- Contradictory or foreign evidence is rejected; filenames are never sufficient identity.
- No M1–M5 admission check, lock, cancellation rule, or recovery behavior is weakened.
- A future implementation must independently validate current filesystem observations and preserve the accepted arbitrary-external-writer limitation.

## 8. Verification evidence

Fresh verification was run on 2026-11-20 in the isolated worktree based on `6bae516adecc29f7275c8df8da4ef5aedaf9e738`:

| Command | Result |
| --- | --- |
| `NODE_PATH=/Users/ocgt/Desktop/nodus-phase29-final-verification/node_modules ./node_modules/.bin/vitest run test/storage-copy-publication-contract.test.ts test/storage-copy-operation-journal.test.ts test/storage-copy-preview.test.ts test/note-copy.test.ts test/resolver-stability.test.ts test/storage-scan-budget.test.ts test/storage-import-limits.test.ts --maxWorkers=1 --no-cache --no-fsModuleCache` | 7 files, 159 tests passed |
| `NODE_PATH=/Users/ocgt/Desktop/nodus-phase29-final-verification/node_modules ./node_modules/.bin/vitest run test/storage-import-execution.test.ts test/storage-backup.test.ts test/storage-backup-order.test.ts test/storage-portable.test.ts test/storage-portable-freshness.test.ts test/storage-portable-diagnostics.test.ts test/storage-portable-manifest.test.ts test/storage-root-lock.test.ts test/ui-api.test.ts test/ui-backup.test.ts --maxWorkers=1 --no-cache --no-fsModuleCache` | 10 files, 209 tests passed |
| `NODE_PATH=/Users/ocgt/Desktop/nodus-phase29-final-verification/node_modules ./node_modules/.bin/tsc --noEmit` | Passed |
| `NODE_PATH=/Users/ocgt/Desktop/nodus-phase29-final-verification/node_modules ./node_modules/.bin/tsc -p tsconfig.ui.json --noEmit` | Passed |
| `NODE_PATH=/Users/ocgt/Desktop/nodus-phase29-final-verification/node_modules ./node_modules/.bin/vite build --config ui/vite.config.ts --outDir /tmp/nodus-phase19-m6-1-build-20261120` | Passed; output was outside the repository. Vite reported existing chunks over 500 kB. |

The 14 M6.1 tests are included in the 159-test command. They cover identity validation, cross-operation and path conflicts, evidence completeness/contradiction, receipt binding, refusal states, the empty allowlist, and unchanged v1 `Prepared` bytes/admission behavior. The existing M1–M5 tests cover journal recovery, copy preview, note-copy rules, resolver stability, scan budgets, import limits/execution, restore, backup/export, and root-lock behavior. No tests were skipped or retried in these commands.

The implementation worktree uses preinstalled dependency links assembled locally from an existing package tree; no dependency installation was performed. The Vitest Vite cache path remained under the new worktree. The baseline `package.json` defines no lint script, so no lint command was available.

## 9. Known limitations

- M6.1 has no filesystem observation producer or trusted evidence verifier, so no evidence can currently resolve to “definitely published” or “definitely not published.”
- The capability probe describes runtime information; it does not qualify or enable a target.
- Receipt SHA-256 is unkeyed and does not authenticate against a malicious local actor.
- Filesystem identifiers and observations may be stale or reused. External writers can race Nodus, as already documented for M1–M5.
- No new journal retention, power-loss, network-filesystem, cross-platform, or malicious-local guarantee is made.

## 10. Deferred M6.2–M6.4 decisions

The accepted M1–M5 documentation does not define the exact M6.2/M6.3/M6.4 allocation or acceptance gates. These remain separate owner-reviewed milestones. Before any later implementation, decide and verify:

- whether and how staging is introduced;
- the no-replace publication protocol and its exact crash points;
- trusted provenance and fresh re-observation rules for recovery;
- journal evidence location, state transitions, retry, rollback, and manual-review behavior;
- native qualification test matrix and the explicit filesystem allowlist update process;
- supported operating systems/filesystems and durability boundaries;
- UI/API exposure and user recovery guidance, if needed.

## 11. Explicit non-implementation statement

**Publication is not implemented or enabled.** No destination file is created, replaced, staged, retried, rolled back, or recovered by M6.1. The filesystem capability allowlist remains empty. M6.2, M6.3, M6.4, native qualification, and all later publication work require separate authorization.
