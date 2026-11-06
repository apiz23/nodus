# Historical Plugin Architecture Proposal

**Status:** Historical proposal; not implemented. Plugin Architecture is an independent P0–P8 workstream. Official Phase 30 in `docs/ROADMAP.md` is Conflict Resolution. See `docs/plugin-workstream-roadmap.md` for current status and decisions.

**Current boundary:** P1 provides metadata-only package validation/discovery and an in-memory registry. P2 defers executable plugins. There is no plugin installation, activation, runtime, permission enforcement, persistence, or management UI. The components and flows below are historical target-design material, not available Nodus functionality.

## Goals

Plugins extend Nodus through a narrow, versioned host API. Core features continue to work offline without plugins, accounts, a marketplace, or a cloud service. Plugin code is optional local code and never becomes a source of truth for notes, databases, tasks, Calendar data, or imports.

The historical target architecture proposed these components:

1. **Core application** — owns vault access, validation, locking, persistence, navigation, and existing features.
2. **Plugin registry** — discovers local packages, validates manifests and dependency graphs, and publishes read-only plugin summaries.
3. **Plugin lifecycle manager** — controls validation, installation state, enablement, activation, failure isolation, and disposal.
4. **Plugin runtime** — invokes a plugin entry point with a capability-filtered API facade. It does not pass internal application objects.
5. **Permission manager** — records explicit grants bound to the exact installed package fingerprint.
6. **Public extension API** — stable API versioned independently from Nodus file formats.
7. **UI integration** — renders serializable contributions in existing Nodus surfaces; plugins do not supply React components.
8. **Persistence** — stores plugin code, configuration, enablement, and grants in the per-user application-data directory, outside the vault.

The following diagram is a historical proposal, not the current application architecture:

```text
Settings UI ──typed local API──> Plugin manager ──> Registry / lifecycle
                                      │                    │
                                      │                    ├── manifest validation
                                      │                    ├── dependency order
                                      │                    └── permission checks
                                      │
                                      └── narrow Plugin API v1 facade
                                                   │
                                      trusted local plugin module
                                                   │
                                  owned command/sidebar registrations
```

The plugin manager talks to the UI through DTOs and explicit API routes. The UI never imports plugin modules, Node APIs, vault objects, or plugin-manager internals.

## Execution model status

P2 defers executable plugins. No plugin execution model is currently approved. The P1 entry point is validated and inventoried as package metadata only; it is not loaded. P1 capability strings are declarations only, not methods or grants.

Same-process API restrictions do not prevent direct OS access. Workers, IPC, and an ordinary child process are not security sandboxes. A separate process with typed IPC remains a future evaluation option only. Any future execution proposal requires an explicitly approved production host architecture, supported platforms, and security boundary; OS-level confinement must be independently implemented and verified before it is claimed.

The content below that describes a trusted-local module is retained as historical proposal material only. It is not an approved or supported execution model.

## Manifest and identity

The historical proposal placed each installed package in a directory named by a stable reverse-DNS plugin ID. P1 currently validates that ID and inventories a safe relative `.mjs` entry-point path, but discovery does not install or evaluate the package. The P1 manifest schema is specified in `docs/phase30b-plugin-manifest-registry.md`; unknown fields are rejected.

The implemented manifest contract is specified in [P1](phase30b-plugin-manifest-registry.md); the legacy [Plugin API proposal](plugin-api.md) is historical. Dependencies name plugin IDs. Required missing dependencies are errors; missing optional dependencies are warnings. Present dependency edges are cycle-checked. P1 returns a stable topological dependency order for valid candidates, using plugin ID as the tie-breaker; no activation occurs. Validation diagnostics include the plugin ID, field or dependency, and an actionable message.

## Historical lifecycle proposal — not implemented

P1 registry entries only have discovery/validation status (`discovered` or `invalid`). No Installed, Enabled, Loading, Active, Failed lifecycle manager, startup activation, or disposal behavior exists in Nodus. The following state diagram and semantics preserve the former proposal for reference only; they are not implementation guidance.

The lifecycle is:

```text
Discovered → Validated → Installed → Disabled ⇄ Enabled → Loading → Active
                     ↘ Failed       ↘ Failed       ↘ Failed
Active → Disabled; any state may become Uninstalled through confirmed removal
```

`Discovered` is a filesystem observation. `Validated` means the manifest, compatibility, package inventory, and dependency graph passed checks. `Installed` means the validated package is present in the managed directory. An installed plugin starts disabled until the user explicitly enables it and grants its requested capabilities. After the user has opted in, startup may restore the enabled state only while package fingerprint and grants still match. Changed code requires review and fresh consent.

Activation is idempotent. The manager records each registration under its owner and returns idempotent handles. On disable, it calls the plugin's optional deactivation hook, then disposes every remaining registration even if deactivation throws. Activation and disposal errors are isolated per plugin and shown in Settings; they do not reject the whole discovery operation. An activation that fails is not marked active. A shutdown hook runs best-effort for active plugins.

The API module does not allow plugins to mutate manager state directly. All lifecycle transitions pass through the manager and a fixed transition table.

## Historical persistence and local installation proposal — not implemented

There is no managed plugin directory, plugin registry persistence, configuration store, enablement state, grant store, installer, or uninstall/quarantine flow. P1 receives an explicit discovery root and performs metadata inspection without mutating it. The following layout and policies are retained as an unimplemented proposal only.

The plugin root is derived from the existing per-user application preferences directory, not from the selected vault:

```text
<Nodus application data>/plugins/
  registry.json                 # format/version, enablement and consent records
  <plugin-id>/                   # installed code, manifest and entry point
  config/<plugin-id>.json        # user configuration, separate from plugin code
  .uninstalled/<plugin-id>-...  # confirmed removals retained for recovery/manual deletion
```

The root and files use owner-only permissions where supported. Startup discovery is local and offline. Phase 30 does not fetch code or require a registry service. Packages are installed by placing a local package in the documented directory; Nodus validates it before making it available. A malformed or missing package is reported and skipped without blocking the workspace. Registry writes use the existing atomic-file primitive. Per-plugin configuration is validated against the constrained manifest schema and survives disablement and uninstall. Uninstall removes active state and moves only that plugin's directory into the quarantine directory; it does not recursively delete plugin data or other plugin directories.

## Historical UI integration proposal — not implemented

There is no Settings → Plugins interface, enable/disable control, permission review, or plugin contribution rendering. The following describes a possible future UI and is not a supported user workflow.

Users discover plugins under **Settings → Plugins**. The section explains that plugins are trusted local code and shows installed packages, compatibility state, lifecycle state, requested/granted capabilities, diagnostics, enable/disable, details, and confirmed uninstall. Empty, loading, unavailable-storage, and per-plugin failure states are distinct. A sidebar contribution is a label/icon plus command ID, not plugin-rendered JSX. A command is searchable in the existing command palette and runs through the local API.

The former proposal's common flow was to copy a local package into a managed folder and enable it in Settings. Nodus does not currently support that workflow. Discovery does not install or execute a package.

## Historical proposal decisions — superseded where they conflict with P2–P4

| Decision | Reason |
|---|---|
| Stable plugin ID is a validated reverse-DNS string | Display names can change and collide. |
| API compatibility is an integer major contract | Plugin API evolution must not track note/database format versions. |
| Executable plugin trust model undecided; execution deferred by P2 | No approved runtime or production host boundary exists. |
| No plugin-supplied React components | Declarative contributions preserve host accessibility and allow cleanup. |
| Commands and sidebar are the initial contribution types | They are useful and do not require exposing workspace or filesystem state. |
| P4 proposes future grant binding; no grant implementation exists | Fingerprints identify content and do not establish publisher identity, trust, or safety. |
| Plugin data is outside the vault | Plugins do not change Markdown portability or vault formats. |
| Uninstall quarantines rather than recursively deleting | User/plugin data is retained and unrelated files cannot be swept away. |
| No remote install or auto-update | Prevents hidden code downloads and keeps offline use complete. |

## Deferred extension points

Settings pages, context menus, editor extensions, application events, workspace metadata, database integrations/property types, and custom views are deferred. Each requires a separate contract, permission analysis, UI lifecycle, and compatibility tests. They must not expose internal stores or bypass vault validation/locking.
