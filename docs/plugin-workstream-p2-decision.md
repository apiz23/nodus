# Plugin Workstream P2 — Execution Model and Host Boundary Decision

**Status:** Approved by the project owner on 2026-11-06.

**Workstream:** Independent Plugin Architecture workstream. This record does not change official roadmap numbering or the definition of official Phase 30 in `docs/ROADMAP.md`.

## Decision

Executable plugin support is deferred. The existing P1 manifest, discovery, inventory fingerprint, dependency validation, diagnostics, and in-memory registry remain metadata-only and non-executing. Nodus must not dynamically import, evaluate, load, launch, or execute plugin code under the current workstream decision.

All discovered packages are untrusted input. A package fingerprint identifies content; it does not establish trust, publisher identity, or safety. Same-process API restrictions, worker threads, and ordinary child processes are not security sandboxes.

A separate process with typed IPC remains a future evaluation option, not an approved implementation. Runtime work is deferred until Nodus has an explicitly defined production host, supported platforms, and an approved security model. Offline-first operation remains a requirement.

P3 may proceed as design-only work, prioritizing declarative contribution contracts. Executable callbacks and command handlers remain unsupported. P4 may define capability vocabulary and consent semantics at design level, but must not promise operating-system filesystem or network confinement without verified enforcement.

## Context and evidence

P0, the plugin architecture audit, found that Nodus currently uses a React UI and a Vite-hosted Node local API, without a dedicated desktop main process or established plugin IPC boundary. P1 added safe package metadata validation and an in-memory registry; it did not add installation, persistence, activation, consent, or runtime behavior. See [P0 audit](phase30a-plugin-architecture-audit.md) and [P1 specification](phase30b-plugin-manifest-registry.md).

The P0 proposal compared same-process execution, workers/VMs, a separate process, and an OS-enforced sandbox. The owner decision resolves the current boundary: do not execute plugins. A separate process is retained only as a future option because it does not, by itself, restrict OS access and the current application does not establish production process supervision.

## Security guarantees and non-guarantees

| Area | Current guarantee or decision |
|---|---|
| Package discovery | P1 validates untrusted metadata and package structure with path, symlink, inventory, and size checks. |
| Plugin execution | None is permitted. Discovery and validation must not execute package code. |
| Fingerprints | Detect package content identity/change for integrity workflows; they do not prove trust. |
| API capabilities | P1 capability declarations are metadata only. They grant no access. |
| Same-process restrictions | Not a sandbox; no executable plugin may rely on a facade as a security boundary. |
| Worker or ordinary child process | Not a sandbox without independently verified OS-enforced restrictions. |
| Filesystem/network confinement | No OS-level confinement guarantee is approved. P4 must not claim one. |
| Offline behavior | Plugin architecture must remain compatible with offline operation; no remote registry or service is required by this decision. |

If execution is proposed later, its threat model must separately address local files, environment variables and secrets, network access, subprocess creation, IPC validation, resource exhaustion, malicious packages, and dependency compromise. Any future design must distinguish API authorization from OS isolation and state clearly what the selected host can and cannot enforce.

## Consequences for later work

### P3 — Public API and declarative contribution design

P3 is limited to design artifacts and compatibility contracts. It may specify declarative contribution descriptors, stable identities, validation, and how the host could render them. It must not implement a loader, callback, command handler, event subscription, dynamic import, or activation path. A descriptor appearing in the registry is not an installed, enabled, consented, or active plugin.

### P4 — Capability and consent design

P4 may define capability names, user-facing explanations, consent semantics, revocation concepts, and the distinction between host API authorization and operating-system permissions. It must not represent consent as confinement. Implementation or UI that implies filesystem/network restrictions requires a separately approved and tested enforcement mechanism.

### Runtime and host boundary

Runtime implementation remains deferred. Reconsideration requires, at minimum:

- A production application host that owns startup, supervision, and orderly shutdown.
- Explicit supported-platform and packaging decisions.
- An owner-approved security model, including whether trusted local code is acceptable or OS-enforced isolation is required.
- A threat model and evidence for every claimed boundary.
- A versioned protocol design if a separate process is selected.

Until those prerequisites are approved, P1 remains the only implemented plugin capability and continues to be non-executing.

## Acceptance record

P2 is accepted as an architecture decision when this record is linked from the separate plugin workstream roadmap and the roadmap distinguishes design-only P3/P4 from deferred runtime work. This approval does not approve P3 implementation, plugin execution, or changes to the official roadmap.
