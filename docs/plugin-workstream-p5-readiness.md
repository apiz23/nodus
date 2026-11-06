# Plugin Architecture Workstream P5 Readiness Assessment

**Assessment date:** 2026-11-06
**Status:** Assessment only; P5 remains deferred and not started.
**Recommendation:** **DEFER** runtime implementation.

## 1. Scope and current status

This assessment determines whether the existing P5 work package can safely proceed. It does not approve or implement plugin execution, installation, activation, persistence, permissions, or UI. The P2 prohibition on loading or executing plugin code remains binding. Formal P0–P4 design closure is still pending the roadmap and historical-document findings in the [P0–P4 closure report](plugin-workstream-p0-p4-closure-report.md).

The [plugin workstream roadmap](plugin-workstream-roadmap.md) names P5 **Runtime and lifecycle**. It says P5 is deferred and may be revisited only after a production host, supported platforms, and approved security model exist. That gives P5 a broad intended subject, but not an implementation-ready scope: there is no approved runtime model, product trust/distribution policy, host owner, detailed lifecycle contract, or P5 acceptance suite. P2 explicitly defers executable support. Therefore P5’s current status is a gate, not authorization to implement the named runtime.

## 2. Existing architecture evidence

### Host and deployment

- `package.json` exposes `dev`, `build`, and `preview` scripts. It has no production application `start` script, plugin supervisor, Electron/Tauri host, or plugin-specific process entry point. Its package description identifies the local React UI and experimental, unwired relay.
- `ui/vite.config.ts` creates `createLocalApiMiddleware` while loading the Vite configuration. A Vite plugin mounts that middleware in both `configureServer` and `configurePreviewServer`, and calls its `dispose()` method when the respective HTTP server closes.
- The same config binds dev and preview to loopback (`127.0.0.1`); preview is the repository’s production-style local preview. `build.outDir` is the static `dist` directory. The build does not produce a standalone supervised Node application host.
- `src/ui-server/api.ts` defines the local API middleware. Its `dispose()` method is idempotent, waits for startup/vault initialization, disposes owned vaults, and clears in-memory indexes. `src/storage/fs/vault.ts` disposes derived snapshot state; `src/storage/fs/snapshot-reconciler.ts` closes watchers and clears timers. These are useful host-resource cleanup patterns, not plugin lifecycle or process supervision.
- `src/relay/server.ts` is an existing server implementation, but `README.md` says relay/sync is experimental and not wired into the UI or npm scripts. It is not evidence of a production plugin host or supervisor.
- `src/plugins/` implements P1 validation, discovery, inventory/fingerprinting, dependency resolution, and an in-memory registry. `createPluginRegistry` returns metadata and dependency order; it has no activation lifecycle. P1’s `.mjs` entrypoint is inventoried, never loaded.

**Finding:** Nodus currently has a local Node process boundary around Vite and its local API, but no production process supervisor or dedicated host boundary designed to own third-party plugin startup, isolation, shutdown, or restart.

### Declarative contribution feasibility

P3 defines a JSON-compatible, data-only sidebar descriptor, but explicitly says it is not consumed by Nodus and has no package-ingestion mechanism. P1 manifest v1 rejects unknown fields, including `uiContributions`; its only accepted capability strings are metadata and do not register UI. Therefore a contribution cannot currently be discovered and rendered merely because it appears in a package.

Host-side consumption without executing plugin code is technically plausible, but it requires an owner-approved source/transport (for example, a separately versioned data resource or a later manifest version), runtime schema validation, host-owned icon/view allowlists, deterministic duplicate handling, and UI integration. It must not silently extend P1 v1 or make its entrypoint executable. This would be a distinct, restricted scope decision; it is not currently included as an approved P5 implementation.

### Runtime feasibility

A future executable design could use a separately supervised process and typed IPC, but the current Vite configuration does not establish a packaged process supervisor, executable distribution policy, or platform-specific isolation. A child process alone runs with the user’s OS permissions. Typed IPC can limit host API calls, not direct filesystem/network access. Workers share the application process and are not an OS boundary.

Any selected IPC protocol would need bounded, versioned schemas validated on every message in both directions; peer/session identity; unknown-method rejection; request correlation; quotas, deadlines, and replay/error handling. This would still not confine direct OS access without independently verified OS enforcement.

## 3. P5 scope interpretation and relationship to P1–P4

- **P1:** Implemented metadata-only foundation. Package contents are untrusted. Fingerprints identify content and detect changes; they do not prove publisher identity or trust.
- **P2:** Owner-approved decision defers executable plugins. No execution model is approved. A separate process with typed IPC is a future evaluation option only. Reconsideration requires a production host, supported platforms, and approved security model.
- **P3:** Design-only public API and declarative contribution DTO. No package ingestion path, public runtime module, callback, command handler, or active contribution registry exists. P3 explicitly leaves the contribution source/versioning choice open.
- **P4:** Design-only deny-by-default capability and consent model. Declarations are not grants; there is no consent UI, grant store, revocation, or enforcement. API checks cannot prevent direct OS access.
- **P5 roadmap entry:** “Runtime and lifecycle,” presently deferred. The entry does not specify whether P5 is intended to be research/design or runtime implementation, nor define deliverables/acceptance. Under P2, executable implementation cannot proceed without a new explicit owner decision that satisfies its prerequisites.

## 4. Options A–D

| Option | Security | Architecture fit and complexity | Offline, maintenance, UX, extensibility | Assessment |
|---|---|---|---|---|
| **A — Continue metadata-only** | Lowest execution risk; packages remain inert and are validated as untrusted input. | Fits P1 directly; limited work, but does not deliver the roadmap label “Runtime and lifecycle.” | Fully offline and easy to maintain. No plugin-facing UX beyond metadata inspection. Extensibility remains preparatory. | Safe baseline. Appropriate maintenance only; it does not resolve P5 scope. |
| **B — Declarative contribution consumption** | No plugin code execution if the source is strictly data-only and validated. Malformed data still needs robust bounds and rejection. | UI can render host-owned descriptors, but P1 v1 rejects contribution fields and P3 has no ingestion path. Requires a separate source/versioning decision and schema/UI integration. | Offline-compatible. Could provide simple navigation customization, but without callbacks/actions it has limited behavior. Extensible through versioned DTOs if kept narrow. | Feasible as a separately approved declarative-only project; not ready to implement under current P5 scope. Do not silently extend P1. |
| **C — Runtime infrastructure research** | Can analyze threats without executing code. Research does not itself deliver an enforceable boundary. | Builds on P0/P2 evidence, but risks repeating the existing audit unless narrowed to concrete production-host alternatives and platform evidence. | Offline-compatible; no user-visible plugin workflow. Useful to long-term extensibility only if owner confirms executable plugins are a product requirement. | Could be authorized as a design-only follow-up, but it would not be P5 runtime implementation and must not reverse P2. |
| **D — Defer P5** | Preserves P2’s non-execution rule and avoids unsupported security claims. | No architecture changes; waits for host, platform, trust, and product decisions. | Core app remains fully offline and unaffected. No immediate plugin UX; long-term path remains open. | **Recommended.** It matches the current roadmap status and available evidence. |

## 5. Security and operational assessment

Any future executable plugin is untrusted code unless the owner adopts and documents a different distribution/trust policy. Risks include:

- **Filesystem and vault:** a same-user process can read or write any accessible path unless an OS policy prevents it. A narrow Nodus API does not stop direct Node/native filesystem calls.
- **Network:** brokered API checks cannot stop direct sockets/fetch in unsandboxed code. Any claim of network restriction needs enforced, platform-tested policy.
- **Environment and credentials:** inherited environment variables may expose tokens or paths. A future launcher would need an explicit environment allowlist, and OS process/user isolation where required.
- **Subprocesses and host interference:** unsandboxed child code may launch subprocesses, signal/terminate processes where permitted, or alter other user-accessible data. Process separation is not itself confinement.
- **Resource exhaustion:** CPU, memory, file descriptors, process count, message size, event rate, and shutdown deadlines need measured, enforceable limits. IPC rate limits alone cannot contain CPU/memory use.
- **Dependencies and identity:** local dependency validation and a package fingerprint do not prove the package or its dependencies benign or identify their publishers. Any update changes content identity and must trigger new review under a future consent policy.
- **Permissions:** P4’s deny-by-default vocabulary is not an enforcement system. Future host-mediated calls must authorize every operation against current grants; unsupported capabilities must fail closed. Revocation can block future brokered calls but cannot undo disclosed data or direct OS effects.
- **Lifecycle and recovery:** startup must never auto-run merely discovered packages. Failure, timeout, shutdown, restart, partial initialization, stale grants, package changes, and corrupt state need explicit policies and observable diagnostics. Persistence and package operations are P6, currently deferred.

Offline operation is compatible with all four options: package inspection, local descriptors, and local process IPC do not inherently require cloud services. Any design must avoid mandatory remote registries, downloads, authentication, or connectivity.

## 6. Owner decisions required

The following cannot be safely chosen by an implementation agent. Recommended defaults are suggestions only:

| Decision | Recommended default awaiting approval |
|---|---|
| Are executable third-party plugins a product requirement? | **No commitment yet.** Keep P1 useful without execution; require an explicit product decision before runtime planning. |
| Who authors/distributes plugins: user-authored, internal, or public third-party? | Start with no distribution assumption; do not treat local availability as trust. Public/untrusted distribution requires stronger isolation and publisher policy. |
| What trust and publisher identity model is acceptable? | Do not equate local installation, consent, or fingerprint with trust. Signing/identity policy requires a separate decision. |
| What production host owns lifecycle? | Do not choose Vite dev/preview as production supervisor by implication. Define packaged host, startup/shutdown ownership, and supported OSes first. |
| Is separate-process execution acceptable? | Treat as a research option only; do not approve until host and enforcement are defined. |
| What OS-level boundary is required? | Default to no execution until platform-specific controls are demonstrably enforced. A normal child process is insufficient. |
| Which capabilities may eventually be granted? | Begin with none. Add only concrete, least-privilege host operations after P4 policy and enforcement design. |
| What must work offline? | Preserve full core functionality offline; keep discovery, review, and any approved local plugin behavior independent of cloud services. |
| What should happen on plugin failure or revocation? | Core Nodus must continue; plugin failures must not block startup. Do not promise rollback of direct OS side effects. |

The official roadmap Phase 30 numbering conflict and the P0 historical correction remain separately unresolved in the closure report; this assessment does not change either document.

## 7. Implementation prerequisites and readiness

### A. Declarative-only development prerequisites

| Prerequisite | Current state | Measurable gate before approval |
|---|---|---|
| P1 compatibility | P1 v1 is strict and rejects unknown fields. | Owner selects an explicit transport: unchanged external/versioned data resource, or a separately approved manifest-format version with migration behavior. Existing v1 packages continue to validate unchanged. |
| DTO/version compatibility | P3 specifies illustrative API-major-1 JSON DTOs; no ingestion schema exists. | Publish a runtime schema, supported host/API compatibility rules, stable field bounds, and unknown-field behavior; tests prove serialized data validates independently of TypeScript types. |
| Contribution validation | Design only. | Tests reject unknown host views/icons, malformed IDs/text/order, duplicate contribution IDs independent of input ordering, and unsafe URLs/paths/callback-like fields. Invalid descriptors remain diagnostic-only and are never rendered. |
| Host/UI integration | Host renders built-in views and sidebar, but has no contribution registry. | Any approved prototype uses host-owned components, accessible names/focus, deterministic order, and has no plugin callbacks or code loading. |
| Offline behavior | P1/P3 require offline compatibility. | Validation/rendering succeeds with network disabled and has no remote fetch, auth, or registry dependency. |
| Error handling | P1 has structured metadata diagnostics. | Malformed/oversized contribution data produces bounded, safe diagnostics and cannot interrupt application startup. |

These gates support only inert, data-only declarations. They do not authorize executable plugins or change P5’s current roadmap status. **Owner decision required:** whether this declarative work is an approved scope adjustment, since P3 has no current ingestion path and the P5 roadmap entry says runtime/lifecycle.

### B. Executable runtime development prerequisites

All of these remain outstanding. P5 must not implement runtime until each has evidence and explicit owner approval:

1. **Approved execution model and trust policy:** state whether untrusted third-party code must be supported; identify distribution and publisher identity assumptions.
2. **Production host boundary:** name the packaged host and supported OS/platform matrix; define executable packaging, process ownership, startup, shutdown, upgrades, and supervision. Vite preview is not sufficient evidence of a product process supervisor.
3. **OS-enforced security design:** specify filesystem/vault, network, environment/secret, subprocess, IPC, and resource restrictions. For each supported OS, demonstrate enforcement with adversarial tests before describing the runtime as isolated.
4. **Versioned IPC and authorization:** define bounded schemas both directions, peer/session identity, method allowlist, API compatibility and migration, request deadlines, quotas, replay handling, and per-call deny-by-default authorization. P4 grants remain design-only until storage and enforcement are approved.
5. **Lifecycle and failure contract:** define dependency startup order, no-auto-run behavior, initialization timeouts, crash isolation, shutdown deadlines, cleanup, restart policy, diagnostics, and core-app availability under plugin failure.
6. **Package/persistence model:** define installation, update, enablement, configuration, grant persistence, revocation, uninstall, rollback, concurrency, and recovery. These intersect P6 and must not be improvised inside P5.
7. **Offline guarantee:** verify install/review/activation behavior that is approved can function without network services; no mandatory marketplace, account, or remote dependency.
8. **Verification plan:** provide platform-specific isolation tests, malformed IPC tests, denied-grant tests, startup/crash/timeout/restart tests, resource-limit tests, package-change and stale-grant tests, offline tests, and regression tests proving existing Nodus functionality remains available.

Passing unit tests for IPC or API permissions alone cannot satisfy the OS-isolation gate.

## 8. Proposed P5 scope and acceptance criteria

**Current approved scope:** none beyond keeping the metadata-only foundation intact. P5 remains deferred.

**Recommendation for a future owner decision:** if the product needs a next plugin-workstream activity before executable prerequisites are met, authorize a bounded **design-only host and execution feasibility study** (Option C) or a separately scoped **declarative-only contribution ingestion proposal** (Option B). Neither should be called runtime implementation or P5 completion without revising P5’s scope explicitly. Do not start either under this assessment alone.

If the owner later authorizes declarative-only work, it is acceptable only when all gates in §7A pass: no manifest v1 change without explicit versioning approval; no entrypoint load; strict runtime validation; deterministic collision handling; host-owned rendering; safe diagnostics; offline operation; and tests prove no callbacks, URLs, paths, or executable fields are consumed.

If the owner later approves executable runtime work, it is acceptable only after all §7B prerequisites are met and tests demonstrate, per supported platform, that the selected OS boundary enforces the stated filesystem/network/environment/subprocess/resource policy. Additional acceptance evidence must show: no execution during discovery; explicit user enablement; unsupported capabilities denied; grants checked on every host API request; package/API/host compatibility validated; plugin crash/timeout does not block Nodus; shutdown/revocation behavior is bounded and documented; offline operation; and migration/backward compatibility for existing P1 packages.

## 9. Final recommendation

**DEFER.** The repository has a useful non-executing metadata foundation and a Vite-hosted local API with orderly middleware disposal, but no production plugin host, process supervisor, approved trust model, or enforced OS boundary. Option D preserves P2 and avoids implying capabilities the application cannot enforce. Option C may be useful only after owner authorization; Option B also requires a separate data transport and compatibility decision. No runtime, P5 implementation, or P6 work is approved by this assessment.
