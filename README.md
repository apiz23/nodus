# Nodus

Nodus is a local-first, Markdown-native knowledge workspace that combines linked notes with structured databases.

**Plain Markdown files. Portable database definitions and saved views. Local-first sync.**

Your notes are ordinary Markdown files. YAML frontmatter is optional; when present, Nodus preserves its metadata. Notes work without an account or network connection and remain usable outside Nodus.

## Status

**Markdown storage and workspace features implemented, including Phase 5 database relations and rollups.** The package provides:

- Phase 1 domain, format, and migration contracts.
- A filesystem vault adapter: create, read, update, move, and delete notes and database definitions.
- Vault-level duplicate ID detection, path containment, and per-file atomic writes.
- Portable export/import that validates before writing and refuses silent overwrites.
- Verified backups with SHA-256 manifests, validation, and explicit-overwrite restoration.
- A local React UI (`ui/`) with a live Markdown editor, task checkboxes, wiki links, page icons, title/alias/path/content search, backlinks with linked mentions, a command palette (`Ctrl/Cmd+K`), and a limited database browser/schema editor for note rows and typed properties.
- A relay server, sync client, and conflict handling (`src/relay/`, `src/sync/`) — **experimental**. They are not wired to any npm script, CLI bin, or the UI.

The database browser supports saved Table, Kanban, and Calendar views with typed sorting, AND filters, and property visibility. View configurations are portable JSON; card moves and dates use revision-checked Markdown property writes. Relations (single/multiple), derived reverse fields, and rollups are supported across these views. Also absent: database/property/option removal, graph view, attachments, and a web/mobile client.

## Storage

A vault is a directory of ordinary files:

```
<vault>/notes/roadmap.md
<vault>/databases/<database-id>.json
<vault>/database-views/<database-id>/<view-id>.json
```

Notes use the Phase 1 Markdown format at their workspace-relative paths. Database definitions and saved views are separate versioned JSON files. Hidden directories are not scanned, symbolic links are not followed, and the `databases/` and `database-views/` trees are reserved.

Writes go through a temporary sibling and an atomic rename. Imports and restores validate the entire source before changing anything, and never overwrite existing data unless `{ overwrite: true }` is passed explicitly. Backups are byte-for-byte copies plus a manifest written last, so an incomplete backup is detectable.

See [Storage](docs/storage.md) for the contracts, layout, error codes, guarantees, limitations, and future synchronization requirements.

## Scope and deferrals

These remain **not implemented** and need a new approval before work starts:

| Item | Status | Reason |
|---|---|---|
| Persisted vault entity/metadata | Deferred | The filesystem vault is a directory plus adapter; there is no vault metadata file. |
| Folder entity | Deferred | Folders are implied by note paths. No explicit folder format is approved. |
| Attachment metadata | Deferred | Requires a blob storage decision. |
| Link references (stored records) | Deferred | Search and discovery share an in-memory, rebuildable Markdown snapshot; link records are not persisted. |
| Saved database views | Implemented | Portable Table, Kanban, and Calendar views; explicit save, rename, duplicate, switch, and conditional delete. |
| Relations and rollups | Implemented | Stable note IDs, single/multiple forward fields, derived reverse fields and typed rollups; see [relations](docs/database-relations.md). |
| Cross-device sync | **Experimental** | A relay and sync client exist (`src/relay/`, `src/sync/`) but are not wired to any script, bin, or the UI. No multi-device setup is supported. |

Also out of scope: database/property/option removal, formulas, automations, graph views, accounts, AI, telemetry, and third-party data transfer.

## Consistency boundaries

- Nodus-format note identity is the UUID v4 in frontmatter, independent of title and path. Plain Markdown uses a stable path-derived ID until it is moved through Nodus, which adds metadata to preserve identity.
- Duplicate note IDs are detected by `FileSystemVault` at the vault boundary (`DUPLICATE_ID`), not by `parseNote`.
- Phase 1 has no revision field, and Phase 2 does not invent one: no new frontmatter and no `nodus.version` bump. The revision token is the SHA-256 of the raw file bytes. `replaceNote`, `moveNote`, and `deleteNote` take an optional `expectedHash`; when it no longer matches the file, they throw `STALE_WRITE` (with the current hash in `details.currentHash`) and write nothing. Without the option, behavior is unchanged (last-write-wins). A per-root lock serializes Nodus mutations within and across processes, and the vault re-hashes immediately before the rename. It does not protect against external editors or other non-cooperating processes; see [docs/storage.md](docs/storage.md#concurrency).
- Imports and restores fail with `CONFLICT` before writing unless overwrite is explicit.
- File-level writes are atomic; multi-file operations are not transactions and report `PARTIAL_WRITE` on failure.

## Compatibility policy

- Every persistent format has an integer version field. Note files use `nodus.version`. Database and saved-view files use `version`. Backups use the manifest `version`.
- A reader accepts only the versions it implements.
- A higher version of a known format is rejected with `UNSUPPORTED_VERSION`; nothing is parsed further or rewritten. An unknown version inside an opaque top-level extension namespace is preserved and ignored as described below.
- Within version 1, changes are limited to additions that older readers can reject explicitly. Removing or renaming a field requires a new version.
- Compatibility exception: opaque, independently versioned namespaces such as top-level `nodus_data` may be added without changing `nodus.version`. Older Nodus readers may ignore these namespaces but must preserve their YAML values when serializing a note. The namespace payload stays within the existing core-YAML subset; older readers do not validate or display its semantics. This does not apply to unknown keys under `nodus`, database definition files, or arbitrary third-party frontmatter editors.
- Unknown keys are never silently dropped: top-level note keys are preserved, and unknown keys under `nodus` or in database files are rejected.
- Migrations, when they exist, follow the contract in [note-format.md](docs/note-format.md#migration-contract).

## Documentation

- [Note format](docs/note-format.md)
- [Wiki-link rules](docs/wiki-links.md)
- [Global Search and index refresh](docs/global-search.md)
- [Database definition format](docs/database-format.md)
- [Database relations and rollups](docs/database-relations.md)
- [Saved database view format](docs/database-views.md)
- [Storage, export/import, and backups](docs/storage.md)
- [Editor behavior](docs/editor.md)
- [Page icons](docs/page-icons.md)

## Development

Requires Node.js **24.0.0 or later**, matching the verified built-in SQLite runtime. Node 22 is unsupported by the declared engine and is not a supported configuration. This repository uses **pnpm 11.9.0**.

```sh
pnpm install
pnpm test
pnpm test:browser
pnpm typecheck
pnpm build
```

Storage tests create isolated temporary directories and never touch a real vault. Relay and UI API tests use loopback HTTP only; there is no external network access. The optional real-browser workflow and its Chromium requirement are documented in [docs/browser-smoke.md](docs/browser-smoke.md).

## Local UI

The local-only React UI lives in `ui/`. It uses Tailwind CSS v4, shadcn/ui (`radix-nova`), Lucide icons, and Geist. It reads and writes a chosen vault through a small localhost API that reuses `FileSystemVault`; the browser never imports Node, SQLite, or relay code.

```sh
# PowerShell
$env:NODUS_VAULT = 'C:\path\to\your\vault'
pnpm dev
```

```sh
# macOS / Linux
NODUS_VAULT=/path/to/your/vault pnpm dev
```

Open `http://127.0.0.1:5173` for the public landing page, or `http://127.0.0.1:5173/app` for the local workspace. If `NODUS_VAULT` is omitted, the server uses `./vault` and creates it on first use.

Production-style local preview:

```sh
pnpm build
pnpm preview
```

Open `http://127.0.0.1:4173` for the landing page, or `http://127.0.0.1:4173/app` for the workspace.

The UI supports note listing, create, open, title/body editing, save, rename path, delete with confirmation, title/alias/path/content search with deterministic ranking, backlinks and ambiguous linked mentions, command palette (`Ctrl/Cmd+K`), and a limited database browser/schema editor. Users can create schemas, add typed properties, rename schemas/properties/options, and add select options while retaining stable IDs. Existing property types and options cannot be removed from the UI. The browser discovers notes with explicit membership, displays and edits supported typed properties, requires confirmation when adding a note to a database, and provides sorting, typed filters, and column visibility saved through named Table, Kanban, and Calendar views. Relations support record selection/navigation and derived reverse fields. Rollups support count, conditional count, numeric sum, completed-task count, and completion percentage. Graph UI is not implemented. The app preserves frontmatter fields and stable UUIDs; note and schema saves check raw file hashes and refuse to overwrite an external edit.

The active vault can also be changed from **Settings**: type an absolute folder path and choose **Use folder**, or use **Browse…** for the host OS picker. **This endpoint only accepts directories inside an allow-list of roots.** Roots come from `NODUS_VAULT_ROOTS` (a list separated by `:` on macOS/Linux, `;` on Windows) and default to the parent directory of the current vault; the user's home directory is not allowed unless listed. Targets and roots are resolved with `realpath` before the containment check, so a symlink pointing outside the roots is rejected. Failures return HTTP 403 with error code `VAULT_NOT_ALLOWED` and are shown inline in Settings. The request origin must still match the UI (`NODUS_ALLOWED_ORIGINS` can override the allowed origins), and the API binds to `127.0.0.1` only. The change lasts for the current server session; set `NODUS_VAULT` to make it permanent.

**Not implemented in the UI:** sync connection (the relay/sync code exists but is not wired in), filesystem watcher, database/property/option removal, graph view, and any web/mobile client. Sync status shows **Not connected / Phase 4**.

The API binds to `127.0.0.1` only.

## Privacy

Storage is local and offline. There is no telemetry, analytics, AI call, account, credential handling, or third-party transfer. Backups are written only where the caller asks. The experimental relay code is not reachable from the UI or any npm script.

## License

Apache License 2.0. See [LICENSE](LICENSE).
