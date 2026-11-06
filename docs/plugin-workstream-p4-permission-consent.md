# Plugin Workstream P4 — Permission and Consent Design

**Status:** P4 design deliverable complete. This is a proposed policy model, not implemented permission enforcement, consent UI, grant storage, or revocation logic.

**Boundary:** P1 remains metadata-only; P2 defers executable plugins; P3 is a declarative API design only. This document does not change the P1 manifest, application behavior, or official roadmap. Official Phase 30 remains Conflict Resolution.

## 1. Purpose and governing rules

This proposal defines how a future plugin system could name capabilities and represent informed user decisions. It does not grant a discovered package access. Permission declarations, validation, user consent, host API authorization, and operating-system isolation are separate concepts:

1. A manifest declaration is an untrusted request, not a grant.
2. User consent records intent, not proof that a package is safe.
3. Host API checks can authorize calls made through Nodus interfaces only.
4. API checks cannot confine code that can directly use operating-system facilities.
5. A fingerprint binds a decision to package bytes; it is not publisher authentication or trust evidence.
6. No plugin execution is approved by P4. P5 remains deferred under P2 until host, platform, and security decisions are approved.

The future model should be deny-by-default, least-privilege, specific, reviewable, revocable at the host boundary, and compatible with offline use.

## 2. Permission vocabulary proposal

Names below are design vocabulary only. Except for the two P1 metadata strings called out below, none is accepted by the P1 validator or implemented by Nodus. Even the P1 strings are declarations only, not operational permissions.

| Area | Illustrative capability | Intended scope and limits | Current status |
|---|---|---|---|
| Declarative UI | `ui.sidebar.contribute` | Submit bounded data-only sidebar descriptors for host validation/rendering. No callbacks, HTML, React components, arbitrary routes, or workspace reads. | P3 design only. P1 currently recognizes `sidebar.register` as metadata; it does not implement or grant it. |
| Commands / host actions | `commands.register` | Register metadata for a host action only if a separately approved executable contract exists. Invocation handler execution is not authorized by P2/P3. | P1 recognizes this string as metadata only. Command handlers are unsupported. |
| Workspace metadata | `workspace.metadata.read` | A narrowly defined, minimized set of non-content workspace facts, if justified. Must not imply note or database access. | Not supported. |
| Document read | `workspace.documents.read` | Explicit resource classes and fields; no unrestricted vault scan or raw filesystem path. | Not supported. |
| Document write | `workspace.documents.write` | Specific operations with validation, expected revision/hash, and existing vault locking. Never direct filesystem mutation. | Not supported. |
| Database read | `database.records.read` | Named databases/fields and bounded queries; excludes internal database handles. | Not supported. |
| Database write | `database.records.write` | Named operations through existing schema validation and safe-write APIs. | Not supported. |
| Filesystem read | `filesystem.user-selected.read` | At most a future, user-selected file grant with narrow path/operation scope; never arbitrary root access by default. | Not supported; no filesystem capability is accepted by P1. |
| Filesystem write | `filesystem.user-selected.write` | Future explicit destination selection and atomic/safe writes, separately reviewed. | Not supported. |
| Network | `network.request` | If ever considered, require explicit destination/origin and method policy; no implicit unrestricted network. Direct OS network access remains possible without sandboxing. | Not supported. |
| Notifications | `notifications.show` | Host-mediated, bounded, user-visible notifications with frequency limits and no sensitive content by default. | Not supported. |
| Background tasks | `tasks.schedule` | Future host-managed, bounded, inspectable jobs with quotas, cancellation, and offline semantics. No arbitrary always-running plugin loop. | Not supported. |
| External integrations | `integrations.<provider>.<operation>` | Named provider and operation scopes; host-held credentials never exposed to plugin code. Each integration needs its own consent and data-flow review. | Not supported. |

Capability strings should be stable, namespaced identifiers. Display names and explanations are separate localized host text. Avoid broad capabilities such as `workspace.access` or `filesystem.access`; split read/write and resource scopes where a real use case exists. Do not add speculative capability strings to P1 or treat the table as an allowlist.

### Declaration versus grant

The P1 `capabilities: string[]` is only validated metadata. It currently recognizes `commands.register` and `sidebar.register`, each with no operational effect. P1 does not encode required-versus-optional requests, grants, consent, or enforcement. A declaration must never cause an API to appear, a plugin to activate, or a permission to be granted.

If a future schema needs required/optional semantics or scoped requests, that change requires a separately reviewed manifest-format evolution or versioned data-only resource. P4 does not add `configSchema`, `uiContributions`, scope objects, or any other P1 field.

## 3. Deny-by-default and consent semantics

### Default state

For any future capability, the default is **no grant**. A missing decision, corrupt decision record, unsupported capability, changed package identity, or stale grant is treated as denied. There is no implicit grant based on installation, discovery, dependency relationship, API compatibility, or prior consent to another capability.

Suggested future decision states are `not-requested`, `pending`, `granted`, `denied`, `revoked`, `stale`, and `unsupported`. These are design terms, not current lifecycle or registry states.

### Explicit user choice

Consent must be an affirmative, capability-specific user action after the UI explains the effect and scope. A single “trust this plugin” action must not silently grant all current or future capabilities. A later capability request requires a new decision. Denial is durable enough to avoid repeated prompts, but must remain user-changeable through a review surface.

### Required and optional requests

P1 does not distinguish required and optional capability requests. If a future format adds that distinction:

- A denied required capability makes the requested plugin feature unavailable; the host must not partially activate behavior that assumes the capability.
- A denied optional capability remains absent. Other independently valid declarative features may remain available if the future contract defines that behavior.
- The host must display the effect of denial and must never silently substitute a broader capability.
- Unsupported capabilities are rejected, not downgraded or ignored.

Until a schema extension is approved, no code may infer optionality from absence, capability ordering, plugin description, or dependencies.

### Least privilege

Future APIs should expose narrow operations, bounded results, and resource-specific scopes. Prefer a host operation such as “open this selected note by stable ID” over raw vault access. Avoid ambient access, unrestricted paths, arbitrary URLs, opaque credential handles with broad authority, and APIs that return internal Nodus objects.

## 4. Grant identity and integrity binding

If grant persistence is later approved, a grant decision should be bound to a canonical tuple containing:

- Stable P1 plugin ID.
- Plugin version from the validated manifest.
- Exact package fingerprint from P1 inventory.
- Capability identifier and any approved scope/parameters.
- Plugin API major.
- Grant-record schema version and host security-policy revision.
- Host compatibility result derived from `minNodusVersion` and the running Nodus version.

The plugin version is useful for review and display, but the fingerprint is the content binding. Semver equality alone is insufficient. A fingerprint is a content-integrity identifier, not a signature, publisher identity, malware scan, or trust judgment.

### Invalidation rules

- **Any package byte/path-set change:** all grants for the old fingerprint become stale; require package revalidation and fresh review. This includes entrypoint, manifest, and dependency content changes.
- **Version changes:** require review even if the bytes appear otherwise equivalent. A changed manifest normally also changes the fingerprint.
- **Plugin ID changes:** treat as a different plugin. Never transfer grants by display name, directory resemblance, or claimed migration.
- **Requested capability added or widened:** no grant exists for it; require explicit review. Do not inherit a related or broader grant.
- **Requested capability removed or narrowed:** do not silently reinterpret another grant. Mark the old decision stale or retain only a clearly identical scope after a reviewed migration policy.
- **API major or policy revision changes:** grants whose meaning or enforcement changed become stale and require fresh consent.
- **Host version changes within a compatible API/policy:** do not prompt for every patch by default; revalidate compatibility and prompt only when a host compatibility or policy change affects the grant's meaning.
- **Missing, malformed, or corrupt grant record:** deny and preserve the record for diagnosis; never reconstruct approval from plugin metadata.

The exact serialization, locking, atomic update, backup, and retention behavior belongs to later persistence work and must be designed before any grant store exists.

## 5. Revocation and lifecycle implications

Revocation means the host stops authorizing the named capability. It is not a promise to undo actions already performed or remove data previously disclosed.

Future behavior should be:

1. Record the user decision as revoked or remove the active grant in a recoverable, concurrency-safe manner.
2. Stop issuing new host API operations for that capability and reject in-flight requests at the next safe cancellation/checkpoint boundary.
3. If a plugin depends on a required capability, mark it unavailable and require explicit re-enable/review after consent changes; never silently resume with broader access.
4. On package update, identity change, API-policy change, or stale state, stop activation before using stale grants and require fresh review.
5. On removal, revoke active grants. Whether to retain an audit tombstone or delete grant records is a future retention decision; it must not leave a reusable approval for a later package with the same display name.
6. On failed activation, do not mark the plugin active or expand its grants. Preserve diagnostics. Retry behavior must be an explicit lifecycle policy, not an automatic permission escalation.

Revocation limits depend on execution model:

| Future model | Possible host-side revocation | Non-guarantee |
|---|---|---|
| Same-process module | Reject future brokered API calls and attempt lifecycle cleanup. | Cannot prevent direct filesystem/network/environment access or reliably undo side effects; a module may retain references or hang/crash the host. Not suitable for untrusted plugins. |
| Ordinary child process with IPC | Close/revoke the IPC session and request termination; host can reject all subsequent messages. | Child still has same-user OS access unless separately restricted; termination may be delayed or fail; direct OS side effects are not revoked. Not a sandbox. |
| OS-enforced sandbox | Potentially revoke brokered and OS capabilities subject to the platform's enforcement and handle semantics. | No guarantee until the policy is implemented, tested on each supported OS, and shown to revoke existing handles/resources. |
| Current P1 / no execution | There is no runtime grant to revoke. | A discovered package is not installed, enabled, or authorized. |

## 6. Consent experience principles

No consent UI is implemented or authorized in P4. If designed later, it should:

- Show plugin ID, name, version, package fingerprint/change status, API compatibility, and validation diagnostics separately from permission requests.
- Explain each capability in plain language: what data/action it covers, what is excluded, and whether the statement applies only to Nodus APIs or is OS-enforced.
- Separate **requested**, **currently granted**, **denied/revoked**, **stale**, and **unsupported** capabilities. Never label a request as granted merely because it is in the manifest.
- Show required versus optional consequences only when a future schema explicitly represents them.
- Require a distinct confirmation for newly requested or widened capabilities after an update. Do not bundle unrelated grants into one ambiguous “Allow” button.
- Provide a review/revocation location and state that revocation cannot retract data already read or undo prior writes.
- State prominently that fingerprints do not verify publisher identity and that consent is not a malware or trust guarantee.
- Explain that ordinary child processes and API checks do not restrict direct operating-system access. Do not use “sandboxed” without verified OS enforcement.
- Keep offline review and local use functional. No account, cloud consent service, marketplace, or remote registry is required.
- Use accessible names, keyboard-operable controls, visible focus, and separate loading/error/unsupported states if a UI is later approved.

## 7. Threat model

| Threat | Design response | Residual risk / limitation |
|---|---|---|
| Malicious package requests broad access | Capability vocabulary is narrow; unsupported requests fail closed; each supported request would need specific consent. | Consent cannot establish trust. P1 currently rejects capabilities outside its small metadata set. |
| Compromised dependency changes behavior | P1 fingerprints the complete package inventory; any byte change makes old decisions stale. Dependencies remain local and are validated by identity/version. | Fingerprints do not identify authors or prove dependencies benign. Future dependency packaging and grant scope need explicit rules. |
| Package changes after consent | Bind grant to exact fingerprint and revalidate before any future activation; changed content invalidates grants. | Concurrent filesystem races and runtime-loaded code require later host-specific defenses. P1 reads are not an atomic hostile-writer snapshot. |
| Excessive or confusing requests | Per-capability explanations, narrow scopes, clear requested/granted distinction, no bulk implicit grant. | Users may still approve without understanding; plain-language UX and restrained capability set are necessary. |
| Consent confusion / misleading trust signal | Explicitly separate consent, package integrity, publisher identity, and OS isolation. | A user may infer that “allowed” means safe; UX must state otherwise. |
| Stale or corrupt grants | Treat absent, corrupt, incompatible, or old-policy records as denied; preserve for repair. | Persistence races and recovery are unresolved until a later milestone designs storage/locking. |
| Privilege escalation | Exact capability/scope binding, API-major and policy revision binding, deny by default, reject unknown capability strings. | Host API bugs or overly broad methods can still grant more authority than intended. |
| Same-process plugin compromise | P2 defers execution; do not rely on facade restrictions as isolation. | If same-process execution were later proposed, plugin code could compromise the host; requires a new owner decision. |
| Child process or IPC abuse | Future protocol must authenticate the peer, validate every bounded message, bind requests to plugin identity/session, reject replay/unknown methods, and apply quotas. | Ordinary child processes retain OS rights. IPC validation protects the host API boundary only. |
| Host compromise | Keep plugin contracts narrow and avoid exposing host internals. | A compromised Nodus host can falsify consent/status and access its own data; plugin permissions cannot secure a compromised host. |
| Network/filesystem misuse | Do not add these capabilities by default; any future grant must be scoped and host-mediated. | Unsandboxed executable code can bypass host APIs and access OS resources directly. No confinement is currently guaranteed. |

## 8. Proposed future acceptance tests

These are test requirements for future implementation, not tests run or added by P4:

- No request, missing decision, denied decision, or unknown capability produces a grant.
- Unsupported capability fails closed with a stable diagnostic and no partial activation.
- Required versus optional denial follows an explicitly versioned schema and never silently changes behavior.
- Grant is bound to plugin ID, version, exact fingerprint, capability/scope, API major, and policy revision.
- Changed fingerprint, changed plugin ID, widened capability, incompatible API major, or stale policy invalidates consent.
- A compatible host patch does not cause an unnecessary prompt unless a relevant policy/compatibility revision changes.
- Revocation blocks later host API calls; in-flight cancellation behavior is tested and documented.
- Revocation tests do not claim to undo already completed reads/writes or to stop direct OS access in an unsandboxed model.
- Corrupt, missing, duplicated, or malformed consent records fail closed and produce sanitized diagnostics.
- Duplicate capability declarations and duplicate scope entries are rejected deterministically.
- Malformed consent requests, unknown fields, oversized strings/scopes, and privilege-widening update requests are rejected.
- UI tests distinguish requested, granted, denied, revoked, stale, and unsupported states and communicate non-sandbox limitations.
- Process/OS isolation claims require platform-specific tests proving the actual filesystem, network, environment, subprocess, and revocation policies; protocol tests alone are insufficient.

## 9. Decisions still required before implementation

P4 does not resolve:

- Whether future executable plugins may be trusted-local only or must support untrusted authors.
- Which capabilities have real product use cases and whether any capability can be scoped safely.
- How required/optional requests and scopes should be represented without changing P1 v1.
- Whether and how a future host can enforce network/filesystem restrictions on each supported platform.
- Grant storage format, cross-process locking, recovery, audit retention, and consent migration.
- How external integrations protect credentials and handle revocation.
- Whether command execution can be reconsidered while P2's no-execution decision remains in force.

## 10. P4 design acceptance boundary

P4 is complete as design only: this document defines a capability taxonomy, deny-by-default and required/optional semantics, identity/integrity binding, invalidation and revocation expectations, UX principles, threats, future tests, P1 compatibility limits, and unresolved implementation decisions. It adds no enforcement or consent behavior. P5 and P6 remain deferred and have not started.
