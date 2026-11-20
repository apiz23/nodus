# Phase 19 M6.2 — Copy Publication Execution

**Status:** implemented on `feature/phase19-m6-1-capability-identity`; pending one independent review and owner acceptance. Not merged, not owner-accepted, M6.3 not started.

**Foundations (owner-accepted, unchanged):** M1–M5 baseline `6bae516`, M6.1/M6.1R/M6.1R2 HEAD `4d3837d`.

**Scope:** the bounded execution machinery for publishing one prepared note copy — live destination authorization, private staging, exclusive no-replace publication, durable receipt evidence, and fail-closed admission for leftover publication evidence. Publication remains **disabled in production**: the capability allowlist is still empty and no runtime probe exists, so every production call is refused before any filesystem mutation.

## 1. What M6.2 decides from the accepted §10 prerequisites

| §10 prerequisite | M6.2 decision |
| --- | --- |
| Where staged bytes live | New hidden vault-root directory `.nodus-copy-staging/<operationId>/<attemptId>.{json,stage}`. **Not** inside the journal operation directory: the accepted F19B4-01 temporary-artifact contract recognizes only its own `.nodus-tmp-<uuid>` cancellation sibling there, and the journal root is structurally limited to `vault.json` + `operations/`. Hidden root directories are already invisible to scans, export and backup, exactly like the journal. |
| No-replace publication protocol | Stage → `link(stage, destination)` (fails `EEXIST`, never replaces) → verify destination inode/dev/size against the staged inode → `chmod 0644` on the published inode → fsync parent → remove staged bytes → write receipt → remove descriptor. |
| Live inventory case/NFC verification | Under the vault root lock: every destination parent segment is `lstat`ed and must be a regular directory (symlinks refused); the destination must not exist; the parent directory is enumerated (50 000-entry bound) and any sibling whose NFC-lowercased name equals the folded destination name is a collision. |
| Evidence location | `.nodus-copy-publication/<operationId>/<attemptId>.json` (receipt), `.nodus-copy-staging/...` (staging descriptor + bytes). Both are inspected and surfaced; no automatic cleanup of ambiguous evidence. |
| Journal state transitions / retry / rollback (M6.3) | **Deliberately not implemented.** M6.2 appends no journal event and changes no journal state. A successfully published operation therefore remains `Prepared` and keeps blocking admission until M6.3 defines resolution/recovery. |
| Trusted provenance, nonces, attestation (M6.3) | **Deliberately not implemented.** Nothing in M6.2 claims freshness or attestation; receipts are unkeyed corruption checks. |
| Native qualification / allowlist (M6.4) | **Not implemented.** M6.2 supplies an explicit "no runtime probe" input, so even a future allowlist entry cannot be satisfied by this slice. |

## 2. Execution protocol

`executeCopyPublication(root, { operationId, attemptId, serializedBytes })` runs entirely inside one vault root-lock acquisition:

1. **Capability gate.** The production policy is `assessFilesystemPublicationCapability` over a fixed probe `{ requested: true, platform: process.platform, filesystem: null, primitiveSupport: 'unknown' }`; with the empty allowlist this is always `unavailable`, and the call throws `PUBLICATION_CAPABILITY_REFUSED` before any path work. An internal test seam can inject an assessment; it is not exported from any barrel and no vault method calls the executor.
2. **Durable binding.** The Prepared record is read from disk through the journal's own inspection path (`CopyOperationJournal.readPreparedEvent`, additive read-only). The publication identity is then built with `createCopyPublicationIdentity`, so `preparedEventSha256` is the journal's canonical digest and caller data cannot bind a foreign event. Missing operation → `NOT_FOUND`, corrupt → `PARTIAL_WRITE`, non-`Prepared` → `CONFLICT`.
3. **Byte integrity.** The supplied bytes must hash to the plan's `serializedSha256` and match `serializedBytes` exactly (≤32 MiB); otherwise `INVALID_CONTENT` with nothing staged.
4. **Idempotency and receipt integrity.** An existing receipt for this operation/attempt is parsed and digest-verified: valid → `already-published` with no mutation; unreadable or mismatched → `PARTIAL_WRITE` (preserved, destination untouched).
5. **Live destination authorization** (see §1).
6. **Private staging.** `0700` directories, `0600` descriptor (`8 KiB` cap) and bytes (`32 MiB` cap), exclusive creation, per-file fsync, directory fsync, inode re-verification.
7. **Exclusive publication** via hard link, then inode/size verification against the staged inode, mode normalization, parent-directory fsync. A racing destination surfaces as `CONFLICT` and the executor removes only its own staging evidence.
8. **Durable receipt**, then removal of the staging descriptor and its now-empty directory.
9. **Result:** `{ kind: 'published', operationId, attemptId, destinationPath, contentSha256, objectIdentity, receiptSha256 }`.

### Crash windows

| Crash point | On-disk state | Classification |
| --- | --- | --- |
| Before staging | nothing | nothing to review |
| After staging directories/files | descriptor and/or stage present | staging residue → admission blocked |
| After `link`, before verification | destination + staging (linked inode) | staging residue blocks; no silent cleanup |
| After staged bytes removed, before receipt | destination + **descriptor only** | staging residue blocks; receipt absence is visible |
| Receipt write fails | destination published + descriptor preserved | `PARTIAL_WRITE` naming the destination and receipt path; no rollback |
| After receipt, before descriptor removal | destination + valid receipt + descriptor | residue blocks until a human removes the descriptor (fail-closed) |

## 3. Evidence inspection and admission

`inspectCopyPublicationEvidence(root)` is read-only and bounded (64 staging operations, 4 attempts each, 256 receipt operations, 8 receipts each, 8 KiB records, 32 reported issues). Rules:

- missing directories ⇒ no evidence;
- a symlinked/non-directory/group- or world-accessible root ⇒ unresolved;
- any staging entry (recognized or not, paired or lone) ⇒ unresolved, because a staged or interrupted publication must be reviewed by a person;
- receipt schema/digest/identity mismatches ⇒ unresolved; valid receipts are reported but do not resolve anything by themselves.

`assertNoUnresolvedPublicationEvidence` is wired into the existing admission boundaries: `assertTransferAdmissionUnlocked` (copy preview/confirm, import, restore, reviewed import), both portable snapshot boundaries (backup/export/restore preview), copy recovery and cancellation. Unresolved evidence throws `PARTIAL_WRITE` with the evidence paths and issues. Journal semantics, recovery behavior and resolution policy are unchanged.

## 4. Security properties

- **No overwrite is expressible:** publication is a hard link into an absent name; the vault path is re-checked under the lock and `EEXIST` is a hard failure. The executor never opens the destination for writing and never deletes a destination.
- **No path escape / symlink following:** relative path resolution uses the accepted `resolveInsideRoot`; each parent segment must be a real directory; the final entry must be absent.
- **No uncontrolled writes:** staging and receipts are private (`0700`/`0600`), exclusive-created, fsynced, inode-verified, size-bounded.
- **No silent evidence loss:** only the executor's own staging files (verified by inode during the same locked run) are ever removed; ambiguous evidence is preserved and blocks.
- **No capability expansion:** the allowlist stays empty and frozen; production probes are explicitly unavailable; the executor and its test seam are absent from `src/index.ts` and `src/storage/index.ts`.
- **No attestation claim:** receipts are unkeyed digests for corruption detection. `publishedAt` proves nothing about freshness.

## 5. Enabled and disabled capabilities

| Capability | State |
| --- | --- |
| Publish a prepared copy in production | **Disabled** (empty allowlist + unavailable production probe) |
| Publish in tests via injected capability | Enabled, internal seam only |
| Read durable Prepared records | Enabled (read-only) |
| Live destination authorization | Enabled inside the executor |
| Journal transitions / published-state resolution | **Not implemented (M6.3)** |
| Recovery/retry/rollback of publication | **Not implemented (M6.3)** |
| Runtime probe, qualification, allowlist entry | **Not implemented (M6.4)** |
| HTTP/UI publication route | **Not implemented** (no route; `api.ts` unchanged in M6.2) |

## 6. Compatibility

- Journal v1 format, validation, state machine, recovery, cancellation and admission semantics are unchanged; the only journal change is an additive read-only method plus its result type.
- Accepted suites pass unmodified, including all M1–M5 journal/preview/copy/import/backup/portable/root-lock/UI tests.
- `vault.ts` changes are additive fail-closed calls at five existing admission boundaries; they do not alter journal checks, ordering of existing gates, or error codes for existing paths. Vaults without publication evidence behave exactly as before.

## 7. Verification (this worktree, serialized)

| Command | Result |
| --- | --- |
| M6.2 suite `test/storage-copy-publication-execution.test.ts` | **23/23** |
| Contract + journal + preview + note-copy + resolver-stability + scan-budget + import-limits + M6.2 (8 files) | **233/233** |
| Transfer/UI batch (14 files) | **239/239** |
| `tsc --noEmit` / `tsc -p tsconfig.ui.json --noEmit` | pass / pass |
| `vite build` (outDir outside the repository) | pass, 872 ms |
| **Full serialized suite** | **157 files, 1,783/1,783**, 288 s |

Counts reconcile with the accepted baseline: 1,760 previously + 23 new = 1,783; files 156 + 1 = 157. No test was skipped, retried or weakened.

## 8. Remaining limitations and follow-ups

- A published operation still blocks admission because the journal remains `Prepared` (M6.3 owns resolution, recovery and retry).
- No freshness/attestation, no cross-process nonce, no inode-reuse defence beyond observed device/inode (M6.3).
- No runtime probe, qualification matrix or allowlist process (M6.4); Windows/Linux unverified.
- Receipts are unkeyed; a malicious local writer is out of scope, as in M1–M5.
- Publication mode is normalized to `0644`; a vault with unusual umask expectations may want this configurable later.
- The staging root itself (`.nodus-copy-staging`) is left in place after successful publication; it is empty and harmless, and removing shared directories is left to a later cleanup decision.
- Operator guidance for publication evidence still needs a `docs/storage.md` section when publication becomes reachable (M6.4).
