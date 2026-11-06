# Phase 30B — Plugin Manifest, Registry, and Validation

**Status:** Implemented as a metadata-only foundation. This document does not authorize plugin execution.

## Scope and non-execution guarantee

Phase 30B discovers local package directories, validates their manifests and inventories, checks Nodus/API compatibility and local dependency graphs, and builds an in-memory metadata registry. A registry entry is not an installation, enablement, user consent, lifecycle state, or authorization to run code. No entrypoint is imported, evaluated, spawned, or launched anywhere in this milestone.

All package files and manifests are treated as untrusted input. Discovery does not fetch packages, install dependencies, mutate the vault, persist registry state, or modify application preferences. Persistence, permissions, lifecycle and runtime belong to later Phase 30 milestones.

## Manifest v1

The manifest filename is `nodus-plugin.json`, located at the package root. The format version and plugin API version are separate integers: `formatVersion` versions the manifest shape; `pluginApiVersion` identifies the host extension contract; `version` versions the plugin; `minNodusVersion` sets the minimum compatible Nodus application release.

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

All fields shown are required. `dependencies` is an array and may be empty. V1 rejects unknown top-level fields. Configuration schemas and plugin-supplied UI metadata are not part of this manifest implementation; fields such as `configSchema` are rejected as unknown rather than being accepted without validation. Unknown fields do not grant capabilities.

### Identity and text

- Plugin IDs are lowercase ASCII reverse-DNS identifiers with at least two labels, such as `io.example.reading-tools`; maximum length is 180 characters. IDs do not derive from display names. The package directory name must equal the manifest ID.
- `name` is a trimmed nonempty string of at most 80 UTF-8 bytes; `description` at most 500 bytes; `author` at most 120 bytes. Control characters are rejected. The manifest is limited to 64 KiB.
- Plugin version and minimum Nodus version require stable `major.minor.patch` numeric versions. Leading zeroes, prerelease/build metadata, malformed values and unsafe integer components are rejected in v1.
- The current Nodus version is supplied to validation by the host. A plugin requiring a later version is incompatible. Plugin API versions are checked against an explicit host-supported list; unknown versions are rejected before any later runtime can load them.

### Entry point and capabilities

- `entryPoint` is a normalized, relative POSIX path ending in `.mjs`. Absolute paths, backslashes, control characters, empty/dot/parent segments, reserved platform path segments, non-NFC paths, and paths outside the package are rejected. Discovery verifies the named entrypoint is an inventoried regular file.
- Phase 30B recognizes only `commands.register` and `sidebar.register` as declared contribution capabilities. This is metadata support, not a grant or implementation of those APIs. Any unknown or currently unsupported capability is an error. A capability cannot be duplicated.
- Capabilities are capped at 32 entries. No workspace, database, network, or filesystem access capability is supported in this milestone.

### Dependencies and version ranges

Dependencies are local references by stable plugin ID and use `{ "id", "range", "optional" }`. They are never downloaded or resolved remotely. A dependency ID is unique within one manifest and cannot refer to itself. At most 64 dependencies are allowed.

The supported range subset is deliberately small:

- Exact stable version: `1.2.3`
- Caret range: `^1.2.3` (SemVer-compatible upper bound; `0.x` follows the SemVer zero-major rule)
- Tilde range: `~1.2.3` (same major/minor)
- Whitespace-separated comparator conjunctions: `>=1.2.0 <2.0.0`

Prerelease versions, wildcard, OR, hyphen, and unsupported syntax are rejected. Required missing, version-mismatched, duplicate, cyclic, or invalid dependencies invalidate the plugin and transitively invalidate dependents with required edges. Missing or unusable optional dependencies are warnings and omitted from the effective graph. Valid dependencies load before dependents; ties use lexical plugin ID ordering. No package installation or version negotiation occurs.

## Package layout and discovery

The caller supplies the plugin root explicitly. A missing root produces an empty discovery result. Existing roots must be directories, not symlinks. The root may contain only plugin package directories; unexpected files, links, and special entries produce diagnostics. A package contains a root `nodus-plugin.json` and any relative files needed by a future runtime.

Discovery sorts root entries and package paths deterministically. It does not follow links. Package inventory includes every visible file, including dotfiles; unsupported objects are errors and are never silently omitted. Package directory basename and manifest ID must agree. Duplicate manifest IDs across different directories invalidate all copies; enumeration order never chooses a winner.

## Limits

Limits are centralized in `src/plugins/constants.ts`:

| Limit | Value |
|---|---:|
| Manifest bytes | 64 KiB |
| Regular package files | 2,000 |
| Total package inventory entries | 4,000 |
| Total package bytes | 64 MiB |
| Individual file bytes | 16 MiB |
| Directory nesting | 16 levels |
| Dependencies | 64 |
| Capabilities | 32 |
| Plugin-root entries | 2,000 |

Sizes are checked using safe integer arithmetic before reading file content. File reads are bounded by the per-file and total budgets. All counts include the manifest. Empty directories count toward the inventory-entry limit.

## Inventory fingerprint

Each regular file is recorded as its normalized package-relative path, byte length, and SHA-256 over the exact bytes read. The list is sorted lexically by path. The package fingerprint is:

```text
SHA256(UTF8("nodus-plugin-package-v1\n" + JSON.stringify(sorted([[path, size, sha256], ...]))))
```

The JSON array order and field positions are fixed as `[path, size, sha256]`; JSON strings use the JavaScript JSON UTF-8 encoding. Modification times and permissions are intentionally excluded. Adding, removing, renaming, or changing any package file changes the fingerprint. Fingerprinting is an integrity/content-identity mechanism only; it does not establish trust, publisher identity, or safety.

Reads use no-follow file handles where supported and compare file identity and metadata before/after reading. Real paths and containment are checked in addition to normalized relative paths. These are best-effort defenses against filesystem races, not an atomic filesystem snapshot against a hostile concurrent writer. Revalidate package contents before any future execution or consent reuse.

## Diagnostics

`PluginDiagnostic` contains a stable `code`, `severity` (`error`, `warning`, `info`), safe user-facing `message`, and optional `pluginId`, `field`, and package-relative `path`. It does not include stack traces or absolute filesystem paths. Principal codes include:

- Manifest: `MANIFEST_TOO_LARGE`, `MANIFEST_JSON_INVALID`, `MANIFEST_ROOT_INVALID`, `MANIFEST_FIELD_REQUIRED`, `MANIFEST_FIELD_INVALID`, `MANIFEST_UNKNOWN_FIELD`, `MANIFEST_FORMAT_UNSUPPORTED`.
- Identity/compatibility: `PLUGIN_ID_INVALID`, `PLUGIN_VERSION_INVALID`, `NODUS_VERSION_INVALID`, `NODUS_VERSION_INCOMPATIBLE`, `PLUGIN_API_UNSUPPORTED`, `PLUGIN_DIRECTORY_ID_MISMATCH`, `PLUGIN_ID_DUPLICATE`.
- Capabilities/dependencies: `CAPABILITY_DUPLICATE`, `CAPABILITY_UNSUPPORTED`, `DEPENDENCY_INVALID`, `DEPENDENCY_DUPLICATE`, `DEPENDENCY_MISSING`, `DEPENDENCY_VERSION_MISMATCH`, `DEPENDENCY_CYCLE`.
- Filesystem/inventory: `PACKAGE_ROOT_MISSING`, `PACKAGE_ROOT_INVALID`, `PACKAGE_ROOT_UNREADABLE`, `PACKAGE_ENTRY_UNSUPPORTED`, `PACKAGE_PATH_INVALID`, `PACKAGE_SYMLINK`, `PACKAGE_SPECIAL_FILE`, `PACKAGE_FILE_LIMIT_EXCEEDED`, `PACKAGE_ENTRY_LIMIT_EXCEEDED`, `PACKAGE_FILE_TOO_LARGE`, `PACKAGE_SIZE_LIMIT_EXCEEDED`, `PACKAGE_DEPTH_LIMIT_EXCEEDED`, `PACKAGE_READ_FAILED`, `PACKAGE_CHANGED_DURING_READ`, `ENTRYPOINT_MISSING`.

Validation returns structured results; malformed user-supplied manifests do not escape as uncontrolled parser exceptions. Root-level failures are reported without leaking the absolute configured path.

## In-memory registry semantics

`createPluginRegistry` creates deterministic metadata entries with plugin ID, display name, and version when those individual values are safely parseable, package location for host use, content fingerprint when valid, parsed manifest, retained diagnostics, compatibility status, dependency status, and `discovered` or `invalid` discovery status. Invalid packages remain inspectable without being represented as valid manifests. Duplicate identities remain visible as invalid entries with diagnostics. `dependencyOrder` includes only valid candidates and places dependencies before dependents.

The registry is in-memory only. It has no enablement, grants, installation record, active state, persistence, or execution methods. Discovery and validation never imply user consent or activation.

## Security boundary and limitations

This milestone only validates local package metadata and file structure. It does not execute plugin code or create an execution sandbox. Path validation, symlink rejection, size limits, and hashing protect the discovery/inventory operation; they do not prove plugin code is trustworthy. A later runtime must independently revisit the execution model, process isolation, OS permissions, network/filesystem controls, IPC, resource limits, consent, and revalidation. No permission is granted by Phase 30B.

## Verification evidence

Implementation and tests are in `src/plugins/` and `test/plugins/`. Focused tests cover manifest structure and compatibility, package discovery/inventory/fingerprints, dependency graph validation/order, and in-memory registry semantics. The explicit non-execution test writes a marker only if a discovered `.mjs` entrypoint is evaluated and verifies that the marker is absent.
