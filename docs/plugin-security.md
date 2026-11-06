# Historical Plugin Security Proposal

**Status:** This document preserves an earlier proposal and is not an implemented security model. P1 only validates and inventories metadata; no plugin code is evaluated. P2 defers executable plugins and no runtime is approved. Official Phase 30 is Conflict Resolution. The current design-only permission and consent model is [P4](plugin-workstream-p4-permission-consent.md).

## Trust boundary

The current UI server is a Node process running as the local user. If JavaScript were evaluated in that process, it could potentially use Node built-ins, access files available to that user, import other modules, make network requests, consume CPU/memory, or terminate the process. Passing a narrow API object does not prevent a hostile module from reaching those capabilities. Worker threads or `vm` contexts alone would not establish a secure boundary. This is a threat analysis, not a description of current plugin execution: P1 never evaluates package code.

The following consent and enablement flow was proposed historically and is not available: there is no plugin installation, Plugins settings page, enablement, consent, or restart activation. P1 discovery inspects an explicitly supplied root and does not mutate it. No marketplace, remote registry, download, or auto-update is implemented by P1.

No execution model is currently approved. A separate process with typed IPC is only a future evaluation option; an ordinary child process is not a sandbox. Any future proposal must define a production host and supported platforms, and independently implement and verify OS-enforced restrictions before claiming isolation. A typed IPC protocol or API permission checks alone cannot confine direct operating-system access.

## Historical capability and grant proposal — not implemented

P1 recognizes `commands.register` and `sidebar.register` only as manifest metadata strings. Neither capability has a functioning API, is granted, or causes a contribution to be registered. P4 defines permission and consent semantics as design only; it does not implement grants, consent UI, persistence, revocation, or enforcement.

The earlier proposal listed:

| Capability | Effect | V1 policy |
|---|---|---|
| `commands.register` | Add host-rendered text commands | Explicit user grant required |
| `sidebar.register` | Add host-rendered command links | Explicit user grant required |
| `events.subscribe` | Subscribe to application events | Unsupported; rejected |
| `workspace.read` / `workspace.write` | Read or mutate workspace data | Unsupported; rejected |
| `database.read` / `database.write` | Access database data | Unsupported; rejected |
| `network.request` | Make network requests | Unsupported; rejected |
| `filesystem.read` / `filesystem.write` | Access files | Unsupported; rejected |

The table is historical and must not be read as a supported API or grant system. P1 rejects capabilities outside its implemented allowlist; the two accepted strings remain metadata only. No permission approval is stored and nothing can be approved in Settings. P4 proposes future binding of decisions to identity and package metadata, but those semantics are not implemented. A package fingerprint is an integrity identifier; it does not establish publisher identity or trust.

The historical proposal treated permissions as limits on a public API facade. Such checks would not constrain direct OS access by unsandboxed executable code. Any future UX must distinguish **API authorization** from **process-level isolation**; neither a grant nor consent establishes trust or confinement.

## Historical filesystem, install, and persistence proposal — not implemented

There is no managed plugin root, installer, uninstall/quarantine flow, persisted registry, configuration store, grant store, or plugin-specific atomic write path. P1 accepts an explicit discovery root, performs read-only package inspection, and builds an in-memory registry.

The following filesystem practices are retained as historical design recommendations, not current operations:

The old proposal placed a future managed plugin root under per-user Nodus application data and outside the vault. P1 instead receives a root explicitly from its caller. Its discovery/inventory code validates IDs and paths, rejects symlinks and special files, enforces inventory limits, and checks real-path containment. It parses and validates manifests without module evaluation.

The former proposal described confirmation, disablement, disposal, quarantine, and atomic persisted registry/config writes. None of those operations exists in P1. They must be designed and reviewed before any future installation or persistence milestone.

No plugin commands or host API are currently exposed. Any future API must avoid leaking request/response objects, vault paths, raw notes, databases, filesystem methods, or lock access; future writes would need narrowly typed host operations that preserve existing validation, expected-hash, and locking guarantees.

## Threat analysis and future requirements

- If executable plugins are reconsidered, malicious or defective code could crash, hang, exhaust resources, access local files, or make network calls. There is no activation/command error isolation implementation today; a same-process design would not prevent forced process exit or direct OS access.
- External processes may alter package files. P1 fingerprints the package inventory during discovery; this is not an atomic snapshot against hostile concurrent writers and does not establish what a future loader would execute.
- If plugin code were ever run in the UI server process, loopback and origin checks would not constrain that code's direct Node or OS access.
- The current P1 package format has no publisher signing or signature verification. Future consent would not prove publisher identity.

These are future threat considerations, not claims that a runtime or UI exists. Any future execution proposal must state its guarantees and non-guarantees and must not call an ordinary process, worker, or IPC boundary a sandbox.
