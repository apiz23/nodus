# Plugin Workstream Legacy Documentation Remediation Plan

**Status:** Planning only; corrections below are proposals and have not been applied.
**Prepared:** 2026-11-06
**Scope:** Remediate the two High-severity findings in `docs/plugin-workstream-reconciliation.md`, with a narrow historical correction proposal for P0. No implementation or official roadmap changes are included.

## 1. Objective and guardrails

Make legacy plugin documents safe to read without erasing their useful design history. Distinguish historical proposals, current implemented behavior, approved design contracts, and deferred work.

All future wording must preserve these current decisions:

- **P1:** metadata-only manifest validation, package discovery/inventory/fingerprinting, dependency validation, diagnostics, and in-memory registry.
- **P2:** executable plugin support is deferred; no plugin runtime is approved.
- **P3:** public API and declarative contribution contract are design-only. Callbacks and command handlers are unsupported.
- **P4:** permission/consent taxonomy and semantics are design-only; there is no enforcement, consent UI, grant store, or revocation implementation.
- Fingerprints identify package content; they do not establish publisher identity, trust, or safety.
- Same-process API restrictions, workers, and ordinary child processes are not sandboxes. A separate process remains an evaluation option only.
- Official `docs/ROADMAP.md` is not to be changed. Its official Phase 30 remains Conflict Resolution.

## 2. Documents inspected

- [Reconciliation audit](plugin-workstream-reconciliation.md)
- [Plugin workstream roadmap](plugin-workstream-roadmap.md)
- [P0 architecture audit](phase30a-plugin-architecture-audit.md)
- [P1 manifest/registry specification](phase30b-plugin-manifest-registry.md)
- [P2 execution decision](plugin-workstream-p2-decision.md)
- [P3 API/contribution contract](plugin-workstream-p3-api-contract.md)
- [P4 permission/consent design](plugin-workstream-p4-permission-consent.md)
- [Legacy plugin architecture](plugin-architecture.md)
- [Legacy plugin API](plugin-api.md)
- [Legacy plugin security](plugin-security.md)
- [Legacy plugin development](plugin-development.md)
- Official roadmap context at `docs/ROADMAP.md`; it is excluded from remediation.

## 3. Proposed remediation by passage

### R1 — Architecture/runtime proposal presented as current

**Priority:** High. **Classification:** Historical proposal, not implemented or approved for execution.
**File:** `docs/plugin-architecture.md`.

| Passage | Current wording / issue | Proposed replacement wording |
|---|---|---|
| Title and status, lines 1–3 | “Phase 30 — Plugin Architecture”; “In progress.” This conflicts with the official Phase 30 title and the separate P0–P8 workstream. | `# Historical Plugin Architecture Proposal` followed by: “**Status:** Proposal only; not implemented. Plugin Architecture is an independent P0–P8 workstream. The official Phase 30 in `docs/ROADMAP.md` is Conflict Resolution. See `docs/plugin-workstream-roadmap.md` for current status.” |
| Goals/components, lines 7–18 | Describes lifecycle manager, runtime, permission manager, and persistence as architecture components without a status qualifier. | Prefix this section: “The following describes a historical target design, not current Nodus capabilities. P1 implements only metadata validation/discovery and an in-memory registry. Lifecycle, runtime, permissions, persistence, and UI are not implemented.” Keep the component list as historical context. |
| Initial execution model, lines 36–42 | Calls a same-process trusted-local module the initial execution model, while P2 defers executable plugins. | Replace the opening with: “P2 decision: executable plugins are deferred. Same-process API restrictions are not a security boundary and are not an approved execution model. A separate process with typed IPC is a future evaluation option only; an ordinary child process is not a sandbox.” Retain the remaining analysis only under a clearly marked “Historical proposal; not approved” subheading. |
| Lifecycle, lines 50–64 | Presents Installed/Enabled/Loading/Active states, startup reactivation, callbacks, and cleanup as a defined system. | Add: “No lifecycle manager or these states exist in the implementation. P1 registry statuses are only `discovered` and `invalid`. The diagram and behavior below are an unimplemented historical proposal; do not build against them.” Preserve the diagram below that notice. |
| Persistence/install and UI, lines 66–84 | Gives a plugin data directory, registry/grant/config persistence, install procedure, Settings UI, enable/disable, and runnable command behavior. | Add a notice before these sections: “No plugin installation, persistence, consent UI, enablement, activation, or uninstall flow exists. This storage layout and user journey are historical proposals only.” Change imperative wording such as “copy a package” to “The old proposal envisioned copying a package; this is not a supported Nodus workflow.” |
| Key decisions, lines 86–98 | States local trusted code is the first runtime and grants bind to fingerprints as settled decisions. | Label the table “Historical proposal decisions, superseded where they conflict with P2–P4.” Replace the trust row with: “Executable plugin trust model is undecided; P2 defers execution.” Replace the grant row with: “P4 proposes future grant binding; there is no grant implementation. Fingerprints do not establish trust.” |

The proposal’s useful design material should remain available, but all runtime, lifecycle, persistence, and UI claims need to be visually subordinate to the explicit current-status notice.

### R2 — API contract and examples imply unsupported fields and executable behavior

**Priority:** High. **Classification:** Historical API sketch; P3 is the current design-only contract.
**Files:** `docs/plugin-api.md`, `docs/plugin-development.md`.

#### `docs/plugin-api.md`

| Passage | Current wording / issue | Proposed replacement wording |
|---|---|---|
| Title/status, lines 1–3 | “Nodus Plugin API v1”; “Initial contract for Phase 30.” Suggests a shipped API and conflicts with P3’s design-only status and official roadmap numbering. | `# Historical Plugin API Proposal` and: “**Status:** Not implemented. The proposed API and examples below are not usable by plugins. The current design-only contract is `docs/plugin-workstream-p3-api-contract.md`; P2 defers executable plugins.” |
| Manifest JSON and field list, lines 15–45 | Includes `configSchema` and `uiContributions`, then says v1 accepts them. P1 rejects both as unknown fields; P3 explicitly does not extend the manifest. | Replace the manifest example with the exact P1 v1 example from `docs/phase30b-plugin-manifest-registry.md`, with no `configSchema` or `uiContributions`. Add: “`entryPoint` is validated and inventoried as package metadata only; it is never loaded. `commands.register` and `sidebar.register` are metadata declarations, not supported methods or grants.” Link to P1 for the authoritative field rules. |
| `configSchema` and `uiContributions`, lines 43–45 | Claims configuration and UI metadata are supported manifest fields. | Remove these as current-schema claims. If retained for history, move them under “Unimplemented historical extension proposal” and state that P1 v1 rejects them. Any future schema change requires a separate versioned-format proposal and migration decision. |
| Plugin module contract and TypeScript API, lines 47–84 | Defines `activate`, `run`, command/sidebar registration methods, cleanup handles, and exported stable source types that do not exist. | Replace the active section with a link and short summary of the inert `SidebarEntryV1` data contract in P3: “P3 defines illustrative data-only DTOs. No package ingestion path, source API module, callback, command handler, registration handle, or runtime exists.” If the old code is retained, label it “Historical, non-runnable example; not supported by Nodus” immediately before the code. |
| Lifecycle/error contract, lines 86–90 | Describes import, activation, permission checks, Active/Failed transitions, and disposal as host behavior. | Replace with: “No plugin activation, permission enforcement, lifecycle manager, or plugin-specific error boundary is implemented. P1 validation returns metadata and diagnostics only. P2 defers runtime pending a production host and approved security model.” Preserve generic security discussion only as a clearly labeled proposal. |

#### `docs/plugin-development.md`

| Passage | Current wording / issue | Proposed replacement wording |
|---|---|---|
| Opening and folder workflow, lines 1–15 | Presents trusted executable plugins, a per-user installation directory, and copying packages through Settings as supported. | Replace the opening with: “Nodus currently has no executable plugin development or installation workflow. P1 can inspect packages from an explicitly supplied root; discovery does not install or run them. See P1 and P2.” Mark the folder structure as a historical proposal, not a supported path. |
| Manifest example, lines 19–37 | Includes `uiContributions`, which P1 rejects. | Replace with the exact P1 manifest example and add a note that `entryPoint` is metadata only. Do not include P3 contribution DTOs as manifest fields. |
| `index.mjs` activation example and enablement instructions, lines 39–63 | Contains executable `activate()` and command `run()` callbacks, then instructs users to grant and enable the plugin in nonexistent Settings UI. | Remove from the active developer instructions. To retain history, place it in a visibly marked “Unimplemented historical runtime sketch—not executable in Nodus” section, or move it to an explicitly archived proposal after owner approval. Add: “P3’s sidebar DTO is inert design documentation; P2 does not approve command handlers.” |
| Compatibility/diagnostics, lines 65–78 | Gives actionable runtime instructions such as re-enable after fingerprint change and describes activation failure isolation. | Retain only P1-valid advice (stable ID, strict versions, supported capability strings, diagnostics) and label it package-metadata authoring guidance. Replace activation/consent/disposal statements with: “No activation or consent mechanism exists; fingerprints identify content and do not prove trust.” |

### R3 — Security proposal describes grants, installation, and enforcement as current

**Priority:** High. **Classification:** Historical security proposal; P4 is the current design-only permission source.
**File:** `docs/plugin-security.md`.

| Passage | Current wording / issue | Proposed replacement wording |
|---|---|---|
| Status, lines 1–3 | “Phase 30 model: trusted local plugins only.” Conflicts with official Phase 30 and P2’s defer-execution decision. | `# Historical Plugin Security Proposal` followed by: “**Status:** Not implemented. The P2 decision defers executable plugins. Official Phase 30 is Conflict Resolution. Current permission/consent design is in `docs/plugin-workstream-p4-permission-consent.md`.” |
| Trust boundary, lines 7–11 | Correctly explains same-process danger, but then describes consented install, reactivation, and a future process/sandbox as if parts of a current model. | Keep the accurate threat explanation. Add: “No plugin code is currently evaluated. P1 discovery is metadata-only. P2 approves no runtime; a child process is not a sandbox. Any OS-enforced sandbox claim requires a separately approved and tested platform policy.” Mark the rest as proposal-only. |
| Capability table and stored approvals, lines 15–29 | Says API v1 “supports” command/sidebar capabilities and requires grants; says permissions are stored and bound to fingerprints. | Change heading to “Historical capability proposal—not supported or granted by P1.” State: “P1 recognizes only `commands.register` and `sidebar.register` as manifest strings; both are metadata only. No grants, consent UI, or API enforcement exist. P4 proposes future semantics; it does not implement them.” Preserve the warning that API checks cannot restrict direct OS access. |
| Plugin root, uninstall, registry/config writes, lines 31–37 | Describes an existing app-data root, confirmed uninstall, quarantine, atomic grant/config writes, and host-mediated writes. | Replace the opening with: “No managed plugin root, installer, registry persistence, configuration store, grant store, or uninstall/quarantine flow is implemented. P1 accepts an explicit discovery root and does not mutate it.” Keep safe-handling recommendations only under a “Future design” label. |
| Threats/UI obligations, lines 39–46 | Describes activation failures, consent, and a future UI as current plugin behavior. | Mark these as future threat considerations. Replace “permissions/UI limitations must remain visible” with: “If execution is reconsidered, document the selected model before implementation; do not imply consent or API checks provide OS confinement.” |

## 4. Additional historical corrections

### R4 — P0’s official Phase 30 statement

**Priority:** Medium. **Classification:** Historical audit snapshot requiring an explicit erratum, not silent rewriting.
**File:** `docs/phase30a-plugin-architecture-audit.md`, “Current source-of-truth distinction,” line 46.

The sentence says the active roadmap lists Phase 30 Plugin Architecture and that Phase 30 Conflict Resolution is superseded. This reverses the current official roadmap.

**Proposed addendum wording:**

> **Historical roadmap correction (2026-11-06):** This audit’s statement that official Phase 30 was Plugin Architecture and that Conflict Resolution was superseded reflected an earlier local roadmap draft and is not authoritative. The current official `docs/ROADMAP.md` defines Phase 30 as Conflict Resolution. Plugin Architecture proceeds, if approved, only as the separate P0–P8 workstream.

Append the note rather than silently altering the original audit snapshot. The official roadmap remains untouched by this remediation.

### R5 — Crosswalk historical 30A–30G labels to current P0–P8

**Priority:** Medium. **Classification:** Historical cross-reference.
**File:** `docs/phase30a-plugin-architecture-audit.md`, “Implementation milestones,” lines 306–355; optionally a short note in P1’s header only if the owner wants the old title explicitly cross-referenced.

The old 30A–30G labels are called internal work packages but resemble official phase numbering. Proposed crosswalk to append as a clearly historical note:

| Historical proposal label | Current workstream mapping |
|---|---|
| 30A | P0 — architecture audit |
| 30B | P1 — metadata-only manifest and registry foundation |
| 30C | Split: P2 execution-model decision is approved; runtime/lifecycle portion maps to deferred P5 |
| 30D | P3 — public API and declarative contribution design; implementation is not approved |
| 30E | P4 — permission/consent design; enforcement is not implemented |
| 30F | Split: persistence/package operations map to deferred P6; management UI maps to deferred P7 |
| 30G | P8 — example and final verification, deferred until executable support is reconsidered |

Add: “These labels are historical proposal identifiers, not official Nodus phases. Current plugin work uses P0–P8 as neutral workstream IDs.” This is a cross-reference, not a renumbering or rewriting of completed decisions.

## 5. Exact future remediation file list

If the owner approves the full remediation plan, the proposed files to modify are:

1. `docs/plugin-architecture.md` — mark as historical proposal and align current-state/execution/lifecycle claims with P1/P2.
2. `docs/plugin-api.md` — mark as unimplemented historical API sketch, correct manifest example, and point to P3’s design-only contract.
3. `docs/plugin-security.md` — mark grants/install/runtime claims as proposals and distinguish P4 design from enforcement.
4. `docs/plugin-development.md` — remove or clearly archive runnable instructions and correct manifest example.
5. `docs/phase30a-plugin-architecture-audit.md` — append the R4 roadmap erratum and R5 historical-label crosswalk. This is a separate historical-document edit and should occur only with explicit owner approval.

No other file is needed for the corrections described here. In particular, do not modify `docs/ROADMAP.md`, the current P0–P4 decision documents, P1 source/tests, `docs/plugin-workstream-roadmap.md`, manifests, application code, or build configuration. The workstream roadmap already records the approved P0–P8 status and need not change for these corrections.

## 6. Explicit exclusions

- No corrections are applied by this plan.
- No changes to P1 manifest fields or capability allowlist.
- No plugin install, activation, runtime, lifecycle, grants, consent UI, persistence, or permission enforcement.
- No start of P5 or P6.
- No changes to the official roadmap, including its separate Phase 22 inconsistency.
- No changes to completed P0–P4 documents until the owner separately approves remediation; R4/R5 remain proposals.

## 7. Approval gate

This plan is ready for owner review only. Apply none of the proposed wording until the owner approves the target files and the preservation approach for the historical P0 audit. After approval, verify that all legacy documents clearly distinguish historical proposals from implemented behavior and that P1/P2/P3/P4 decisions remain unchanged.
