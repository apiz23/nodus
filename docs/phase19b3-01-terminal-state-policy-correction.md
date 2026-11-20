# Phase 19B.3 — F19B3-01 Journal Terminal-State Policy Correction

**Status:** Correction only. No owner acceptance is implied or claimed.
**Repository:** `/Users/ocgt/Desktop/nodus-phase19-reconstruction`
**Branch:** `feature/phase19-reconstruction-m1-m5`
**Base commit:** `63bec0bd884691e3d16928541206c832e1bd9765`
**Parent of correction:** `1230403ad3cbb76a8816943fa5cd7450eafb8266`
**Correction commit:** `519228fcc81c02ee8f767aaa3abb72bb851cc671`

---

## 1. Original finding and root cause

**F19B3-01 — MEDIUM — Copy-operation journal terminal-state policy inconsistency.**

One journal state had three different meanings:

| Location | Behavior before the correction |
| --- | --- |
| `list()` | `Succeeded` / `Failed` reported as `NeedsReview` |
| `isTerminal()` | `Succeeded` / `Failed` treated as resolved |
| `assertNoUnresolved()` | therefore allowed new copy and import admission |
| `recover()` | counted `Succeeded` / `Failed` as `terminal`, `unresolved: false` |

Root cause: resolution was decided by a private `isTerminal()` helper that
equated "structurally terminal" with "resolved", while public status used a
separate inline rule that disagreed. Recovery used `isTerminal()` implicitly
through its fallthrough counter. Three interpretations, one evidence set.

The prior synthetic regression test (`keeps proven terminal states retained and
non-blocking`) encoded the permissive interpretation and was replaced, not
preserved, because source investigation showed that interpretation was
unsupported (see §2).

## 2. Source-level investigation

Inspected:

- `src/storage/fs/copy-operation-journal.ts`
- `src/storage/contracts.ts`
- `src/storage/fs/vault.ts` (transfer admission, root-lock boundaries)
- `src/storage/fs/root-lock.ts`
- `test/storage-copy-operation-journal.test.ts`
- `test/storage-copy-preview.test.ts`, `test/note-copy.test.ts`,
  `test/storage-root-lock*.test.ts`, `test/ui-api.test.ts`
- `git log -S "isTerminal"` and the M1–M5 commit history

Findings against the required questions:

1. **What events can end in `Succeeded` or `Failed`?**
   `Published -> Succeeded` (terminal receipt bound to the preceding published
   event) and `Prepared|Publishing -> Failed` (structured no-effect proof).
   Both are legal per `isLegalCopyOperationTransition()`.
2. **Are they supported by the reconstructed M1–M5 implementation?**
   No. No production code path writes `Publishing`, `Published`, `Succeeded`,
   or `Failed`. The only transitions ever written are `Prepared`, `Cancelled`,
   and `NeedsReview`. `git log -S` confirms `isTerminal` entered with the
   journal skeleton, not with a publisher.
3. **Can their filesystem effects be independently verified?**
   No. `Succeeded` binds to a `Published` receipt, but the receipt's
   `dev`/`ino`/`ownershipEvidenceSha256` are self-asserted journal bytes and no
   publisher or verifier exists to check them against the filesystem. `Failed`
   carries a checksummed `observedAt` proof of destination/staging absence, but
   nothing can confirm that observation still holds or was ever true, and
   recovery does not know the staging path.
4. **Why did `list()` report `NeedsReview`?**
   Correctly conservative: no qualified publisher or recovery verifier exists,
   so the public contract (which only exposes `Prepared`, `Cancelled`,
   `NeedsReview`) cannot report these as completed.
5. **Why did admission consider them resolved?**
   `assertNoUnresolved()` reused `isTerminal()`, conflating "no further legal
   transitions" with "verified outcome", which let unverifiable chains bypass
   the unresolved-journal gate.
6. **Can recovery distinguish supported from unsupported terminal events?**
   Yes. `Cancelled` is written only after `proveNoEffect()` succeeds and is
   revalidated on cancellation retry. `Succeeded`/`Failed` are never written by
   this implementation and have no verifier.
7. **Smallest change making status, recovery and admission agree?**
   Replace the three separate interpretations with two shared helpers:
   `isResolvedCopyOperationState()` for resolution and
   `toPublicCopyOperationState()` for public reporting. No journal version bump,
   no schema change, no evidence rewrite.

Note: `contracts.ts` already declares
`CopyOperationState = 'Prepared' | 'Cancelled' | 'NeedsReview'`, corroborating
that extended states are internal, unsupported evidence rather than supported
outcomes.

## 3. Final terminal-state policy

One semantic rule: **only `Cancelled` is resolved.**

| Journal condition | Public status | Admission | Recovery |
| --- | --- | --- | --- |
| `Prepared` | `Prepared` | Block (unchanged) | Validate; keep blocking |
| `Publishing` / `Published` | `NeedsReview` | Block | Append one `NeedsReview`, keep blocking |
| `NeedsReview` | `NeedsReview` | Block | Retain unchanged, keep blocking |
| `Cancelled` (proven no-effect) | `Cancelled` | Allow (unchanged) | `terminal++`, resolved |
| Unsupported `Succeeded` | `NeedsReview` | **Block (new)** | Retain unchanged, `needsReview++`, unresolved |
| Unsupported `Failed` | `NeedsReview` | **Block (new)** | Retain unchanged, `needsReview++`, unresolved |
| Corrupt / malformed chain | `Corrupt` | Block | Retain evidence, report issue |
| Any future unclassified state | — | Block | `needsReview++`, unresolved (fail-closed) |

No automatic deletion, repair, rewriting, or synthetic `NeedsReview` append is
performed on `Succeeded`/`Failed` evidence: terminal transitions are illegal
and the evidence must remain inspectable.

## 4. Production files changed

- `src/storage/fs/copy-operation-journal.ts`
  - Added `isResolvedCopyOperationState(state)`: single resolution rule
    (`Cancelled` only), used by `assertNoUnresolved()` and the `cancel()`
    cross-operation gate.
  - Added `toPublicCopyOperationState(state)`: single public mapping, used by
    `list()`; `Publishing`, `Published`, `Succeeded`, `Failed` → `NeedsReview`.
  - `recover()`: explicit `Succeeded`/`Failed` branch that counts `needsReview`,
    sets `unresolved`, records an issue, and leaves evidence untouched; the
    terminal counter is now guarded by the shared resolution rule; remaining
    unclassified states fail closed.
  - Removed `isTerminal()`.
  - Documented the policy in the `recover()` contract comment.

No changes to checksum, transition, ownership, path, identity, budget, or
root-lock validation. No journal format/version change.

## 5. Test files changed

- `test/storage-copy-operation-journal.test.ts`
  - Added `addSucceeded()` helper.
  - Replaced the old permissive terminal-state test with policy tests
    (A, B, C, E, F below).
  - Added two cross-journal admission tests (D).

## 6. Exact behavior before and after

| Scenario | Before | After |
| --- | --- | --- |
| `list()` on `Succeeded` | `NeedsReview` | `NeedsReview` (unchanged) |
| `assertNoUnresolved()` with `Succeeded` | resolves (allowed) | rejects `PARTIAL_WRITE` |
| `recover()` with `Succeeded` | `terminal: 1, unresolved: false` | `needsReview: 1, unresolved: true`, evidence unchanged |
| `assertNoUnresolved()` with `Failed` | resolves (allowed) | rejects `PARTIAL_WRITE` |
| `recover()` with `Failed` | `terminal: 1, unresolved: false` | `needsReview: 1, unresolved: true`, evidence unchanged |
| `cancel()` while another op is `Succeeded`/`Failed` | allowed | blocked as unresolved |
| `Cancelled` operation | resolved, non-blocking | resolved, non-blocking (unchanged) |
| Import/restore admission beside unsupported terminal chain | allowed | blocked `PARTIAL_WRITE` |
| Root lock after rejection | released | released (verified) |

## 7. Regression coverage

- **A. Unsupported `Succeeded`** —
  `reports an unsupported Succeeded chain as NeedsReview and keeps it blocking`:
  public status, `assertNoUnresolved()`, recovery report/issue, evidence and
  full vault inventory unchanged.
- **B. Unsupported `Failed`** —
  `reports an unsupported Failed chain as NeedsReview and keeps it blocking`:
  same assertions with a structurally valid no-effect-proof chain.
- **C. Supported terminal operation** —
  `keeps a proven Cancelled operation resolved and non-blocking`: `Cancelled`
  status, admission allowed, `recover()` → `terminal: 1, needsReview: 0`.
- **D. Cross-journal admission** —
  `blocks import and restore while a copy journal holds an unsupported
  Succeeded terminal state` (assertNoUnresolved, applyImport, restoreBackup,
  previewNoteCopy, inventory/evidence unchanged);
  `blocks copy admission while an unresolved import journal exists beside
  unsupported copy evidence` (preview, admission, cancellation blocked; import
  journal bytes and vault inventory unchanged).
- **E. Recovery idempotency** —
  `keeps repeated recovery of unsupported terminal evidence unchanged and
  mutation-free`: three recoveries, identical reports, identical evidence and
  inventory.
- **F. Lock integrity** —
  `releases the root lock after an unsupported terminal state rejects
  admission`: repeated rejections, subsequent locked inspection succeeds, lock
  file absent; related root-lock suites pass.

All tests exercise public admission/recovery boundaries, not helper return
values.

## 8. Targeted test results

```
corepack pnpm vitest run test/storage-copy-operation-journal.test.ts
Test Files  1 passed (1)
     Tests  61 passed (61)
```

Re-run after the final documentation edit: 61 passed (61).

```
node node_modules/vitest/vitest.mjs run \
  test/storage-copy-operation-journal.test.ts \
  test/storage-copy-preview.test.ts \
  test/note-copy.test.ts \
  test/storage-root-lock.test.ts \
  test/storage-root-lock-recovery.test.ts
Test Files  5 passed (5)
     Tests  117 passed (117)
```

```
node node_modules/vitest/vitest.mjs run test/ui-api.test.ts
Test Files  1 passed (1)
     Tests  63 passed (63)
```

## 9. Full test results

```
node node_modules/vitest/vitest.mjs run --maxWorkers=4
Test Files  1 failed | 154 passed (155)
     Tests  1 failed | 1679 passed (1680)
```

The single failure is
`test/storage-import-execution.test.ts > reviewed import publication > publishes
structured resources, relationships metadata, catalogs, attachments and
templates through the same plan` — `Test timed out in 5000ms`.

This failure is **pre-existing and environmental**, not caused by the
correction:

- A pristine `git archive HEAD` (commit `1230403`) copy in
  `/private/var/.../opencode/phase19-baseline` fails the **same test id** in
  isolation with the same 5000ms timeout.
- Two full-suite baseline runs on that pristine copy failed 75 tests / 14 files
  and 15 files respectively (sync, plugin, relation, backup-order, executor-lock
  and import suites), all timeouts under machine load.
- The equivalent full run on the corrected tree with default workers failed
  63 tests / 12 files — a strict subset of the baseline flaky set, and no
  copy-journal, root-lock, or admission test failed in any run.

No assertion was weakened, skipped, or suppressed.

## 10. Typecheck and build results

```
node node_modules/typescript/bin/tsc --noEmit           → TSC_MAIN_OK
node node_modules/typescript/bin/tsc -p tsconfig.ui.json --noEmit → TSC_UI_OK
node node_modules/vite/bin/vite.js build --config ui/vite.config.ts
✓ built in 888ms
```

Build emitted only the pre-existing chunk-size advisory.

`pnpm` was not on `PATH`; the repository's pinned pnpm 11.9.0 was invoked
through `corepack pnpm` for the targeted run, and the installed local binaries
were used for the remaining commands. No dependency or lockfile changes were
made.

## 11. Recovery and cross-journal verification

- Recovery retains unsupported `Succeeded` and `Failed` chains byte-for-byte
  across repeated runs; no transition is appended because none is legal from a
  terminal state.
- Both journals keep blocking each other: unsupported copy evidence blocks
  import and restore; unresolved import evidence blocks copy preview,
  confirmation, and cancellation. Vault inventories were compared before/after
  and were identical.
- Root-lock acquisition after rejection was verified explicitly and by the
  existing root-lock suites.

## 12. Git commit hash

```
519228fcc81c02ee8f767aaa3abb72bb851cc671
fix(storage): block unsupported terminal journal states
parent: 1230403ad3cbb76a8816943fa5cd7450eafb8266
```

This report is intentionally left outside that commit so the recorded hash is
exact; the repository tip is the single correction commit above.

## 13. Final Git status

```
 M src/storage/fs/copy-operation-journal.ts        (committed in 519228f)
 M test/storage-copy-operation-journal.test.ts     (committed in 519228f)
?? .pnpm-store/                                     (pre-existing, untouched)
?? docs/phase19b3-01-terminal-state-policy-correction.md (this report)
```

No previously accepted commit was modified. History was not rewritten.

## 14. Remaining limitations

- No publisher exists, so a future one must supply a verified `Succeeded`
  transition (and/or a verifiable `Failed` proof) and explicitly amend
  `isResolvedCopyOperationState()` with tests before those states can become
  non-blocking.
- Unsupported terminal evidence has no automated remedy; it requires manual
  review by design. Recovery deliberately never rewrites it.
- `Cancelled` resolution relies on the cancellation-time no-effect proof, as
  before; it is not re-verified on every admission (unchanged accepted
  behavior).
- The local machine exhibits pre-existing full-suite timeouts at `HEAD`;
  verification above distinguishes those from this change.

## 15. Push / PR / merge statement

No `git push`, no pull request, and no merge occurred. No branch switch, reset,
rebase, or cherry-pick occurred. `.pnpm-store/` was not touched.

---

## Verdict

`CORRECTION COMPLETE — READY FOR INDEPENDENT REVIEW`

No owner acceptance is claimed.
