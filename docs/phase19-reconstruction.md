# Phase 19B reconstruction

The owner approved this reconstructed scope against `63bec0bd884691e3d16928541206c832e1bd9765`. The older candidate supplied implementation evidence. Implementation acceptance is pending review.

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
