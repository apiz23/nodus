# Nodus Plugin Architecture Workstream Roadmap

**Status:** Independent workstream. This document does not alter or renumber the official roadmap. `docs/ROADMAP.md` remains authoritative, and its official Phase 30 is Conflict Resolution.

The labels P0–P8 below are internal plugin-workstream identifiers, not official Nodus phase numbers. Plugin packages remain untrusted metadata; the approved P2 decision defers executable support.

## Work packages

| ID | Work package | Status | Scope and boundary |
|---|---|---|---|
| P0 | Architecture audit and technical design | **Complete** | Repository audit and plugin architecture proposal in [P0 audit](phase30a-plugin-architecture-audit.md). Its runtime recommendations remain proposals except where explicitly resolved by P2. |
| P1 | Manifest, discovery, fingerprint, dependencies, and in-memory registry | **Complete** | Metadata-only implementation documented in [P1 specification](phase30b-plugin-manifest-registry.md). No installation, persistence, consent, activation, or code execution. |
| P2 | Execution model and host boundary decision | **Approved** | Owner decision recorded in [P2 decision record](plugin-workstream-p2-decision.md): executable plugins are deferred; a separate process with typed IPC is a future evaluation option only. |
| P3 | Public API and declarative contribution contracts | **Complete (design-only)** | Proposed API versioning and data-only sidebar contract are recorded in [P3 API contract](plugin-workstream-p3-api-contract.md). No implementation, callbacks, command handlers, loader, or execution. |
| P4 | Permission and consent design | **Complete (design-only)** | Deny-by-default taxonomy, grant identity, consent/revocation semantics, threat model, UX principles, and future tests are recorded in [P4 permission and consent design](plugin-workstream-p4-permission-consent.md). No enforcement, UI, grant storage, or OS confinement is implemented. |
| P5 | Runtime and lifecycle | **DEFERRED — NOT STARTED (NOT READY)** | P5 readiness recommends DEFER. No lifecycle execution, activation, dynamic loading, process launch, workers, or plugin code evaluation. Revisit only after a production host, supported platforms, and an approved security model exist. |
| P6 | Persistence and package operations | **DEFERRED — NOT STARTED** | Installation, upgrade, enablement, grants, configuration persistence, uninstall, and package retention depend on approved runtime and concurrency/security designs. P1 remains in-memory only. |
| P7 | Plugin management interface | **DEFERRED — NOT STARTED** | Settings UI for install, enablement, permissions, lifecycle, or uninstall is not authorized by P2 and depends on later approved contracts. |
| P8 | Example, developer workflow, and final verification | **DEFERRED — NOT STARTED** | An executable example and end-to-end activation verification require runtime approval. Existing design documentation is not an executable example or runtime verification. |

## Current implementation boundary

Only P1 is implemented in `src/plugins/` and covered by `test/plugins/`. The registry reports discovered or invalid package metadata and a dependency order; it does not record installed, enabled, granted, loading, or active states. Manifest capability names are declarations only. No plugin entrypoint is loaded or executed.

The P0/P1-era documents `docs/plugin-architecture.md`, `docs/plugin-api.md`, `docs/plugin-security.md`, and `docs/plugin-development.md` include proposals for runtime, permissions, installation, and UI. Those descriptions are not implementation guarantees. Keep them reconciled with this roadmap before using them as developer instructions; do not infer that their example activation workflow currently works.

## Progression and review gates

1. **P0–P4 design closure verified 2026-11-06.** P0 historical numbering/runtime language has a dated correction; the official Phase 22/30 interpretation and old-label crosswalk are recorded below. The closure report retains its initial findings as history and records the follow-up evidence.
2. P1 is implemented metadata-only; P2 is the approved non-execution decision.
3. P3 and P4 are design-only deliverables. They do not create an implemented runtime API, permission enforcement, consent UI, grants, or revocation system.
4. P5 readiness is **NOT READY — DEFER**. P5–P8 have not started. No runtime or management UI work should begin without new owner approval resolving host, platform, trust, and security prerequisites.
5. This workstream never changes `docs/ROADMAP.md` official phase names, numbering, or status.

## Historical 30A–30G labels (non-equivalent crosswalk)

P0 and P1 documents used “Phase 30A–30G” before the independent P0–P8 identifiers were established. These labels were internal work-package names, not official Nodus phases. The mapping below is thematic and records scope differences; it is not a one-to-one completion claim.

| Historical label and proposal | Current workstream relationship | Qualification / status |
|---|---|---|
| 30A — Architecture audit | P0 — Architecture audit and technical design | Closest correspondence. Historical proposal; corrected by the dated P0 note and this roadmap. |
| 30B — Manifest, registry, validation | P1 — Manifest, discovery, fingerprint, dependencies, in-memory registry | Closest correspondence, but P1 is strictly metadata-only and does not implement package installation or persistence. |
| 30C — Lifecycle manager and runtime boundary | P2 — Execution decision; P5 — Runtime and lifecycle | Split, not equivalent: P2 defers execution; P5 is deferred/not started. |
| 30D — Public extension API and contribution registry | P3 — Public API and declarative contribution design; later runtime work remains deferred | Design overlap only. No contribution registry, callback API, or executable command handler is implemented. |
| 30E — Permissions and security controls | P4 — Permission and consent design; future enforcement requires a new approved runtime/security milestone | Design overlap only. No permission enforcement or OS confinement is implemented. |
| 30F — Persistence and plugin management UI | P6 — Persistence/package operations; P7 — Management interface | Split into two deferred/not-started packages; neither is implemented. |
| 30G — Example, developer docs, and verification | P8 — Example, developer workflow, and final verification | Partial documentation overlap only. No supported executable example or runtime activation verification exists. |

The prior 30A–30G sequence therefore cannot be read as a renamed, completed P0–P8 sequence. P0–P4 are design/foundation outcomes as stated in the work-package table; P5–P8 remain deferred and not started.

## P0–P4 closure record

**Status:** DESIGN-COMPLETE through P4 as of 2026-11-06. This closes the architecture/design workstream through P4 only; it does not approve or implement executable plugins. P5 readiness remains DEFER, and P6–P8 remain NOT STARTED. See [the closure verification](plugin-workstream-p0-p4-closure-report.md) for the evidence matrix and limitations.
