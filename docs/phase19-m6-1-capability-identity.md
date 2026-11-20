# Phase 19 M6.1 — Capability & Identity Gate

**Status:** M6.1R and M6.1R2 review corrections applied on the same branch; M6.1R2 is pending targeted independent verification and owner acceptance. Not merged, not owner-accepted, and no M6.2 authorization is implied.

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

M6.1/M6.1R2 change no journal reader, writer, state-resolution, cancellation, recovery, or admission behavior. The only changes inside the accepted journal module are **purely additive** exports: `validateCopyJournalPreparedEvent` (§3.1), which re-uses the journal's existing canonicalization helpers so a later milestone binds to the same digest instead of duplicating it, and `isCopyJournalTimestamp` (§4.1), which exposes the journal's existing timestamp rule so the publication contract cannot drift to a narrower format. `git diff` for that file is additions only; no journal state, transition, serialization, resolution, recovery, or admission code changed, and every accepted M1–M5 journal test still passes unmodified.

## 3. Publication identity

`src/storage/copy-publication.ts` defines an immutable, separately validated identity with:

- `ownerJournalOperationId` and `preparedOperationId`, required to identify the same M1–M5 operation;
- `preparedEventSha256`, the journal's own canonical event digest — see §3.1;
- a separate `attemptId` for one future publication attempt;
- vault instance and lineage IDs;
- source note ID, validated vault-relative path, and raw-byte digest;
- destination note ID, validated path, canonical collision key, expected serialized-content digest, and byte length.

The parser requires exact object keys, UUID v4 identifiers, lowercase SHA-256 encodings, note-path validation, the existing case/NFC collision rule, distinct source/destination identities, and the existing 32 MiB serialized-copy bound. It does not treat an operation directory, event filename, or destination pathname as proof of identity. `matchesPreparedCopyIdentity` compares every publication identity field to a projection from an already validated prepared plan.

The filesystem object identity carried by future evidence is an opaque observed device/file identity. It is not predicted from a path and does not claim portability or immunity to filesystem identity reuse.

### 3.1 Authoritative digest domain (M6.1R / review M1)

One digest domain is defined, and it is the journal's, not a second invention:

- A v1 journal event's identity is the value stored in its own `sha256` field, which `copy-operation-journal.ts` computes as `sha256Hex(JSON.stringify(canonicalEventBody))` — fixed key order, canonical plan projection, canonical evidence projection.
- It is **not** a hash of the serialized file bytes. The file bytes additionally contain the trailing newline and the `sha256` field itself, so hashing them would create a second, incompatible identifier.
- `validateCopyJournalPreparedEvent` (new, purely additive export in `src/storage/fs/copy-operation-journal.ts`) re-verifies that canonical checksum and the immutable `Prepared` shape (sequence `0`, `state: 'Prepared'`, `previousSha256: null`, plan present, no evidence, canonical keys, matching identities) and returns the authoritative digest. It changes no journal serialization, state, resolution, recovery, or admission behavior.
- `createCopyPublicationIdentity({ preparedEvent, attemptId })` is the sanctioned construction path: every bound field is taken from the validated journal record, so a caller cannot hand-map a digest from the wrong domain. `deriveCopyPublicationPreparedEventDigest` exposes the digest alone.
- A digest recomputed over tampered event content mismatches, so identity construction fails closed. The contract test derives the digest from a real `journal.prepare()` record rather than a hand-written string.

### 3.2 Path authorization boundary (M6.1R / review M2)

**A syntactically valid note path is not an authorized publication target.** These are two separate security boundaries, and M6.1 implements only the first:

1. *Identity validation* (this slice) rejects, statically: structurally invalid note paths (per the accepted `validateNotePath` rules), any path with a hidden segment (which includes `.nodus-copy-journal/…`, `.nodus-tmp-*`, and the lock file namespace), the reserved `databases/` and `database-views/` namespaces via the accepted `isReservedNotePath`, and the managed `attachments/` namespace. It keeps the existing case/NFC fold rule and the requirement that `collisionKey` equals the NFC-folded destination path, and it still rejects identical source/destination identities. The policy reuses the accepted constants and predicates, so there is no second table of reserved names.

   Unicode normalization is deliberately **not** asserted as a canonical-form requirement here (M6.1R2 review F2): neither the accepted vault target rules nor the v1 journal require NFC form, so refusing NFD paths would reject legitimately prepared copies and would claim a guarantee the static layer cannot verify. Normalization parity is instead pinned in the fold domain — an NFC and an NFD spelling of the same visible path produce the same `collisionKey`, are rejected as a source/destination conflict, and a collision key that is not the NFC fold of its path is rejected. Mapping those spellings onto real directory entries is an explicit M6.2 live-inventory check.
2. *Filesystem authorization* (a later milestone, under the root lock) must still re-observe the live vault: destination existence, case and normalization collisions against the real inventory, symlink and inode checks, attachment-directory management state, and the no-replace publication primitive. M6.1 performs none of this because it contains no filesystem access at all.

Precise scope of the isolation guarantee (M6.1R2 review F3): the two contract modules
(`src/storage/copy-publication.ts`, `src/storage/fs/publication-capability.ts`) make no
filesystem call, import no `node:fs`, `atomic.js`, `vault.js`, or executor-lock module, and
reference no journal writer symbol. The journal module they import **for the canonical digest
and timestamp rules is itself filesystem-capable**, and this document does not claim otherwise:
the guarantee is that no write, staging, publication, or overwrite is *reachable from the
contract layer*, not that the whole dependency graph lacks filesystem capability. The contract
suite enforces this by inspecting each module's import specifiers, journal import names, and
mutation-call sites.

This split is deliberately stricter than the vault's write path in one respect: the vault consults the filesystem to decide whether `attachments/` is managed, while identity validation refuses the namespace outright. Publication targets should never live in a managed namespace, and refusing statically cannot weaken any accepted M1–M5 behavior.

## 4. Publication evidence

The evidence document binds the full publication identity, a prepared-event digest, an attempt state, source observation, destination observation, observer provenance, and an optional exclusive no-replace receipt. The parser rejects malformed fields, cross-operation evidence, source/destination mismatches, contradictory receipt/observation pairs, and receipt digests that do not match their canonical fields. Receipt digests are unkeyed corruption checks, not signatures or proof of authorship.

The result type names four outcomes, of which two are **future-only and unreachable in M6.1**: `definitely-not-published` and `definitely-published` are documented on the type as requiring a trusted verifier attestation on a qualified filesystem (M6.3). They are retained rather than removed so that M6.3 does not have to widen a published union type, and the ambiguity risk is closed by an enforced invariant instead:

- No `assessCopyPublicationEvidence` code path returns either definitive arm; a property test enumerates complete, missing, contradictory, internally consistent, capability-claiming, stale, and future-dated evidence and asserts the result is only ever `ambiguous` or `invalid`.
- missing, incomplete, stale, unqualified, or merely consistent observations remain ambiguous;
- a matching destination file without an operation-bound receipt is ambiguous;
- even internally consistent receipt-shaped input remains ambiguous, because serialized input cannot authenticate itself;
- malformed, mismatched, or contradictory evidence is invalid and must fail closed.

No journal statement alone establishes that a destination exists. A later implementation must re-observe destination identity through a qualified adapter; serialized claims and hashes alone cannot authorize recovery or success.

### 4.1 Temporal plausibility is not freshness attestation (M6.1R / review M4)

Four distinct notions are separated explicitly:

| Notion | M6.1 status |
| --- | --- |
| Timestamp **syntax** | validated against the journal timestamp domain via the additive `isCopyJournalTimestamp` export: accepted note timestamps (second precision) **and** full ISO-8601 millisecond instants, i.e. exactly the values the v1 journal writes into `recordedAt`, `confirmedAt` and evidence `observedAt`. Anything else — free text, offset forms, space separators, sub-millisecond precision, impossible dates — is `malformed`/`invalid` |
| Temporal **plausibility** | `assessCopyPublicationTemporalPlausibility` classifies mutually inconsistent times as `not-after-prepared`, `future-dated`, or `stale`, and consistent ones as `plausible-unverified`; default bounds are `PUBLICATION_MAX_CLOCK_SKEW_MS` (30 s) and `PUBLICATION_MAX_OBSERVATION_AGE_MS` (5 min, bounded to the accepted preview lifetime). Every result reports the bounds actually applied, so a rejected or out-of-range request never silently falls back to a default (M6.1R2 review F5) |
| Trusted **freshness** | not established. `referenceTime` is caller-supplied, so an observation cannot be proven recent |
| Verifier **attestation** | not implemented. Every assessment returns `attested: false`, and no temporal result changes an evidence classification |

Consequences that are deliberately left to a later milestone: an observation timestamp is not evidence that an observation happened; a receipt cannot authenticate its own `observedAt`; freshness must ultimately be anchored in a monotonic, publisher-issued per-attempt nonce held in durable journal state, compared by code that re-reads the filesystem under the root lock. M6.1 only requires that an `attemptId` be a UUID v4 distinct from the operation ID (replay of another attempt's evidence is rejected) and records the remaining guarantee as unimplemented rather than implying it.

## 5. Filesystem capability model

`src/storage/fs/publication-capability.ts` distinguishes `supported`, `unsupported`, `not-qualified`, `unavailable`, and `disabled` assessments. A positive indication that a runtime API exposes exclusive creation is insufficient for qualification. A supported result requires an exact platform/filesystem/operation entry in `FILESYSTEM_PUBLICATION_ALLOWLIST`.

The allowlist is frozen and **empty**. macOS/APFS, Linux filesystems, Windows filesystems, and all other targets are therefore not enabled. Missing or malformed observations fail as unavailable; unsupported primitives/platforms are unsupported; an explicit `requested: false` is disabled. `requireFilesystemPublicationCapability` throws `PUBLICATION_CAPABILITY_REFUSED` (HTTP status mapping 501, documented in [`storage.md`](storage.md#errors)) and has no overwrite or rename fallback.

M6.1R also removed one diagnostic asymmetry (review I1): an *uninspectable* primitive now reports `unavailable` **with** the established platform/filesystem/operation target attached, instead of discarding the target the caller had already proven. This is additive on the assessment union and changes no status, refusal, or default: a missing platform/filesystem still yields `unavailable` with no target, and no state other than an allowlisted `supported` can ever pass the gate.

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

Results below are recorded per corrective round. Serialized execution, local Vitest/Vite
binaries, no dependency install, in this worktree.

### 8.1 M6.1R round (historical record, superseded by §8.2 for current state)

| Command | Result |
| --- | --- |
| `vitest run test/storage-copy-publication-contract.test.ts test/storage-copy-operation-journal.test.ts test/storage-copy-preview.test.ts test/note-copy.test.ts test/resolver-stability.test.ts test/storage-scan-budget.test.ts test/storage-import-limits.test.ts --maxWorkers=1` | 7 files, **196/196 passed** |
| `vitest run test/storage-import-execution.test.ts test/storage-backup.test.ts test/storage-backup-order.test.ts test/storage-portable{,-freshness,-diagnostics,-manifest}.test.ts test/storage-root-lock.test.ts test/storage-root-lock-recovery.test.ts test/ui-api.test.ts test/ui-backup.test.ts test/ui-import-preview-api.test.ts --maxWorkers=1` | 12 files, **231/231 passed** |
| `pnpm test:executor-lock` (builds the native addon, then runs it serialized) | **32/32 passed** |
| `tsc --noEmit` | passed |
| `tsc -p tsconfig.ui.json --noEmit` | passed |
| `vite build --config ui/vite.config.ts --outDir /tmp/m61r-build` | passed (existing >500 kB chunk advisories only); output written outside the repository |
| `vitest run --maxWorkers=1` (**full suite**) | **156 files, 1,745/1,745 passed**, exit 0 |

Test-count arithmetic, as a no-silent-loss check: the accepted baseline serialized full run was 1,693 tests; the original M6.1 slice added 15 (14 contract + 1 status mapping) → 1,708; M6.1R added 37 contract tests → **1,745**. Nothing was removed, skipped, retried, or softened.

Two earlier results are corrected by this run rather than repeated: the independent review's serialized full run showed 1,690 passed / 18 failed, all 18 in `test/storage-executor-lock.test.ts` with `classification: 'uncertain'` because the native addon had not been built in that fresh worktree. Building it here (the repository's own `pnpm test:executor-lock` command) turns the entire suite green, confirming that the 18 failures were environmental and not caused by M6.1. The M6.1 contract suite grew from 14 to 51 tests.

An additional independent adversarial probe (31 assertions, run outside the repository against these modules) confirmed: every rejected path namespace is refused while ordinary nested destinations still validate; the derived digest equals the journal's `event.sha256` and differs from the serialized-file-bytes digest; tampered, state-substituted, unknown-field, prototype-inherited, `__proto__`, circular, and scalar inputs all fail closed; perfectly self-consistent real-digest evidence with a claimed `supported` capability remains `ambiguous`; the allowlist stays empty and frozen and no caller-supplied shape reaches `supported`; and neither M6.1 module imports or calls any filesystem API.

### 8.2 M6.1R2 round (current state, 2026-11-20)

| Command | Result |
| --- | --- |
| `vitest run --maxWorkers=1 <contract, journal, copy-preview, note-copy, resolver-stability, scan-budget, import-limits>` | 7 files, **211/211 passed** (contract suite now 66 tests) |
| `vitest run --maxWorkers=1 <import-execution, backup, backup-order, portable x4, root-lock, root-lock-recovery, note-snapshot, ui-api, ui-backup, ui-import-preview-api, ui-relations>` | 14 files, **239/239 passed** |
| `pnpm test:executor-lock` (native addon rebuilt, then serialized) | **32/32 passed** |
| `tsc --noEmit` | passed, exit 0 |
| `tsc -p tsconfig.ui.json --noEmit` | passed, exit 0 |
| `vite build --config ui/vite.config.ts --outDir /tmp/m61r2-build` | passed in 974 ms (pre-existing >500 kB chunk advisories); output outside the repository |
| `vitest run --maxWorkers=1` (**full suite**) | **156 files, 1,760/1,760 passed**, exit 0, 294 s |

M6.1R2 arithmetic: the previous round's full-suite total was 1,745 across 156 files; M6.1R2
added **15** tests (14 real-journal timestamp/normalization/import-isolation cases plus the
bounds-reporting case) to 1,760. The file count is unchanged, and no existing test was removed,
skipped, retried, or softened; the only edits to earlier M6.1R tests were the two reviewer-
mandated title corrections and the strengthened import-isolation assertions.

Reviewer-claimed defects closed and re-verified by these runs: real journal `recordedAt`
values (millisecond precision) now parse in both the temporal API and evidence provenance;
malformed, offset-form, space-separated, sub-millisecond and impossible timestamps still fail
closed; temporal results report the bounds actually applied; the path policy no longer claims
NFC canonicalization, and NFC/NFD parity is pinned by fold-domain tests; and the contract
modules' import surface is asserted to exclude filesystem, atomic, vault, and executor modules
as well as journal writer symbols.

## 9. Known limitations

- Identity parsing versus issuance (M6.1R2 review F6): `validateCopyPublicationIdentity` is a
  *parser*. It accepts any syntactically well-formed identity, including a `preparedEventSha256`
  from the wrong digest domain, so it can never be trusted as an issuance path. The only
  sanctioned construction route is `createCopyPublicationIdentity`, which re-verifies the journal
  record's canonical checksum first. A M6.2 consumer that accepts a parsed identity without
  re-deriving it from durable journal storage reopens exactly the ambiguity M1 closed; downstream
  `matchesPreparedCopyIdentity` comparison is a check, not a substitute.
- Field-domain mismatches to reconcile before M6.2 (review F7): object identity strings in the
  publication contract allow up to 256 characters, while the accepted v1 `Published` receipt
  validator caps them at 64, so a receipt producer must pick the stricter domain deliberately;
  `deriveCopyPublicationPreparedEventDigest` also returns `recordedAt`, which currently has no
  consumer until the temporal/attestation path is implemented.

- M6.1 has no filesystem observation producer or trusted evidence verifier, so no evidence can currently resolve to “definitely published” or “definitely not published.”
- Temporal assessment is arithmetic over caller-supplied strings. Only syntax and plausibility are decided; freshness and attestation are not (§4.1), and no monotonic per-attempt nonce exists yet.
- Identity path validation is a static pre-filter, not filesystem authorization (§3.2). A later milestone must re-check the live vault under the root lock.
- The capability probe describes runtime information; it does not qualify or enable a target.
- Receipt SHA-256 is unkeyed and does not authenticate against a malicious local actor.
- Filesystem identifiers and observations may be stale or reused. External writers can race Nodus, as already documented for M1–M5.
- No new journal retention, power-loss, network-filesystem, cross-platform, or malicious-local guarantee is made.

## 10. Deferred M6.2–M6.4 decisions

The accepted M1–M5 documentation does not define the exact M6.2/M6.3/M6.4 allocation or acceptance gates. These remain separate owner-reviewed milestones. Before any later implementation, decide and verify:

- whether and how staging is introduced, and where staged bytes live relative to the operation directory (which must stay compatible with the accepted temporary-artifact contract);
- the no-replace publication protocol and its exact crash points;
- trusted provenance, monotonic per-attempt nonces, and fresh re-observation rules for recovery,
  including how an attested observation time is anchored (the timestamp *domain* is now unified
  with the journal in M6.1R2; attestation itself remains unimplemented);
- live-inventory Unicode normalization and case-fold verification for destination selection,
  which the static path policy deliberately does not attempt (M6.1R2 review F2);
- journal evidence location, state transitions, retry, rollback, and manual-review behavior;
- native qualification test matrix and the explicit filesystem allowlist update process;
- supported operating systems/filesystems and durability boundaries;
- UI/API exposure and user recovery guidance, if needed.

Now settled by M6.1R and therefore **not** open questions: the authoritative `preparedEventSha256` digest domain (§3.1), and the static publication path policy boundary (§3.2).

M6.2 has since been implemented (owner-authorized after M6.1R2 acceptance); its §10 decisions — staging location, the no-replace protocol and crash points, live-inventory normalization/case checks, and evidence locations — are recorded in [phase19-m6-2-publication-execution.md](phase19-m6-2-publication-execution.md). Publication remains disabled in production and journal resolution/recovery remains M6.3.

## 11. Explicit non-implementation statement

**Publication is not implemented or enabled.** No destination file is created, replaced, staged, retried, rolled back, or recovered by M6.1. The filesystem capability allowlist remains empty. M6.2, M6.3, M6.4, native qualification, and all later publication work require separate authorization.

## 12. Public API boundary (M6.1R / review I3)

Two export layers, deliberately unequal in size:

- **Package root (`src/index.ts`)** — the operational core only: `FILESYSTEM_PUBLICATION_ALLOWLIST`, `assessFilesystemPublicationCapability`, `requireFilesystemPublicationCapability`, `validateCopyPublicationIdentity`, `createCopyPublicationIdentity`, `deriveCopyPublicationPreparedEventDigest`, `matchesPreparedCopyIdentity`, `assessCopyPublicationEvidence`, `assessCopyPublicationTemporalPlausibility`, `copyPublicationReceiptDigest`, plus the ten types a caller needs to consume them (`CopyPublicationIdentity`, `CopyPublicationEvidenceDocument`, `PublicationCapabilityAssessment`, `PublicationEvidenceClassification`, `PublicationTemporalAssessment`, `PublicationTemporalStatus`, `IdentityValidation`, `PreparedCopyIdentityBinding`, `FilesystemPublicationCapabilityProbe`, `FilesystemPublicationCapabilityTarget`). Measured against the source: the package root gains **20** names relative to the accepted baseline — 10 values/functions and 10 types. That is **14 fewer** than the original M6.1 proposal (branded identifier aliases and internal observation unions that no consumer needs by name). No pre-existing root export was removed or altered.
- **Storage barrel (`src/storage/index.ts`)** — the complete contract, including branded identifier aliases, observation unions, receipt digest input, and the two temporal bound constants, for storage-internal and diagnostic consumers.
- **Deep module paths** — `validateCopyJournalPreparedEvent` is reachable from `src/storage/fs/copy-operation-journal.js` only, matching existing practice where journal internals are consumed by path rather than re-exported, and `createCopyPublicationIdentity` means callers never need it.

No filesystem handle, path argument, or mutation function is exported by any of these layers.
