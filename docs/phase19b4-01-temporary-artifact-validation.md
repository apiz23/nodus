# Phase 19B.4 — F19B4-01 Temporary Journal Artifact Validation

**Status:** Correction only. No owner acceptance is implied or claimed.
**Repository:** `/Users/ocgt/Desktop/nodus-phase19-reconstruction`
**Branch:** `feature/phase19-reconstruction-m1-m5`
**Base commit:** `63bec0bd884691e3d16928541206c832e1bd9765`
**Parent of correction:** `519228fcc81c02ee8f767aaa3abb72bb851cc671`
**Correction commit:** `3ccc6e772a930138283657ce5cec6bcb74dde74d`

---

## 1. Root cause

**F19B4-01 — LOW — Temporary journal entries classified by filename alone.**

`inspectOperation()` built its event list with:

```ts
names.filter((name) => !(name.startsWith(TEMP_PREFIX) && isUuidV4(name.slice(TEMP_PREFIX.length))))
```

Every entry named `.nodus-tmp-<uuid>` was dropped before any type, ownership, or
content check. A directory, symlink, malformed file, foreign file, or a
structurally valid but unrelated record with that name was therefore invisible:
`list()` reported the operation normally, `assertNoUnresolved()` and
cross-journal admission stayed open, and `recover()` reported nothing. Evidence
was silently ignored rather than surfaced, violating the journal's fail-closed
contract.

## 2. Artifact contract (derived from the writer, not invented)

Only one writer can create a `.nodus-tmp-*` entry inside an operation
directory: `appendTransitionUnlocked()` → `writeFileAtomicExclusive(eventPath,
bytes, { beforePublish })` in `src/storage/fs/atomic.ts`, used solely for
`Cancelled` publication.

Observed contract:

| Property | Value |
| --- | --- |
| Filename | `TEMP_PREFIX + randomUUID()` → `.nodus-tmp-<uuidv4>` |
| Creation | `open(path, 'wx', 0o600)` — exclusive, private, no replacement |
| Filesystem type | regular file, not a symlink |
| Links | `nlink === 1` at creation (the subsequent hard link raises it to 2) |
| Contents | complete, synced bytes of the **next** journal event: `Cancelled`, `evidence.kind === 'no-publication'`, `sequence = chain.length`, `previousSha256 = chain tip sha256`, canonical event checksum, ≤ 1 MiB |
| Ownership | journal `operationId`, `vaultInstanceId`, `vaultLineageId` |
| Lifecycle | write → file sync → close → (journal fault point) → hard-link to `event-NNNNNN.json` → unlink temp → directory sync |
| Interruption | crash before the link leaves the single-link complete file (the case retried by `cancel()`); a caught error removes it in the writer's `catch`; crash after the link leaves a two-link file, which the existing record reader already rejects (`nlink !== 1`) and therefore already fails closed |

Two genuine crash leftovers are recognized:

1. **Pending** — `sequence === events.length`, predecessor = chain tip. This is
   what a crash before publication leaves and what a later retry supersedes.
2. **Superseded** — `sequence === 1`, `events.length === 2`, tip is `Cancelled`
   (retry succeeded) or `NeedsReview` (recovery superseded the retry). The
   artifact is a complete, unused no-effect cancellation event; retaining and
   ignoring it hides no publication and preserves the previous accepted
   behavior (`test: recovers a Prepared operation after cancellation exits
   before publication`).

Anything else is not explainable by the writer.

## 3. Implementation

`src/storage/fs/copy-operation-journal.ts`:

- Added `isTemporaryArtifactName(name)`; the event list no longer drops match
  candidates silently.
- `inspectOperation()` now collects `temporary` separately from `ordered`,
  builds and validates the normal chain, then validates every temporary
  candidate through `assertSupportedTemporaryArtifact()`.
- New `assertSupportedTemporaryArtifact()` requires, in order:
  1. `lstat` succeeds, not a symlink, regular file, `nlink === 1`,
     `mode & 0o077 === 0`, size ≤ 1 MiB.
  2. Full `readEvent()` validation (schema, canonical fields, checksum, bounds,
     identity of the file itself). Read failures are wrapped in a
     temporary-artifact-specific corruption message.
  3. Pending or superseded position as defined in §2.
  4. `operationId` / `vaultInstanceId` / `vaultLineageId` match this journal.
  5. `previousSha256` matches the chain tip for the claimed position, no `plan`
     field, `evidence` present, `state === 'Cancelled'`, and the transition is
     legal from that predecessor.
  6. `validateTransitionEvidence()` and `validateTransitionAgainstPlan()`.
- Any failure marks the whole operation `Corrupt` with the temporary entry's
  path in the issue, so `list()`, `assertNoUnresolved()`, `cancel()`, recovery
  and cross-journal admission all block. Nothing is deleted, renamed,
  overwritten, or repaired; `recover()` performs no writes for this state.

No journal format/version change. No change to `readBoundedFile`, record
validation, ownership checks, root locking, or budgets.

## 4. Regression coverage

`test/storage-copy-operation-journal.test.ts` (69 tests total, all pass):

- **Genuine interrupted temporary file** — real child process died at
  `before-cancellation-publish`; status stays `Prepared` (not `Corrupt`),
  recovery reports `prepared: 1, needsReview: 0`, artifact bytes and vault
  inventory unchanged, admission still blocked by `Prepared`.
- **Matching-name directory** — `Corrupt` with a temporary-artifact issue,
  admission rejects `PARTIAL_WRITE`, repeated recovery stays
  `needsReview: 1, unresolved: true`, directory preserved, inventory unchanged,
  root lock released afterward.
- **Matching-name symlink** — `Corrupt`, admission rejects, recovery unresolved,
  link still a symlink, foreign target bytes untouched, inventory unchanged.
- **Matching-name malformed file** — truncated genuine event bytes; `Corrupt`,
  raw bytes preserved exactly, inventory unchanged.
- **Matching-name unrelated regular file** — a valid journal record copied into
  a temp name; `Corrupt`, `cancel()` also rejects, bytes preserved.
- **Structurally valid event at the wrong chain tip** — `Corrupt`, cannot bypass
  admission or cancellation, evidence and lock state verified.
- **Hard-link leftover (crash after publication)** — stays blocked as before via
  the existing `nlink` record rule; both links and bytes preserved.
- **Repeated recovery** — multiple recoveries produce identical reports and no
  mutations.
- **Cross-journal admission** — a suspicious temp blocks copy preview/admission,
  import application and restore; inventory, import journal bytes and source
  bytes unchanged.
- **Admission blocking / lock release** — asserted in the directory, stale-event
  and cross-journal tests; lock file absent after rejection, later locked
  inspection succeeds.
- The existing interruption test was refactored onto the same child-process
  helper without changing its assertions.

## 5. Verification (executed)

Focused journal suite:

```
node node_modules/vitest/vitest.mjs run test/storage-copy-operation-journal.test.ts
Test Files  1 passed (1)
     Tests  69 passed (69)
```

Related recovery / admission suites:

```
node node_modules/vitest/vitest.mjs run \
  test/storage-copy-operation-journal.test.ts \
  test/storage-copy-preview.test.ts test/note-copy.test.ts \
  test/storage-root-lock.test.ts test/storage-root-lock-recovery.test.ts \
  test/ui-api.test.ts
Test Files  6 passed (6)
     Tests  188 passed (188)
```

```
node node_modules/vitest/vitest.mjs run \
  test/storage-backup.test.ts test/storage-import-limits.test.ts
Test Files  2 passed (2)
     Tests  65 passed (65)
```

Typecheck:

```
node node_modules/typescript/bin/tsc --noEmit                    → TSC_MAIN_OK
node node_modules/typescript/bin/tsc -p tsconfig.ui.json --noEmit → TSC_UI_OK
```

Build:

```
node node_modules/vite/bin/vite.js build --config ui/vite.config.ts
✓ built in 1.07s
```

Only the pre-existing chunk-size advisory was emitted.

Full suite (corrected tree):

```
node node_modules/vitest/vitest.mjs run --maxWorkers=4
Test Files  2 failed | 153 passed (155)
     Tests  2 failed | 1686 passed (1688)
```

Failures:

- `test/storage-database-views.test.ts > saved-view storage and portability >
  duplicates a revision under the root lock and preserves every view type
  through portability`
- `test/storage-import-execution.test.ts > reviewed import publication >
  publishes structured resources, relationships metadata, catalogs, attachments
  and templates through the same plan`

Both are 5000 ms timeouts. Reproducible baseline evidence: a pristine
`git archive 519228f` copy of the parent commit, run with the identical command,
failed `storage-import-execution` with the same test id (20 failed tests across
3 files, including native `storage-executor-lock` failures absent from a built
tree). Both files pass in isolation on the corrected tree:

```
node node_modules/vitest/vitest.mjs run test/storage-database-views.test.ts test/storage-import-execution.test.ts
Test Files  2 passed (2)
     Tests  31 passed (31)
```

No assertion was weakened, skipped, or suppressed. `pnpm` is not on `PATH`;
commands used the installed local binaries (`corepack pnpm` is available but was
not needed).

## 6. Commit

```
3ccc6e772a930138283657ce5cec6bcb74dde74d
fix(storage): validate temporary journal artifacts
parent: 519228fcc81c02ee8f767aaa3abb72bb851cc671
```

One isolated commit; no previous commit modified, no history rewrite.

## 7. Final Git status

```
 M src/storage/fs/copy-operation-journal.ts     (committed in 3ccc6e7)
 M test/storage-copy-operation-journal.test.ts  (committed in 3ccc6e7)
?? .pnpm-store/                                  (pre-existing, untouched)
?? docs/phase19b3-01-terminal-state-policy-correction.md (previous task report)
?? docs/phase19b4-01-temporary-artifact-validation.md     (this report)
```

This report is intentionally uncommitted so the recorded commit hash is exact;
a committed file cannot contain its own commit hash. `.pnpm-store/` was not
touched. No branch switch, reset, rebase, cherry-pick, push, PR, or merge
occurred.

## 8. Remaining limitations

- A crash **during** the initial write (partial event bytes) is now classified
  `Corrupt` and blocks. This is deliberate fail-closed behavior: a partial
  artifact is not provably a cancellation record, so it cannot be recognized
  safely. It is retained for manual review and never auto-repaired.
- A crash **after** the hard link (two-link temp + published event) is already
  rejected by the existing record `nlink` rule and remains blocked; this
  correction intentionally does not relax record validation.
- Temporary artifacts whose suffix is not a UUID already failed closed as
  unknown files and are unchanged by this correction.
- Cleanup of recognized crash artifacts remains manual; the journal still has no
  delete/repair API by design.
- The full suite is not green on this machine under parallel load for unrelated,
  reproducible timeout tests (documented in §5).

---

## Verdict

`CORRECTION COMPLETE — READY FOR INDEPENDENT REVIEW`

No owner acceptance is claimed.
