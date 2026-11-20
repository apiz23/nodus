# Phase 19 M1–M5 — Integration Record

**Date:** 2026-11-20
**Task:** Integrate the accepted Phase 19 M1–M5 reconstruction into the current Nodus development line in an isolated worktree.
**Outcome:** Integration complete, full test suite green under serialized execution, ready for PR review. No push, PR, or merge performed.

---

## 1. Owner acceptance

- Decision: **ACCEPTED — Phase 19 M1–M5 reconstruction.**
- Final independent acceptance review verdict: `READY FOR OWNER ACCEPTANCE`.
- Accepted branch: `feature/phase19-reconstruction-m1-m5`
- Accepted HEAD: `3ccc6e772a930138283657ce5cec6bcb74dde74d` (`fix(storage): validate temporary journal artifacts`)
- Accepted original base: `63bec0bd884691e3d16928541206c832e1bd9765`
- Accepted commit range: the 12 commits after `63bec0b` (see §4).
- This record does not reopen or restate that decision; it integrates the accepted artifact.

## 2. Pre-integration state inspection

**Task-specified primary path discrepancy (reported, not silently adjusted):** the requested path
`/Users/ocgt/Desktop/nodus-phase19-30-visual-integration` does not exist. The existing primary
development worktree is `/Users/ocgt/Desktop/nodus-phase32-30-visual-integration`; it was inspected
read-only and **not modified**.

Primary development worktree (`nodus-phase32-30-visual-integration`):

| Item | Observed |
| --- | --- |
| Branch | `main` |
| HEAD | `003603b6c55a5675c73cfc3c2365cb289a0b1412` — `feat(graph): central interactive graph, local depth, filters and polish` |
| `origin/main` (local ref) | `63bec0b` |
| Remote truth | `git ls-remote origin refs/heads/main` → `63bec0b` → local `origin/main` **is current**; no fetch required, none performed |
| Local `main` vs `origin/main` | diverged; merge-base `f13764a`; `main` +1 (`003603b`), `origin/main` +3 (`59a0275` #23, `aacbad8` #24, `63bec0b` #25) |
| Working tree | **14 tracked files modified** (+759/−96), including `src/storage/{contracts.ts,fs/vault.ts,fs/scan.ts,fs/root-lock.ts,backup/backup.ts,portable/import.ts}`, `src/ui-server/page-icon.ts`, `docs/ROADMAP.md`, `src/storage/errors.ts`, 4 test files |
| Untracked | 45 paths, including `docs/phase19-*` planning/audit documents and `acceptance-screenshots/` |
| Stashes | 6 present |
| Unfinished work | Yes — the tracked modifications mirror the older Phase 19 candidate work and were left exactly as found |
| Reconstruction commits already in `main` | No — `git branch --contains 3ccc6e7` lists only `feature/phase19-reconstruction-m1-m5` |
| Overlap risk from current `main` | `main`'s unique commit touches 11 files; intersection with the Phase 19 file set is **empty** |

Accepted reconstruction worktree (`nodus-phase19-reconstruction`), verified before integration and
re-verified after: branch `feature/phase19-reconstruction-m1-m5`, HEAD `3ccc6e7`, base `63bec0b`
is an ancestor, 12 commits in range, no tracked or staged changes, and only the expected untracked
`.pnpm-store/` plus the two correction reports. Nothing there was deleted, staged, or rewritten.

## 3. Integration base, branch, and worktree

- Integration base: **verified-current `origin/main` = `63bec0b`** (chosen from remote truth, not assumed).
- New worktree: `/Users/ocgt/Desktop/nodus-phase19-integration` (did not previously exist).
- New branch: `integration/phase19-m1-m5` tracking `origin/main` (did not previously exist).
- No existing worktree or branch was overwritten; `git worktree add -b` was used.

## 4. Commits integrated

Because the accepted reconstruction is based on the same commit that is current `origin/main`, the
integration is a pure fast-forward — the strongest possible fidelity and zero conflicts:

```
git merge --ff-only feature/phase19-reconstruction-m1-m5
→ integration/phase19-m1-m5 HEAD == 3ccc6e772a930138283657ce5cec6bcb74dde74d (exact SHA match)
```

Integrated commits, oldest first:

| SHA | Subject | Milestone / finding |
| --- | --- | --- |
| `618eb43` | feat(storage): add note copy domain foundation | M1 |
| `cd41edc` | feat(storage): add bounded note copy preview | M2 |
| `b125bc6` | feat(storage): coordinate copy preparation with import recovery | M3–M5 |
| `5adfa5b` | test(storage): verify copy cancellation and document recovery policy | M5 verification |
| `56fd98f` | docs(storage): record Phase 19 integration verification | record |
| `bb7fb22` | test(storage): cover copy interruption and restore admission | F19B2 coverage |
| `1866ee4` | fix(storage): publish copy cancellation events exclusively | F19B1-01 |
| `ec9da41` | fix(storage): capture backups from one vault snapshot | F19B1-02 |
| `b0c9a77` | test(storage): cover dual-journal recovery admission | F19B1-03 |
| `1230403` | docs(storage): document retained cancellation artifacts | record |
| `519228f` | fix(storage): block unsupported terminal journal states | F19B3-01 |
| `3ccc6e7` | fix(storage): validate temporary journal artifacts | F19B4-01 |

History preservation: all 12 accepted commit SHAs are identical on the integration branch. No
cherry-pick, squash, rebase, amend, or rewrite was used. Verification that no behavior was altered
during integration: `git diff 3ccc6e7 -- src/` is **empty**.

### Conflicts

None. Fast-forward with zero conflicting paths, because the integration base equals the accepted
reconstruction base and no `origin/main` change overlaps the Phase 19 file set. No functionality was
omitted and no architectural redesign was introduced.

## 5. Post-integration commits

Integration-time commits on `integration/phase19-m1-m5` (this record is the branch tip, third commit):

| SHA | Subject | Contents |
| --- | --- | --- |
| `228f204` | test(storage): cover temporary artifact rejection branches | 5 new regression cases + event-only helper |
| `f5fdf72` | docs(storage): document the note-copy journal policy | `docs/storage.md` journal section, `docs/phase19-reconstruction.md` correction, both correction reports |

## 6. Documentation improvements (review items 1–3)

1. **Stale temporary-artifact description corrected** — `docs/phase19-reconstruction.md` no longer
   says the reader ignores a recognized temporary *name*. It now states the writer contract
   (exclusive, private, single-link regular file holding the complete checksummed pending
   `Cancelled` event bound to the chain tip, or its superseded leftover), and that a directory,
   symlink, hard link, permissive file, oversized/malformed record, invalid checksum, foreign
   journal/vault identity, or impossible chain position **fails closed as corrupt evidence** and
   blocks transfers, recovery mutation, and cancellation, with no automatic deletion or repair.
2. **Correction reports integrated verbatim** —
   `docs/phase19b3-01-terminal-state-policy-correction.md` and
   `docs/phase19b4-01-temporary-artifact-validation.md` are now committed on the integration branch,
   unedited, preserving findings, evidence, and the independent-review verdicts. Their recorded
   commit hashes remain valid because the accepted SHAs were preserved exactly.
3. **New `docs/storage.md` section** — “Note-copy operation journal (Phase 19M)” (pure addition,
   +61 lines) covering purpose and scope, layout, preparation and cancellation, resolved versus
   unresolved states, admission blocking, recovery behavior, corrupt and ambiguous evidence, the
   temporary-artifact policy, manual review responsibilities, and the journal limitations. The
   pre-existing “Vault switching allow-list” section is intact.

All statements were checked against the implementation (constants, gating call sites, error codes)
rather than copied from prior reports.

## 7. Regression tests added (review item 4)

In `test/storage-copy-operation-journal.test.ts`, journal suite 69 → 74 tests:

| Case | Assertion focus |
| --- | --- |
| Permissive mode (`0644`) temporary file | `Corrupt` with temporary-artifact issue, admission rejected, recovery `needsReview: 1`/`unresolved: true`, mode bit and vault inventory unchanged |
| Foreign vault identity (valid checksum) | `Corrupt`, admission and cancellation rejected, bytes and inventory unchanged |
| Invalid temporary checksum | same public-boundary assertions |
| Invalid temporary event schema | same public-boundary assertions |
| Superseded temporary artifact after recovery appends `NeedsReview` | operation stays `NeedsReview` (not `Corrupt`), chain is exactly `Prepared,NeedsReview`, repeated recovery deterministic and idempotent, artifact bytes and inventory unchanged, admission still blocked |

`writeCancellationTemporary()` gained option fields (`mode`, `vaultInstanceId`, `vaultLineageId`,
`extraFields`, `sha256`) and an `eventRecordStates()` helper was added so assertions read only
`event-*.json` records rather than the temporary artifact itself. Existing conventions, bounds, and
assertion style were preserved; no production code changed and no test scope was broadened.

## 8. Verification results (integration worktree)

| Command | Result | Exit |
| --- | --- | --- |
| `vitest run` core M1–M5 (note-copy, resolver-stability, copy-preview, scan-budget, root-lock, root-lock-recovery, copy-journal) | **160/160** | 0 |
| `vitest run --maxWorkers=1` cross-transfer batch (journal, import execution/limits, backup, backup-order, portable ×4, `ui-api`, `ui-import-preview-api`, `ui-backup`) | **289/289** | 0 |
| `tsc --noEmit` (main) | clean | 0 |
| `tsc -p tsconfig.ui.json --noEmit` (UI) | clean | 0 |
| `vite build --config ui/vite.config.ts` | built; only the pre-existing >500 kB chunk advisory | 0 |
| `pnpm test:executor-lock` (native addon build + suite, serialized) | **32/32** | 0 |
| `vitest run --maxWorkers=4` full suite (first run, before the native build) | 1674/1693; 18 `storage-executor-lock` failures + 1 `storage-import-execution` timeout | 1 |
| `vitest run --maxWorkers=4` full suite (after the native build) | 1691/1693; `storage-import-execution` timeout + `editor-outline` assertion | 1 |
| `vitest run --maxWorkers=1 test/editor-outline.test.ts test/storage-import-execution.test.ts` | **21/21** | 0 |
| **`vitest run --maxWorkers=1` full suite (authoritative)** | **155/155 files, 1693/1693 tests** | **0** |

### Parallel-run failures, classified with evidence (no blanket “flaky”/“baseline” labels)

- **Reproduced at the accepted parent:** `storage-import-execution > … publishes structured
  resources … through the same plan` timed out at 5000 ms. The same test id was reproduced on a
  pristine `git archive` of the accepted parent on 2026-11-19 and again on 2026-11-20. The file is
  untouched by the reconstruction (`git log 63bec0b..HEAD -- test/storage-import-execution.test.ts`
  is empty) and it passes serialized.
- **Contention-sensitive, root cause identified:** `editor-outline > extracts ATX and Setext
  headings …` failed once under 4 workers and passed serialized. `ui/src/editor/documentOutline.ts:110`
  parses with `ensureSyntaxTree(state, state.doc.length, 30)` and falls back to a partial tree, so a
  CPU-starved run can legitimately drop a heading. Neither file is touched by this integration.
- **Worktree-environmental, resolved:** the 18 `storage-executor-lock` failures came from a missing
  native addon build in the newly created worktree (`classification: 'uncertain'`). Running the
  repository's own `pnpm test:executor-lock` built the addon and the suite passed 32/32. Not an
  implementation issue.
- **Actual implementation regressions observed:** none, in any run mode.
- **Failures without a verified baseline:** the single `editor-outline` occurrence is explained by
  the 30 ms parse budget and serialized passing, but was not separately reproduced on a parent
  archive; classified as contention-sensitive rather than proven pre-existing.

## 9. Comparison against the accepted reconstruction

- Source: identical (`git diff 3ccc6e7 -- src/` empty).
- Tests: accepted 69 journal cases all retained, plus the 5 new cases; every other suite unchanged.
- Behavior: accepted invariants re-verified in the integration worktree — journal suite 74/74,
  cross-journal admission, cancellation, recovery idempotency, snapshot/backup gating, and the
  `Cancelled`-only resolved-state policy.
- Accepted branch, accepted worktree, its untracked `.pnpm-store/` and its untracked correction
  reports: unchanged (re-verified after integration).

## 10. Git status at handoff

Integration worktree:

```
On branch integration/phase19-m1-m5 (tracks origin/main)
HEAD docs(storage): record Phase 19 M1-M5 integration        (this record)
  ← f5fdf72 docs(storage): document the note-copy journal policy
  ← 228f204 test(storage): cover temporary artifact rejection branches
  ← 3ccc6e7 fix(storage): validate temporary journal artifacts   (accepted HEAD, exact SHA)
nothing to commit except an untracked local node_modules symlink (see §11)
```

Unchanged elsewhere: `feature/phase19-reconstruction-m1-m5` at `3ccc6e7`; `main` at `003603b` with
its 59 working-tree entries and 6 stashes; `origin/main` at `63bec0b`. No push, no PR, no merge, no
branch or worktree deletion, no history rewrite.

## 11. Remaining limitations and conditions for the owner

Non-blocking, none requiring another reconstruction or correction phase:

1. **Local `main` divergence.** `main` (`003603b`) is one commit ahead and three behind
   `origin/main`, and the primary worktree holds uncommitted Phase 19-candidate edits plus 45
   untracked paths. Reconciling that is a separate owner decision; this integration deliberately
   used `origin/main`, and no overlap exists with the Phase 19 file set.
2. **Worktree dependency link.** `nodus-phase19-integration/node_modules` is an untracked symlink to
   the reconstruction worktree's install for verification convenience. Run a real
   `pnpm install` (or keep the link locally) before depending on this worktree long-term; it is not
   committed and `.gitignore`'s `node_modules/` pattern does not match a symlink, so it shows as
   untracked.
3. **Fresh worktrees need the native build.** `pnpm test:executor-lock` (or the build script) must
   run once per new worktree, otherwise 18 executor-lock tests fail for environmental reasons.
4. **Journal operational limits remain as accepted:** no retention/cleanup policy, manual review for
   ambiguous or partial temporary artifacts, cooperating-process locking only, POSIX assumptions, and
   no power-loss or network-filesystem guarantees. Destination publication remains deferred to M6.
5. **Timing-sensitive suites.** Under parallel load, 5000 ms test budgets and the 30 ms outline parse
   budget can fail spuriously; CI should serialize those suites or raise their timeouts.

## 12. Verdict

**INTEGRATION COMPLETE — READY FOR PR REVIEW**

The accepted reconstruction is integrated on `integration/phase19-m1-m5` with identical commit SHAs,
zero conflicts, the acceptance review's four documentation/test follow-ups implemented, and a fully
green serialized full suite (1693/1693, 155/155 files) plus clean typechecks and production build.

No PR approval is claimed. Nothing was pushed, opened, or merged.
