# Historical Plugin API Proposal

**Status:** Not implemented. The examples below are not usable by plugins. The current design-only contract is `docs/plugin-workstream-p3-api-contract.md`; P2 defers executable plugins. Official Phase 30 is Conflict Resolution.

## Compatibility

P3 proposes an integer `pluginApiVersion` for a future public API, independent of Nodus note, database, saved-view, backup, and portable-export versions. P1 validates this compatibility metadata only; it does not provide API v1 methods or load an entry point. Version-evolution rules below are proposals, not implemented compatibility behavior.

P1 validates `minNodusVersion` as a strict stable `major.minor.patch` value and checks host compatibility. This does not authorize or trigger plugin execution.

## Manifest

File name: `nodus-plugin.json`.

The current P1 v1 manifest shape is shown below. It is metadata only; `entryPoint` is inventoried but never loaded. `dependencies` may be omitted or empty. P1 rejects unknown top-level fields.

```json
{
  "format": "nodus-plugin",
  "formatVersion": 1,
  "id": "io.example.reading-tools",
  "name": "Reading Tools",
  "version": "1.0.0",
  "description": "Example reading-list commands.",
  "author": "Example Studio",
  "minNodusVersion": "0.1.0",
  "pluginApiVersion": 1,
  "entryPoint": "dist/plugin.mjs",
  "capabilities": ["commands.register", "sidebar.register"],
  "dependencies": [
    { "id": "io.example.shared", "range": "^1.0.0", "optional": false }
  ]
}
```

The P1 schema requires `format`, `formatVersion`, `id`, `name`, `version`, `description`, `author`, `minNodusVersion`, `pluginApiVersion`, `entryPoint`, and `capabilities`; `dependencies` is optional. `configSchema` and `uiContributions` are not P1 fields and are rejected as unknown. See `docs/phase30b-plugin-manifest-registry.md` for the authoritative schema and limits.

P1 recognizes `commands.register` and `sidebar.register` as metadata strings only. These are not implemented API methods, grants, or permission decisions. P1 validates local dependency declarations and ordering; it does not install dependencies or activate plugins.

The following configuration-schema description was part of an earlier proposal. P1 does not implement plugin configuration schemas or a plugin configuration store; a `configSchema` field is rejected by manifest v1.

Likewise, `uiContributions` is not part of P1 v1 and is not currently accepted. P3 describes an illustrative data-only sidebar DTO separately; it does not add contribution fields to the manifest or provide a package ingestion path.

## Historical executable module sketch — unsupported

The following TypeScript interfaces were proposed in an earlier design. No public source module exports these interfaces; Nodus has no `activate`/`deactivate` contract, plugin callbacks, command handlers, registration handles, runtime, or permission enforcement. P2 explicitly defers executable plugins. Do not use this as an implementation or package example.

```ts
export interface NodusPluginApiV1 {
  readonly apiVersion: 1;
  readonly plugin: Readonly<{ id: string; name: string; version: string }>;
  readonly config: Readonly<Record<string, string | number | boolean>>;
  readonly commands?: {
    register(command: PluginCommandV1): PluginRegistrationHandleV1;
  };
  readonly sidebar?: {
    register(item: PluginSidebarItemV1): PluginRegistrationHandleV1;
  };
}

export interface PluginCommandV1 {
  id: string;                 // stable local ID, unique within the plugin
  title: string;              // plain text, bounded length
  description?: string;       // plain text, bounded length
  run(): void | string | Promise<void | string>;
}

export interface PluginSidebarItemV1 {
  id: string;                 // stable local ID
  label: string;              // plain text
  commandId: string;          // local command ID registered by this plugin
}

export interface PluginRegistrationHandleV1 {
  dispose(): void;            // idempotent
}
```

These types are illustrative historical sketches only and are not exported by Nodus. P3's current design-only contract is JSON-compatible declarative data; command handlers and callbacks remain unsupported.

Owner-qualified contribution IDs and cleanup handles are proposals, not implemented registration behavior. P3 documents deterministic identifiers and validation expectations for a future host-rendered declarative contribution contract.

## Historical lifecycle and error proposal — not implemented

No manager validates before import, activates plugins, records Active/Failed lifecycle state, checks grants, or disposes plugin registrations. P1 returns metadata and diagnostics only. P2 defers runtime pending an approved production host and security model.

An API contract or facade would not itself be a security sandbox. API checks cannot prevent direct OS access by executable code. See the current design-only [P2 decision](plugin-workstream-p2-decision.md) and [P4 permission/consent design](plugin-workstream-p4-permission-consent.md).
