# Phase 19B reconstruction

The owner approved this reconstructed scope against `63bec0bd884691e3d16928541206c832e1bd9765`. The older candidate supplied implementation evidence. The project owner has since accepted the implementation (`ACCEPTED — Phase 19 M1–M5 reconstruction`) at `3ccc6e772a930138283657ce5cec6bcb74dde74d`; the final independent review found it ready, and the integration is recorded in [phase19-m1-m5-integration-20261120.md](phase19-m1-m5-integration-20261120.md). Merge into the development line still requires a pull request and its review.

- M1 (`618eb43`) defines supported note fields, fresh IDs and timestamps, shared icon validation, and a check for changed resolution of existing wiki links.
- M2 (`cd41edc`) adds a storage preview with instance-local expiring tokens and repeated capture. Entry limits are inclusive. Hidden and specialized entries count when discovered, while skipped directories are not traversed. The scanner reads at most one overflow entry to distinguish a complete inventory at the limit. Deadlines are cooperative.
- M3–M5 add durable preparation, explicit cancellation, and journal admission. Preparation journals evidence only. Publication is deferred.

| Operation | Policy under the root lock |
| --- | --- |
| Copy preview and confirmation, import and restore execution | Reject unresolved or corrupt evidence in either journal. Confirming a copy revalidates the preview before creating its record. Reviewed import checks again before destination writes. |
| Portable import preview and export, backup and restore preview | Reject unresolved transfer journals at the gated snapshot boundary. Preview does not authorize execution. |
| Import recovery and retry | Allow the selected import journal through its own admission check. Block on other unresolved journals before recovery mutations. |
| Copy recovery and cancellation | Block on unresolved import evidence. Cancel only a valid Prepared chain whose reviewed evidence still matches. A valid Cancelled record supports repeated cancellation. |
| Journal status | Remains available for inspecting blocked operations. |

A Prepared copy chain does not carry a publication receipt or grant ownership of any destination. Cancellation verifies the chain and current evidence, records a terminal event, and leaves workspace files alone. Corrupt evidence, an ambiguous external edit, or simultaneous unresolved journals that cannot be safely resolved require manual inspection. Preserve journal bytes and follow the storage lock recovery procedure if a process leaves a stale lock.

An abnormal exit after writing the cancellation event's temporary sibling but before exclusive publication can leave a hidden `.nodus-tmp-<uuid>` file in the operation directory. The journal does not trust that name by itself: it recognizes such an entry only when it satisfies the writer contract — an exclusive, private, single-link regular file holding the complete checksummed bytes of this journal's pending `Cancelled` event bound to the current chain tip, or the same event after a retry or recovery review has superseded it. A recognized leftover is retained and ignored for state determination, so the operation remains inspectable and cancellation can be retried. Any other matching entry — a directory, symlink, hard link, world-readable file, oversized or malformed record, invalid checksum, foreign journal or vault identity, or an event at a position the writer could not have produced — fails closed as corrupt evidence and blocks transfers, recovery mutation and cancellation until a person reviews it. Nodus never deletes, renames, overwrites, or repairs journal evidence automatically, because a name alone cannot prove that another writer does not own the file. Inspect artifacts manually and do not remove them based only on age or appearance. The interruption regressions verify both halves: a genuine leftover stays inert and cancellation still retriable, while an unexplained matching entry surfaces as corrupt and blocks.

The unsupported `Succeeded` and `Failed` journal states, the temporary-artifact contract, and their independent reviews are recorded in [the terminal-state policy correction](phase19b3-01-terminal-state-policy-correction.md) and [the temporary-artifact validation correction](phase19b4-01-temporary-artifact-validation.md). The operator-facing journal policy is in [storage.md](storage.md#note-copy-operation-journal-phase-19m).

The root lock coordinates cooperating Nodus processes. Digests detect accidental corruption. Network filesystems, malicious local modifications, hard memory or CPU guarantees, power-loss durability, and a finite retention policy remain outside this phase. M6 and the move-safe wiki-link work are separate.

## Local verification

- M1 focused suite: 146 tests passed. M2 focused suite: 39 passed.
- Copy lifecycle and transfer admission: 178 tests passed across journal, import execution, backup and restore API in the initial integration run. A subsequent journal and portable freshness run passed 49 tests. The journal suite passed 45 tests after adding restart and cross-journal corruption checks, and the targeted cancellation interruption and retry tests passed.
- Typecheck and production build passed. Vite warned about chunks over 500 kB.
- The import restart smoke passed for interruption during staging, add, replacement and rollback, and for preservation of ambiguous external edits.
- Integration commit `b125bc6` groups M3 and M4 so durable copy preparation and transfer admission enter the branch together. The following commit adds M5 verification and this record.
- The workspace browser smoke passed using a temporary vault.
- The first serial full run passed 154 of 155 files and 1,642 tests. Its 18 failures were in the executor lock suite before the native addon was built. The dedicated executor lock command then built both addons and passed all 32 tests.
- Copy interruption coverage uses injected failure before the terminal rename and a reopened vault. The process-kill smoke exercised the import journal.
- After the native build, the full suite passed all 155 files and 1,662 tests with two workers. The final journal and API files passed 108 focused tests, including a subprocess exit before copy cancellation rename and restore rejection followed by successful restore after cancellation. The subprocess test removes the stale lock only after confirming the child has exited in an isolated temporary vault.
