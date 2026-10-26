# Nodus

Nodus is a local-first, Markdown-native knowledge workspace that combines linked notes with structured databases.

**Plain Markdown files. Portable database definitions. Local-first sync.**

Your notes are ordinary Markdown files with YAML frontmatter. They work without an account or network connection, and remain usable outside Nodus.

## Status

**Phases 1–2 complete; Phase 3 workspace features implemented.** The package provides:

- Phase 1 domain, format, and migration contracts.
- A filesystem vault adapter: create, read, update, move, and delete notes and database definitions.
- Vault-level duplicate ID detection, path containment, and per-file atomic writes.
- Portable export/import that validates before writing and refuses silent overwrites.
- Verified backups with SHA-256 manifests, validation, and explicit-overwrite restoration.
- A local React UI (`ui/`) with a live Markdown editor, task checkboxes, wiki links, page icons, title/body search, backlinks with linked mentions, a command palette (`Ctrl/Cmd+K`), and a read-only database schema view.
- A relay server, sync client, and conflict handling (`src/relay/`, `src/sync/`) — **experimental**. They are not wired to any npm script, CLI bin, or the UI.

Still absent: database rows/views/relations, query execution, graph view, attachments, and a web/mobile client.

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
| Link references (stored records) | Deferred | Links are parsed on demand; the Phase 3A backlinks index is in-memory and rebuildable, not persisted. |
| View definitions (table, sorting, filters) | Deferred | Views are rejected, not stored. |
| Relation properties | Deferred | Target, cardinality, and delete behavior are not defined. |
| Cross-device sync | **Experimental** | A relay and sync client exist (`src/relay/`, `src/sync/`) but are not wired to any script, bin, or the UI. No multi-device setup is supported. |

Also out of scope: database rows, query execution, formulas, rollups, automations, graph views, accounts, AI, telemetry, and third-party data transfer.

## Consistency boundaries

- Note identity is the UUID v4 in frontmatter, independent of title and path. Moves preserve it.
- Duplicate note IDs are detected by `FileSystemVault` at the vault boundary (`DUPLICATE_ID`), not by `parseNote`.
- Phase 1 has no revision field, and Phase 2 does not invent one: no new frontmatter and no `nodus.version` bump. The revision token is the SHA-256 of the raw file bytes. `replaceNote`, `moveNote`, and `deleteNote` take an optional `expectedHash`; when it no longer matches the file, they throw `STALE_WRITE` (with the current hash in `details.currentHash`) and write nothing. Without the option, behavior is unchanged (last-write-wins). A per-path mutex serializes check-then-write inside one process, and the vault re-hashes immediately before the rename — but the OS offers no atomic compare-and-swap on a path, so the TOCTOU window is narrowed, not eliminated (see [docs/storage.md](docs/storage.md#concurrency)).
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
- [Editor behavior](docs/editor.md)
- [Page icons](docs/page-icons.md)

## Development

Requires Node.js **24.0.0 or later**, matching the verified built-in SQLite runtime. Node 22 is unsupported by the declared engine and is not a supported configuration. This repository uses **pnpm 11.9.0**.

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Tests create isolated temporary directories and never touch a real vault. Relay and UI API tests use loopback HTTP only; there is no external network access.

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

Open `http://127.0.0.1:5173`. If `NODUS_VAULT` is omitted, the server uses `./vault` and creates it on first use.

Production-style local preview:

```sh
pnpm build
pnpm preview
```

Open `http://127.0.0.1:4173`.

The UI supports note listing, create, open, title/body editing, save, rename path, delete with confirmation, title/body search with deterministic ranking, backlinks and ambiguous linked mentions, command palette (`Ctrl/Cmd+K`), read-only database schemas, light/dark theme, and storage health. It preserves frontmatter fields and stable UUIDs; saving checks the raw file hash and refuses to overwrite an external edit.

The active vault can also be changed from **Settings**: type an absolute folder path and choose **Use folder**, or use **Browse…** for the host OS picker. **This endpoint only accepts directories inside an allow-list of roots.** Roots come from `NODUS_VAULT_ROOTS` (a list separated by `:` on macOS/Linux, `;` on Windows) and default to the parent directory of the current vault; the user's home directory is not allowed unless listed. Targets and roots are resolved with `realpath` before the containment check, so a symlink pointing outside the roots is rejected. Failures return HTTP 403 with error code `VAULT_NOT_ALLOWED` and are shown inline in Settings. The request origin must still match the UI (`NODUS_ALLOWED_ORIGINS` can override the allowed origins), and the API binds to `127.0.0.1` only. The change lasts for the current server session; set `NODUS_VAULT` to make it permanent.

**Not implemented in the UI:** sync connection (the relay/sync code exists but is not wired in), filesystem watcher, database rows/views/relations, and any web/mobile client. Sync status shows **Not connected / Phase 4**.

The API binds to `127.0.0.1` only.

## Privacy

Storage is local and offline. There is no telemetry, analytics, AI call, account, credential handling, or third-party transfer. Backups are written only where the caller asks. The experimental relay code is not reachable from the UI or any npm script.

## License

Apache License 2.0. See [LICENSE](LICENSE).
