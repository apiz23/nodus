# Historical Plugin Development Proposal

**Status:** Nodus has no executable plugin development or installation workflow. P1 validates package metadata and inventories files from an explicitly supplied root; it does not install or execute packages. P2 defers executable plugins, P3 is a design-only declarative API contract, and P4 is permission/consent design only. See [P1](phase30b-plugin-manifest-registry.md), [P2](plugin-workstream-p2-decision.md), [P3](plugin-workstream-p3-api-contract.md), and [P4](plugin-workstream-p4-permission-consent.md).

## Local folder structure

The following package shape is an illustrative historical proposal, not a supported installation location or workflow. P1 discovery accepts a caller-supplied root and does not copy or mutate packages:

```text
<Nodus application data>/plugins/<reverse-dns-id>/
  nodus-plugin.json
  index.mjs
```

P1 validates that a package directory name matches its manifest ID and that the declared `.mjs` entry point is a contained inventoried file. The entry point is never loaded. No Plugin API v1 implementation, installation path, Settings → Plugins interface, download, or update flow exists.

## P1 manifest metadata example

This example is valid P1 metadata. Its capability strings are declarations only; they do not register commands or sidebar items. `entryPoint` is validated and inventoried but never executed.

`nodus-plugin.json`:

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

P1 rejects `uiContributions` and other unknown fields. It does not define a configuration schema field. See the [P1 manifest specification](phase30b-plugin-manifest-registry.md) for the authoritative schema.

## Historical executable sketch — unsupported and non-runnable in Nodus

The following module was part of an earlier proposal. It is retained only as history: Nodus has no `activate` function contract, `api.commands.register`, `api.sidebar.register`, callback execution, Settings plugin UI, grants, or runtime. Do not use it as a working plugin example. P3's sidebar contribution is an illustrative data-only design contract, not a package API.

`index.mjs` (historical proposal only):

```js
export function activate(api) {
  const command = api.commands.register({
    id: 'greet',
    title: 'Say hello',
    description: 'Shows a greeting from this local plugin.',
    run: () => `Hello from ${api.plugin.name}.`,
  });

  const sidebar = api.sidebar.register({
    id: 'greet-link',
    label: 'Say hello',
    commandId: 'greet',
  });

  return () => {
    sidebar.dispose();
    command.dispose();
  };
}
```

The former proposal envisioned copying the folder, granting capabilities, and enabling it in Settings. None of those steps is currently possible. There is no command palette contribution, sidebar action, disable/disposal behavior, or permission grant implementation.

## Metadata authoring notes (P1 validation only)

- Use a stable reverse-DNS ID. Do not derive it from a display name.
- Treat `pluginApiVersion` as compatibility metadata. P1 rejects unsupported values; no API is loaded or run.
- Use strict semantic version strings for `version` and `minNodusVersion`.
- Declare every required capability and dependency. Unsupported capabilities are rejected.
- P1 validates manifest strings, IDs, versions, declared capabilities, dependencies, entrypoint path, and package inventory according to its documented limits. Its diagnostics describe metadata/discovery validation only.
- Package fingerprints identify package contents and detect changes; they do not establish publisher identity or trust. P1 does not store capability consent.

## Development limits

The earlier proposal listed extension points such as settings pages, editor extensions, context menus, events, database integrations, workspace APIs, filesystem APIs, and network APIs. None is implemented or available to plugin code. No public plugin API module exists. Any future support requires approved contracts and, before executable behavior, a separately approved host and security boundary. Do not infer availability from the historical sketches in this document.
