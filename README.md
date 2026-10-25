# Nodus

Nodus is a local-first, Markdown-native knowledge workspace that combines linked notes with structured databases.

Your notes are plain Markdown files with YAML frontmatter. They work without an account or network connection, and remain usable outside Nodus.

## Status

**Phase 2: storage adapters and recovery.** The package now provides:

- Phase 1 domain, format, and migration contracts.
- A filesystem vault adapter: create, read, update, move, and delete notes and database definitions.
- Vault-level duplicate ID detection, path containment, and per-file atomic writes.
- Portable export/import that validates before writing and refuses silent overwrites.
- Verified backups with SHA-256 manifests, validation, and explicit-overwrite restoration.

Still absent: UI, editor, search, backlinks index, graph, sync, remote access, authentication, attachments, database rows/views/relations, and query execution. Nodus is **not** accessible from other devices.

## Storage

A vault is a directory of ordinary files:

```
<vault>/notes/roadmap.md
<vault>/databases/<database-id>.json
```

Notes use the Phase 1 Markdown format at their workspace-relative paths. Database definitions are separate versioned JSON files. Hidden directories are not scanned, symbolic links are not followed, and the `databases/` tree is reserved.

Writes go through a temporary sibling and an atomic rename. Imports and restores validate the entire source before changing anything, and never overwrite existing data unless `{ overwrite: true }` is passed explicitly. Backups are byte-for-byte copies plus a manifest written last, so an incomplete backup is detectable.

See [Storage](docs/storage.md) for the contracts, layout, error codes, guarantees, limitations, and future synchronization requirements.

## Scope and deferrals

These remain **not implemented** and need a new approval before work starts:

| Item | Status | Reason |
|---|---|---|
| Persisted vault entity/metadata | Deferred | The filesystem vault is a directory plus adapter; there is no vault metadata file. |
| Folder entity | Deferred | Folders are implied by note paths. No explicit folder format is approved. |
| Attachment metadata | Deferred | Requires a blob storage decision. |
| Link references (stored records) | Deferred | Links are parsed on demand. No link index exists. |
| View definitions (table, sorting, filters) | Deferred | Views are rejected, not stored. |
| Relation properties | Deferred | Target, cardinality, and delete behavior are not defined. |
| Cross-device sync and remote access | Deferred | No authentication, transport, or synchronization design is approved. |

Also out of scope: database rows, query execution, formulas, rollups, automations, UI, editor integration, search, backlinks, graph views, accounts, AI, telemetry, and third-party data transfer.

## Consistency boundaries

- Note identity is the UUID v4 in frontmatter, independent of title and path. Moves preserve it.
- Duplicate note IDs are detected by `FileSystemVault` at the vault boundary (`DUPLICATE_ID`), not by `parseNote`.
- Phase 1 has no revision field. Phase 2 does not invent one: `replaceNote` is last-write-wins, with no stale-write detection. Adding revisions is a future, explicitly approved decision.
- Imports and restores fail with `CONFLICT` before writing unless overwrite is explicit.
- File-level writes are atomic; multi-file operations are not transactions and report `PARTIAL_WRITE` on failure.

## Compatibility policy

- Every persistent format has an integer version field. Note files use `nodus.version`. Database files use `version`. Backups use the manifest `version`.
- A reader accepts only the versions it implements.
- A higher version is rejected with `UNSUPPORTED_VERSION`. Nothing is parsed further or rewritten.
- Within version 1, changes are limited to additions that older readers can reject explicitly. Removing or renaming a field requires a new version.
- Unknown keys are never silently dropped: top-level note keys are preserved, and unknown keys under `nodus` or in database files are rejected.
- Migrations, when they exist, follow the contract in [note-format.md](docs/note-format.md#migration-contract).

## Documentation

- [Note format](docs/note-format.md)
- [Wiki-link rules](docs/wiki-links.md)
- [Database definition format](docs/database-format.md)
- [Storage, export/import, and backups](docs/storage.md)

## Development

Requires Node.js **24.0.0 or later**, matching the verified built-in SQLite runtime. Node 22.12.0 requires the `--experimental-sqlite` flag and is not supported by the declared engine. This repository uses **pnpm 11.9.0**.

```sh
pnpm install
pnpm test
pnpm typecheck
```

Tests create isolated temporary directories and never touch a real vault. Relay and UI API tests use loopback HTTP only; there is no external network access.

## Privacy

Storage is local and offline. There is no telemetry, analytics, AI call, account, credential handling, or third-party transfer. Backups are written only where the caller asks.

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Local UI (Phase 3.5)

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

Open `http://127.0.0.1:5173`. If `NODUS_VAULT` is omitted, the server uses `./vault` and creates it on first use.

Production-style local preview:

```sh
pnpm build
pnpm preview
```

Open `http://127.0.0.1:4173`.

The UI supports note listing, create, open, title/body editing, save, rename path, delete with confirmation, title/body search, command palette (`Ctrl/Cmd+K`), read-only database schemas, light/dark theme, and storage health. It preserves frontmatter fields and stable UUIDs; saving checks the raw file hash and refuses to overwrite an external edit.

The active vault can also be changed from **Settings**: type an absolute folder path and choose **Use folder**, or use **Browse…** for the host OS picker. The path field is sent only to the localhost API, which requires an absolute existing directory and checks the request origin. The change lasts for the current server session; set `NODUS_VAULT` to make it permanent.

**Not implemented:** sync client, outbox, apply ledger, conflict copies, filesystem watcher, relay endpoints, TLS, relay credentials, database rows/views/relations, and any web/mobile client. Sync shows **Not connected / Phase 4**.

The vault path is chosen at server startup. The browser cannot request arbitrary filesystem paths, and the local API rejects non-local `Origin` headers. The API binds to `127.0.0.1` only.