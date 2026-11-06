# Plugin Workstream P3 — Public API and Declarative Contribution Contract

**Status:** P3 design deliverable complete. This is a proposed, versioned contract for future review and implementation; it is not an implemented API or permission to execute plugin code.

**Boundary:** P1 remains metadata-only. P2 defers executable plugins. This document does not change the official roadmap, P1 manifest schema, application source, or runtime behavior.

## 1. Design goals

- Give future plugin metadata and host-rendered contributions stable, versioned identities.
- Keep declarations data-only and validate them before any future host presentation.
- Keep Nodus as owner of navigation, accessibility, workspace data, and rendering.
- Avoid exposing internal Nodus types or filesystem details.
- Keep the contract transport-neutral so a later approved host can choose an implementation boundary.
- Preserve offline-first behavior and make no cloud service or registry a requirement.

This proposal defines a public contract shape, not a mechanism for a package to submit it. That packaging/source decision is deliberately left open because P1 rejects unknown manifest fields and P2 does not authorize loading or executing packages.

## 2. Versioning and compatibility

The existing P1 field `pluginApiVersion` is the compatibility selector for the future public plugin API. Its integer value is independent of `formatVersion`, plugin `version`, and the Nodus application version. The proposed first contract is API major `1`; a package declaring `pluginApiVersion: 1` is only declaring compatibility metadata. It does not mean API v1 is implemented or available.

Compatibility rules proposed for implementation:

1. A host accepts only an explicitly supported API major. Unknown majors are rejected with a structured diagnostic; there is no best-effort interpretation.
2. `minNodusVersion` continues to use the strict stable `major.minor.patch` format already specified in P1. The host rejects packages requiring a newer host version.
3. API v1 additions may add optional fields with defined defaults. Existing required fields and meanings remain stable for the v1 major.
4. Removing a field, changing its meaning, widening a destination, or making an optional field required is a breaking change and requires a new API major or an explicit compatibility adapter.
5. Deprecated fields remain accepted for the documented lifetime of their API major where feasible. A removal requires a new major and a migration note. Hosts must not silently coerce unknown or malformed values.
6. Manifest format evolution remains separate. P3 does not add fields to `nodus-plugin.json`.

The public contract should be expressible as JSON-compatible DTOs and runtime schemas. TypeScript types alone are not validation: any future boundary must validate serialized input at runtime, including length, enum, identifier, numeric-range, and nested-object constraints.

## 3. Identity and metadata

Plugin identity comes from the validated P1 manifest, not the display name or package path:

```ts
type PluginId = string; // P1 reverse-DNS ID, e.g. "io.example.reading-tools"

interface PluginIdentityV1 {
  readonly id: PluginId;
  readonly name: string;
  readonly version: string;
  readonly pluginApiVersion: 1;
}
```

The identity object is a host-produced view of already validated P1 metadata. It does not assert installation, trust, enablement, consent, or activation. Plugin IDs remain stable lowercase ASCII reverse-DNS identifiers. Names are display text and may change without changing identity.

Each contribution has a plugin-local stable ID. The host derives its global key as `<plugin-id>:<local-id>`. Local IDs use lowercase ASCII words separated by hyphens; they must not include a plugin ID, path, URL, display name, or generated array index. Renaming a label must not change the contribution ID. Duplicate global IDs are errors; the host must not choose a winner based on filesystem or discovery order.

## 4. Declarative sidebar navigation contribution

The initial proposed contribution is a navigation entry rendered by Nodus. It contains only bounded data; it cannot supply a component, callback, command handler, or executable action.

```ts
type HostViewId = string; // Future host-defined allowlist; not arbitrary routes.
type IconToken = string;  // Future Nodus-owned symbolic icon allowlist.

interface SidebarEntryV1 {
  readonly kind: 'sidebar-entry';
  readonly id: string; // stable plugin-local ID
  readonly label: string; // plain text, bounded by the eventual runtime schema
  readonly icon?: IconToken;
  readonly destination: {
    readonly kind: 'host-view';
    readonly id: HostViewId;
  };
  readonly group?: {
    readonly id: string; // stable grouping key
    readonly label: string; // plain text
  };
  readonly order?: number; // bounded safe integer
  readonly availability?: {
    readonly requiresHostViews?: readonly HostViewId[];
  };
}
```

`HostViewId` and `IconToken` are symbolic identifiers resolved from host-owned allowlists. A contribution cannot provide an `href`, URL, filesystem path, vault path, React node, CSS, HTML, icon component, or custom view implementation. Destinations are restricted to built-in Nodus views; plugin-defined screens are outside P3.

Ordering is deterministic: host section/group order first, then numeric `order` (default `0`), then plugin ID, then local contribution ID using ordinal string comparison. Group IDs are stable keys; group labels are display-only. The host owns actual accessibility names, focus behavior, keyboard interaction, and rendering.

Availability is declarative. `requiresHostViews` means the host omits or marks the entry unavailable when a required built-in destination is unsupported in the current host. It does not permit a plugin to run a predicate, subscribe to state, or dynamically hide UI. Per-user visibility preferences, if ever added, are host-owned settings and not plugin callbacks.

### JSON illustration

This is a contribution DTO example only. It is not a valid extension to the current P1 manifest and is not consumed by Nodus today.

```json
{
  "kind": "sidebar-entry",
  "id": "reading-list",
  "label": "Reading list",
  "icon": "book-open",
  "destination": {
    "kind": "host-view",
    "id": "notes"
  },
  "group": {
    "id": "personal",
    "label": "Personal"
  },
  "order": 20,
  "availability": {
    "requiresHostViews": ["notes"]
  }
}
```

The example IDs and icon token are illustrative. A future implementation must publish the exact host-view and icon allowlists, bounds, and fallback behavior as part of its versioned runtime schema.

## 5. Validation and diagnostics

A future host validator should reject a contribution when any of these conditions holds:

- It is not a plain JSON object or contains unknown fields for the selected API major.
- `kind`, local ID, label, icon token, destination kind, or host-view ID is unsupported or malformed.
- Text exceeds published byte/character limits, contains prohibited control characters, or is not valid normalized text under the chosen schema.
- `order` is non-finite, unsafe, fractional, or outside the published range.
- Group or availability references are malformed or outside host allowlists.
- The plugin-local ID is duplicated, or its owner-qualified ID collides with another contribution.
- The contribution owner does not match the validated package identity supplied by the host.

Validation should produce structured, sanitized diagnostics with stable codes, severity, plugin ID, contribution ID when safely known, field/path within the DTO, and an actionable message. It must not expose absolute filesystem paths, secrets, or stack traces. Diagnostic naming should use a contribution-specific namespace such as `CONTRIBUTION_FIELD_INVALID` and `CONTRIBUTION_ID_DUPLICATE`; P3 does not modify P1's diagnostic union. If implemented later, shared diagnostic types should be reconciled deliberately rather than duplicated silently.

For duplicates, report every colliding entry and reject the collision set; never use first-found wins. Invalid entries remain inspectable as diagnostics but must not be rendered as active navigation.

## 6. P1 manifest compatibility

The P1 v1 manifest remains exactly the schema in `docs/phase30b-plugin-manifest-registry.md`. In particular:

- `configSchema`, `uiContributions`, contribution arrays, and new capability names are **not** added by P3.
- P1 rejects unknown top-level fields. Do not teach a P1 reader to accept unvalidated fields.
- P1's `commands.register` and `sidebar.register` values are capability metadata only. They are not implemented API methods, grants, or permission decisions.
- The `.mjs` `entryPoint` is inventoried as a path but is never loaded or executed.
- The JSON example above is a design DTO, not a manifest fragment, installation package, or executable contribution source.

Any future need to persist declarations in packages requires a separate manifest-format proposal. It must choose either a new format version with explicit migration/compatibility behavior or a separately versioned data-only contributions resource. Existing v1 packages must continue to validate unchanged. Unknown required features must be rejected, not ignored; hosts may preserve unknown optional extension data only if a later format explicitly defines that behavior. No such extension is approved here.

## 7. Unsupported in P3

P3 does not support command handlers, callbacks, closures, event listeners, background jobs, scheduled work, arbitrary JavaScript, plugin-defined route handlers, React components, editor extensions, database integrations, or custom views. It defines no package loading or contribution ingestion path. The navigation DTO cannot execute behavior; it only describes a host-rendered link to an allowlisted built-in view.

Considering executable contributions later requires a new owner decision covering production host ownership, supported platforms, execution model, trust assumptions, failure/resource limits, IPC if applicable, and what security guarantees can actually be enforced. Consent or API validation alone is not isolation.

## 8. Security boundary

This contract exposes no Nodus internal objects, vault objects, filesystem paths, secrets, unrestricted network capability, request/response objects, database handles, or privileged host APIs. Declarative identifiers are resolved by the host against fixed allowlists. Metadata validation and fingerprints do not make a package trusted.

Because P2 defers execution and P3 defines no ingestion mechanism, the DTO is currently inert documentation. If a later host accepts these declarations, it must validate them at runtime and render them itself. The contract alone does not sandbox code, protect against a compromised host, or constrain OS access.

## 9. Future contract test and acceptance strategy

No implementation or tests are added by P3. A later implementation should include:

- API major supported/unsupported and host `minNodusVersion` compatibility cases.
- Round-trip serialization of valid DTOs and runtime schema validation independent of TypeScript compilation.
- Unknown fields, wrong types, invalid text, excessive lengths, invalid numeric order, malformed group/availability, unknown icon and destination cases.
- Stable local and owner-qualified identity, duplicate IDs within one package, and collisions across packages, proving deterministic rejection independent of input order.
- Ordering ties and grouping behavior.
- Proof that declarations cannot express callbacks, arbitrary URLs, paths, HTML, React components, or custom views.
- P1 compatibility regressions proving v1 manifests remain unchanged, unknown fields remain rejected, and no P3 fields are silently accepted.
- Non-execution tests proving discovery/validation never imports or evaluates an entrypoint.

## 10. Acceptance boundary

P3 is a design-only deliverable. Its design acceptance criteria are satisfied by this document: it defines API versioning and host compatibility, stable identity, a data-only sidebar contribution, destination/order/group/availability semantics, validation and diagnostics, P1 compatibility, security boundaries, illustrative types/JSON, unsupported executable behavior, and a future test plan. This status does not mean a public API exists in code, that the contract is frozen against future owner review, or that P4/P5 has started.
