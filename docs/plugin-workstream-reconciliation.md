# Plugin Workstream P0–P4 Documentation Reconciliation Audit

**Audit date:** 2026-11-06

**Audit type:** Documentation and architecture reconciliation; no implementation changes.

## 1. Audit scope

This audit compares the completed plugin workstream design record and P1 metadata-only foundation with the P0/P1 historical documents, P2 execution decision, P3 API contract, P4 permission design, and older plugin proposals. It also checks the relevant official roadmap sections for numbering and workstream separation.

The repository was inspected at `/Users/ocgt/Desktop/nodus`, branch `main`, HEAD `090e367fe0a460b33c10165833b123465a590e3c`, upstream `origin/main` at 1 commit ahead / 0 behind. The working tree had 27 staged paths, 5 unstaged paths, and 131 untracked entries before the audit. These changes were preserved.

## 2. Documents and implementation reviewed

- [P0 architecture audit](phase30a-plugin-architecture-audit.md)
- [P1 manifest, registry, and validation specification](phase30b-plugin-manifest-registry.md)
- [P2 execution model decision](plugin-workstream-p2-decision.md)
- [P3 public API and declarative contribution contract](plugin-workstream-p3-api-contract.md)
- [P4 permission and consent design](plugin-workstream-p4-permission-consent.md)
- [Plugin workstream roadmap](plugin-workstream-roadmap.md)
- [Legacy plugin architecture proposal](plugin-architecture.md)
- [Legacy plugin API proposal](plugin-api.md)
- [Legacy plugin security proposal](plugin-security.md)
- [Legacy plugin development proposal](plugin-development.md)
- P1 implementation in `src/plugins/` and its tests in `test/plugins/`.
- Official [roadmap](ROADMAP.md), specifically its current phase table, phase index, Phase 22 references, and Phase 30 definition. The official roadmap was read for context only and was not modified.
- Host evidence: `package.json`, `ui/vite.config.ts`, `src/ui-server/api.ts`, and plugin source/tests.

## 3. Executive summary

**Audit result: PASS WITH FINDINGS.** The current workstream roadmap and P2–P4 records are consistent with the approved security boundary: P1 remains metadata-only; P2 defers executable plugins; P3 is design-only with data-only contributions; P4 defines permission and consent semantics without implementing enforcement. The current P1 registry and tests support those boundaries. The official Phase 30 remains Conflict Resolution and is not replaced by the plugin workstream.

There are material contradictions in the older, unclassified plugin proposals. They describe same-process execution, activation callbacks, grants, install folders, Settings UI, and developer workflows as if they were current behavior. Those claims conflict with P2 and P1. P0 also contains a now-false statement that the active official roadmap makes Phase 30 Plugin Architecture. The canonical roadmap itself retains older Phase 22 plugin references despite its current phase table assigning Phase 22 to Portable Graph Views.

These findings warrant documentation cleanup before the older proposals are used as developer instructions. This audit does not change them; the P0–P4 decision documents remain intact pending owner review.

## 4. Cross-document consistency matrix

| Area | Finding | Evidence and assessment |
|---|---|---|
| Workstream identity | **Consistent in current workstream documents.** | The separate roadmap defines P0–P8 as internal workstream IDs and says it does not change official numbering. P2 and P3 also distinguish the workstream from official Phase 30. |
| Official Phase 30 | **Consistent in current decision documents; stale claims elsewhere.** | `docs/ROADMAP.md` current phase table and detailed section define Phase 30 as Conflict Resolution. P0 line 46 says the active roadmap lists Plugin Architecture and that Conflict Resolution is superseded; this is false for the current official roadmap. |
| P0 status | **Correct as a historical audit/proposal, with one stale roadmap assertion.** | P0 labels itself a proposal for owner review and does not claim runtime implementation. Its repository/roadmap snapshot statements predate P1 and current roadmap reconciliation and should not be treated as current-state inventory. |
| P1 implementation | **Consistent.** | P1 validates manifests/package inventory, compatibility, dependencies and fingerprints, and constructs an in-memory registry. Source and tests show metadata-only discovery; no install, persisted grants, activation, or execution methods exist. |
| P1 trust boundary | **Consistent.** | P1 and P4 both state fingerprints identify bytes, not publisher identity, trust, or safety. |
| P2 execution decision | **Consistent in P2–P4 and workstream roadmap.** | Executable plugins are deferred. Ordinary child processes, workers, and IPC are not called sandboxes. A process boundary remains a future option pending host/platform/security decisions. |
| P3 public API | **Consistent in the P3 contract; contradicted by legacy API/development proposals.** | P3 labels API v1 proposed and unimplemented, limits contributions to inert data, and excludes callbacks/handlers/loading. Legacy docs show `activate()` and `run()` implementations and describe a stable exported API as existing. |
| P1 manifest compatibility | **Consistent in P1/P3/P4; contradicted by legacy API examples.** | P1 rejects unknown fields including `configSchema`; P3 explicitly adds no `uiContributions` or contribution fields. Legacy API/development examples include both. |
| P4 permissions and consent | **Consistent in P4; contradicted by legacy security proposal when read as current behavior.** | P4 makes declaration distinct from grant, defaults to no grant, binds future decisions to identity/content/API/policy, and disclaims OS confinement. Legacy security text describes explicit grants, stored approvals, enabled state, and activation as an existing model. |
| P5/P6 boundaries | **Consistent in the current workstream roadmap.** | Runtime/lifecycle (P5) and persistence/package operations (P6) are deferred. Their prerequisites include production host, supported platforms, and approved security/concurrency models. Older proposals imply these facilities already exist. |

## 5. Security-boundary verification

The current P2 decision and P4 design correctly distinguish host API authorization from process isolation. P3 exposes no privileged API and only describes a host-rendered, allowlisted built-in navigation destination. P1 capability strings `commands.register` and `sidebar.register` are manifest metadata only; they are not operational methods or grants. P1 rejects other capability values under its current validator.

The P1 implementation is limited to validation, discovery, inventory/fingerprinting, dependency resolution, and registry construction. The inspected plugin source contains no entrypoint loader, dynamic import, evaluator, process launcher, permission store, or lifecycle state manager. Its tests explicitly assert discovery does not evaluate an entrypoint and that registry entries do not imply activation.

The current app uses Vite dev/preview servers with the local API middleware (`package.json`, `ui/vite.config.ts`, `src/ui-server/api.ts`). The inspected configuration has no production plugin host/supervisor or plugin IPC. The P2 conclusion that there is no approved plugin process boundary is consistent with this evidence.

The older security proposal correctly warns that same-process restrictions and ordinary processes are not sandboxes, but its surrounding statements about grants, installation, enablement, and activation can still mislead readers into thinking the lifecycle exists. Consent also cannot prove publisher identity or undo side effects, as P4 correctly states.

## 6. Official roadmap separation verification

The current official Phase 30 table row and detailed section identify **Conflict Resolution** (`docs/ROADMAP.md` lines 193 and 1958 onward). The separate `docs/plugin-workstream-roadmap.md` does not replace it, change its status, or use official phase numbering. P0–P8 are explicitly neutral workstream identifiers.

One separate canonical-roadmap inconsistency remains: the roadmap table of contents and an older detailed section label Phase 22 as Plugin and Extension Architecture, while the current phase table identifies Phase 22 as Portable Graph Views (`docs/ROADMAP.md` lines 85, 185, 1497, and 1696). This audit does not resolve that official-document issue. It does not change the current Phase 30 definition.

## 7. Findings

### F1 — High: Legacy architecture proposal contradicts the approved P2 execution decision

- **Documents/sections:** `docs/plugin-architecture.md`, “Status,” “Initial execution model,” “Lifecycle,” “Persistence and local installation,” and “UI integration and discoverability” (notably lines 3, 36–42, 50–64, 66–83).
- **Issue:** It calls official Phase 30 “Plugin Architecture” and describes a trusted-local, same-process module runtime, activation/deactivation, installed/enabled state, persisted grants, a plugin directory, Settings UI, and runnable command/sidebar contributions. P2 defers execution and the workstream roadmap says these facilities are not implemented.
- **Why it matters:** It can lead contributors to implement against an unapproved and unsafe execution model or mistake proposed UI/persistence behavior for existing product capability.
- **Recommended correction:** After owner review, add a prominent superseded/proposal warning and align its execution, lifecycle, persistence, and numbering sections with P2 and the P0–P8 roadmap. Do not treat the current text as implementation guidance.

### F2 — High: Legacy API and development documents claim unsupported executable behavior and incompatible manifest fields

- **Documents/sections:** `docs/plugin-api.md`, “Manifest,” “Plugin module contract,” and “Lifecycle and error contract” (lines 20–45, 49–90); `docs/plugin-development.md`, “Minimal example” and workflow (lines 20–60).
- **Issue:** These documents present an `activate(api)` module, `run()` callbacks, exported API types, registration handles, permission-gated methods, and a working Settings installation/enablement flow. Their manifest examples include `configSchema` and `uiContributions`, which P1 explicitly rejects as unknown. P3 says the API is not implemented, P1 fields must not change, and executable callbacks are unsupported.
- **Why it matters:** These examples are directly actionable and may cause invalid v1 packages to be created or encourage implementation of code execution before the P2 gate is resolved.
- **Recommended correction:** Mark the docs as historical proposals not supported by the application, or later revise them to link to P3’s inert DTO contract and the current P1 manifest. Remove runnable code examples until execution is explicitly reconsidered. Do not add those fields to P1 v1.

### F3 — High: Legacy security document describes grants and activation as current policy

- **Document/sections:** `docs/plugin-security.md`, title/status, “Trust boundary,” “Capabilities,” and “Filesystem and package handling” (lines 3–35).
- **Issue:** It says plugins are enabled and consented, grants are stored by fingerprint, changed code invalidates enabled state, and uninstall moves packages to quarantine. None of those systems exists; P1 is in-memory and P2 defers execution, consent, and persistence. Its warning that same-process permissions cannot constrain OS access is correct, but the rest is not clearly labeled proposal-only.
- **Why it matters:** Security statements about nonexistent grants or lifecycle can create false assurance that consent enforcement exists.
- **Recommended correction:** Add a clear non-implementation warning and align current-state statements with P1/P2/P4. Keep the valid non-sandbox warnings, but label grant and lifecycle rules as future design.

### F4 — Medium: P0 contains an outdated assertion about the official roadmap

- **Document/section:** `docs/phase30a-plugin-architecture-audit.md`, “Current source-of-truth distinction,” line 46; also P0 title and proposed internal 30A–30G milestones at lines 1 and 306–355.
- **Issue:** It says the active roadmap lists Phase 30 Plugin Architecture and that Phase 30 Conflict Resolution is superseded. The current official roadmap says the reverse. The old 30A–30G labels can also be confused with official phases despite the P0 text describing them as internal work packages.
- **Why it matters:** This is a direct numbering/status conflict and could cause work to be scoped against the wrong official milestone.
- **Recommended correction:** Preserve P0 as historical material, but add a separately reviewed reconciliation note or explicit crosswalk identifying the old 30A–30G labels as superseded internal labels and pointing to P0–P8. Correct the roadmap assertion only through an owner-approved historical-document correction.

### F5 — Informational: Official roadmap retains Phase 22 plugin references

- **Document/sections:** `docs/ROADMAP.md` table of contents, current phase table, secondary phase index, and detailed Phase 22 section (lines 85, 185, 1497, and 1696–1705).
- **Issue:** The table of contents and detailed section describe Phase 22 as Plugin and Extension Architecture, while current phase summaries identify Phase 22 as Portable Graph Views. This is a canonical roadmap inconsistency; the current Phase 30 Conflict Resolution entry itself is clear.
- **Why it matters:** Readers may incorrectly associate the plugin workstream with official Phase 22 or infer a second official plugin milestone.
- **Recommended correction:** Have the roadmap owner resolve the historical Phase 22 entry and its table-of-contents link in a separate roadmap task. No roadmap edit is made here.

## 8. Recommended corrections and preservation guidance

No corrections were made to completed P0–P4 documents. Recommended follow-up is:

1. Treat `docs/plugin-workstream-roadmap.md`, P2, P3, and P4 as the current workstream status and decision sources.
2. Add proposal/superseded notices to the older plugin architecture/API/security/development documents, then reconcile their runnable examples and claims only with owner review.
3. Record a non-destructive historical crosswalk for P0/P1's old “30A/30B” labels to current P0/P1 workstream identifiers; do not rewrite their history silently.
4. Handle the official Phase 22 inconsistency separately with the roadmap owner. Keep official Phase 30 as Conflict Resolution.

### Already consistent and not recommended for change

- P1's metadata-only validation, fingerprint, dependency, and in-memory registry boundary.
- P2's deferral of executable plugins and distinction between API restrictions and OS isolation.
- P3's design-only, data-only contribution contract and explicit exclusion of callbacks/handlers.
- P4's deny-by-default semantics, grant invalidation model, revocation limitations, and refusal to promise OS confinement.
- The separate workstream roadmap's P0–P8 numbering and deferred P5/P6 status.
- The official Phase 30 Conflict Resolution definition.

## 9. Final recommendation

Do not start P5 or runtime work. First obtain owner review of F1–F4 and reconcile or clearly mark the legacy proposal documents. Resolve F5 only through the official roadmap owner. After documentation cleanup and a fresh owner decision, P5 may be reconsidered only when a production host, supported platforms, and the approved security model meet P2 prerequisites.

## 10. Audit limitations

This was a documentation/source inspection only. No runtime, permission system, grant store, or plugin UI was exercised because none is implemented. No tests or builds were run. This audit does not certify the security of hypothetical executable plugins.
