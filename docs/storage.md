# Nodus Storage (Phase 2)

Nodus stores a vault as ordinary Markdown files and versioned JSON definitions. There is no database engine, wrapper format, network call, or background process.

## Vault layout

```
<vault>/
  notes/roadmap.md                    # any *.md at any relative path
  projects/nodus/plan.md
  databases/9b2e4f10-...-2c6d9e0a4b73.json
  database-views/9b2e4f10-...-2c6d9e0a4b73/665f1175-...-657bb79fa9a1.json
```

- **Notes** are stored at their Phase 1 `Note.path`, which is workspace-relative, `/`-separated, and ends in `.md`. The path is not stored in frontmatter.
- **Database definitions** are stored at `databases/<database-id>.json`, one definition per file. The file name must equal the definition's `id`.
- **Saved database views** are separate versioned files at `database-views/<database-id>/<view-id>.json`. Removing a database does not cascade-delete its saved views.
- The `databases/` tree is reserved. Notes with paths under it are rejected with `INVALID_INPUT`.
- Newly created or normally edited files are written as UTF-8 without a byte order mark. Portable imports and backup restores preserve a valid source-file BOM byte for byte; malformed UTF-8 is rejected.

### Scan rules

- Only `*.md` files are notes. JSON files outside `databases/` and `database-views/` are ignored.
- Hidden files and directories (any segment starting with `.`) are not scanned. This excludes `.git`, `.obsidian`, and similar tooling directories. A note placed in a hidden directory is invisible to Nodus.
- Symbolic links and junctions are never followed. `checkHealth` reports them as `UNSAFE_PATH`.
- Leftover `.nodus-tmp-*` files are reported by `checkHealth` as `INCOMPLETE_WRITE`. They are never read as notes.
- Scans are on demand and read every note. There is no index or cache in Phase 2.

## Contracts

`src/storage/contracts.ts` defines note, database-definition, and saved-view stores plus one vault contract. None of them reference a filesystem, browser, network, or UI type.

```ts
interface NoteStore {
  listNotes(): Promise<NoteSummary[]>;
  readNote(id: string): Promise<Note>;
  readNoteAtPath(path: string): Promise<Note>;
  createNote(note: Note): Promise<void>;
  replaceNote(note: Note, options?: ConditionalWriteOptions): Promise<void>;
  moveNote(id: string, toPath: string, options?: ConditionalWriteOptions): Promise<Note>;
  deleteNote(id: string, options?: ConditionalWriteOptions): Promise<void>;
}

interface ConditionalWriteOptions {
  // SHA-256 of the raw file bytes, as lowercase hex.
  expectedHash?: string;
}

interface DatabaseStore {
  listDatabases(): Promise<DatabaseSummary[]>;
  readDatabase(id: string): Promise<DatabaseDefinition>;
  createDatabase(database: DatabaseDefinition): Promise<void>;
  replaceDatabase(database: DatabaseDefinition): Promise<void>;
  deleteDatabase(id: string): Promise<void>;
}

interface VaultStorage extends NoteStore, DatabaseStore {
  readonly root: string;
  snapshot(): Promise<VaultEntry[]>;
  checkHealth(): Promise<StorageHealth>;
  applyImport(plan: ImportPlan, options?: ImportOptions): Promise<ImportReport>;
}
```

The only implementation is `FileSystemVault`, opened with `FileSystemVault.open(root)`. It creates the directory if needed and resolves it to a real path. Export, import, and backup are free functions that accept the contract or the adapter.

### Identity and paths

- A note is identified by `id`, never by title or path. `moveNote` changes the path and keeps the ID and the exact bytes.
- Duplicate note IDs are a vault-level error: `readNote`, `listNotes`, `createNote`, `snapshot`, and imports fail with `DUPLICATE_ID`; `checkHealth` reports every affected path.
- `createNote` also fails with `DUPLICATE_ID` if the ID exists anywhere in the vault, and with `CONFLICT` if the path exists.
- Portability: paths that differ only by case or Unicode normalization are treated as collisions (`CONFLICT`), even on a case-sensitive filesystem.
- Path traversal, absolute paths, backslashes, colons, control characters, reserved device names, and over-long paths are rejected with `UNSAFE_PATH`, using the Phase 1 rules plus a real-path containment check that catches directory links escaping the vault.

## Errors

All storage failures are `StorageError`, which is separate from the Phase 1 `NodusError`. A Phase 1 validation error is preserved as `cause`.

| Code | Meaning |
|---|---|
| `NOT_FOUND` | No note, database, or import source exists. |
| `CONFLICT` | A path or ID would be overwritten, or paths collide by case/normalization. |
| `DUPLICATE_ID` | The same note ID appears twice, on disk or in an import. |
| `UNSAFE_PATH` | A path escapes the vault, is a symbolic link, or fails the Phase 1 path rules. |
| `INVALID_INPUT` | Caller-supplied data or options are invalid. |
| `INVALID_CONTENT` | On-disk content is malformed or does not match the approved format. |
| `UNSUPPORTED_VERSION` | A note, database, saved-view, or backup version is newer than this build. |
| `CORRUPT_BACKUP` | The manifest is missing/invalid, a file is missing, a hash mismatches, or a document is inconsistent. |
| `PARTIAL_WRITE` | A multi-file operation stopped after changing paths. `details.paths` lists completed paths and the path where it stopped. |
| `STALE_WRITE` | A conditional write (`expectedHash`) found different bytes on disk. `details.currentHash` carries the current SHA-256. No write occurred. |
| `STORAGE_FAILURE` | An I/O operation failed. |

## Safe writes

`createNote`, `replaceNote`, `moveNote`, database writes, export, and backup use the same atomic file write:

1. Write to `.nodus-tmp-<uuid>` in the target directory.
2. Flush the file handle (`fsync`).
3. Rename the temporary file over the target.
4. On POSIX, best-effort `fsync` of the directory. Skipped on Windows.

Guarantees:

- A reader never observes a half-written file at the target path.
- On a caught write failure, Nodus attempts to remove its temporary file. Cleanup can fail; abnormal termination can leave a `.nodus-tmp-*` sibling for manual inspection.
- No note content is deleted unless the operation explicitly deletes or replaces it.

Not guaranteed:

- Atomicity across several files. There is no vault-wide transaction.
- Durability against power loss beyond what the OS/filesystem guarantees.
- Protection from external processes that do not use Nodus's vault lock.

### Concurrency

Phase 1 has no revision field, and this phase does **not** invent one: no new frontmatter, no `nodus.version` bump. Instead, the revision token is the **SHA-256 of the raw file bytes**.

- Without `expectedHash`, `replaceNote` remains last-write-wins, and existing callers and sync code behave exactly as before.
- With `expectedHash`, the vault re-hashes the file immediately before the write, while holding a shared per-real-root mutation lock within the process and an exclusive cross-process lock for Nodus writers. A mismatch throws `STALE_WRITE` with `details.currentHash`, and no write occurs. `moveNote` and `deleteNote` accept the same option and check the source file.
- `FileSystemVault.readNoteWithHash(id)` returns the note, its text, and the hash computed from the same bytes that were parsed, in one read. The local UI passes that hash back as `expectedHash`, replacing its old separate read-compare-write.
- Two Nodus server processes using the same vault cannot interleave mutations: one holds `.nodus-vault-write.lock`; another receives `CONFLICT` and may retry after the lock is released. Creates, saves, moves, deletes, imports, restores, and vault snapshots used for backup/export share this lock.
- The root-level `.nodus-vault-write.lock` name is reserved for Nodus. Exclusive creation (`wx+`, mode `0600`, subject to OS permissions) arbitrates cooperating writers. The file contains version, PID, hostname, acquisition time, and a random ownership token. The owner flushes this metadata before starting the vault operation. It retains the open handle through release, checks the exact owner bytes and the path's device/inode identity, rejects symlinks or replacements, then unlinks and closes the handle. A process-local queue also serializes operations on the canonical real root.
- Existing locks always produce `CONFLICT`, including empty, malformed, old, and apparently abandoned locks. Age, PID, hostname, and token are diagnostic evidence; none authorizes automatic reclamation. Slow or paused owners retain their lock. Ordinary reads and `checkHealth()` remain available, but mutations and snapshots used by backup/export require the lock.

**Residual race window (not eliminated).** POSIX and Windows provide no atomic compare-and-swap on a path: no API accepts "rename only if the file still hashes to X". An external editor or process that does not honor `.nodus-vault-write.lock` can still change a file between our final hash and `rename`. This lock coordinates Nodus processes on a local filesystem; it does not coordinate other programs, other machines, or network/synchronized filesystem clients. The hash check narrows but does not eliminate the external-writer race.

### Lock recovery

Nodus does not steal locks, check PID liveness to reclaim them, or automatically recover after a crash. PID reuse, host identity, process suspension, and filesystem behavior make those checks insufficient. The protocol depends on every cooperating process leaving another owner's lock untouched. Node provides no portable atomic compare-and-unlink: ownership checks detect an observed replacement but cannot prevent a non-cooperating writer replacing the path between the final check and unlink. Manual recovery must prevent all writers from running or restarting throughout the procedure.

| Failure | Behavior |
|---|---|
| Exclusive creation fails because the lock exists | `CONFLICT`; no vault operation starts and the existing path is untouched. |
| Creation fails with a permission or filesystem error | `STORAGE_FAILURE`; no vault operation starts. |
| Owner metadata write or flush fails | `STORAGE_FAILURE`; no vault operation starts. The handle is closed if possible, and Nodus deliberately does not unlink the path because ownership may be unverifiable. An incomplete lock can remain. |
| Operation fails and release succeeds | The original operation error is returned. Normal lock release does not roll back any completed writes. |
| Ownership bytes, file identity, or file type changes | Release fails; Nodus leaves the observed path in place and reports failure. This detects interference; it cannot undo interference that already occurred during the operation. |
| Release or handle close fails after an operation | Failure is returned even if data was written. The message says the operation may have completed. The lock may remain, or may already be gone if unlink succeeded before close failed. Inspect before retrying. |
| Operation and release both fail | Both causes are retained. An original `PARTIAL_WRITE` stays `PARTIAL_WRITE`; affected paths, IDs, and other structured diagnostics survive, with the lock path and cleanup diagnostic added. |
| Process is killed or crashes while holding the lock | Normal cleanup does not run. The lock and temporary siblings can remain; subsequent Nodus writers and snapshots fail closed. No automatic rollback or restart recovery occurs. |

Conditional manual recovery:

1. Record the canonical vault root, error, and reported affected paths. Stop every Nodus server, preview/dev process, script, and background task using that root; disable automatic restart. Confirm the owning process has exited using the terminal or process supervisor that launched it, and account for every other potential writer. Metadata age or a missing/reused PID alone is insufficient. If any writer or host remains unaccounted for, leave the lock untouched.
2. While writers remain stopped, inspect the exact `.nodus-vault-write.lock` path. Confirm it is a regular file under the intended root. Unexpected links, directories, changed ownership, or changing contents require investigation rather than deletion. Keep a copy of the lock metadata. An empty or malformed file can result from failed initialization; it does not prove abandonment.
3. Copy the entire stopped vault, including hidden lock and temporary files, to a separate recovery directory outside the vault. This is a filesystem preservation copy, not a manifest-validated Nodus backup. The normal backup API cannot take its snapshot while the lock remains.
4. Inspect affected note/database paths, duplicate IDs from interrupted moves, and `.nodus-tmp-*` siblings against the preservation copy. Caught errors report affected paths; abrupt termination has no durable list of completed changes. A target can contain its old or new complete contents; multi-file operations may have applied only some changes. Preserve temporary files until their contents have been compared. Power-loss durability remains dependent on the OS/filesystem.
5. Only after confirming abandonment and keeping every writer stopped, remove the exact, unchanged regular lock file from that vault. Do not remove other paths, use wildcard cleanup, or race a server restart. If its identity or contents change during inspection, stop and investigate. There is no safe live lock-recovery API.
6. Start one Nodus instance. Inspect storage health (`checkHealth()` or `/api/status`) and repair reported content/duplicate-ID problems using the preservation copy. Reopen affected notes and verify their contents before further edits. Do not blindly replay a failed import, restore, or save; validate and preview any new restore/import plan against the current state.

Verified on local macOS: real subprocess contention, SIGKILL at the atomic writer's pre-rename flush barrier, preservation of the original note and leftover temporary file, two new processes rejecting the abandoned lock, and explicit recovery after all test children have exited. Deterministic fault injection covers metadata initialization, acquisition permissions, ownership changes, malformed metadata, unlink/close failures, and preservation of partial-write diagnostics. Windows, Linux, network filesystems, synchronized folders, machine power loss, and hostile external lock-path replacement during the final check/unlink window remain unverified or outside the coordination guarantee.

Import and restore never overwrite by default. They abort with `CONFLICT` before writing unless `{ overwrite: true }` is passed.

### Deletion and moves

- `deleteNote` and `deleteDatabase` remove the file permanently. There is no trash directory in Phase 2.
- `moveNote` writes the note at the new path first, then removes the old file. If removal fails, it throws `PARTIAL_WRITE` and leaves both files; `checkHealth` then reports a duplicate ID.
- Nodes are not rewritten. Phase 1 title links can break on a rename; ID-pinned links survive.

### Folder management

- Folders are ordinary directories in the vault. `listFolders` scans the filesystem, includes empty visible folders, skips hidden paths and Nodus-owned `databases/` and `database-views/` directories, and stores no parallel folder tree.
- `notes/` is the default note-creation directory and is protected as a namespace; it is not itself shown as a folder. New notes can also be created in any existing visible folder. Folder operations reject paths that would collapse into the same sidebar path as a folder under `notes/`.
- Create, move, and delete operations use the vault root lock. Folder moves require an existing destination parent and a vacant destination and use a same-vault directory rename. Note contents and attached files move with the directory. Plain Markdown files are first written with explicit Nodus frontmatter so their path-derived IDs remain stable across an application-managed folder move; the body and wiki-link text stay unchanged. If preparation or the rename fails, converted files are rolled back where possible; a rollback failure reports the affected files.
- Folder deletion is permanent and requires a fresh inventory token. The folder is atomically renamed to a hidden `.nodus-tmp-delete-*` sibling before recursive removal, so a failed cleanup leaves remaining files recoverable at the exact path returned by the error and visible to storage health as an interrupted write. Stop vault writers, copy the vault, then manually recover that reported directory before retrying; Nodus never silently moves it to a trash location.
- Wiki links are resolved from stable IDs, titles, and aliases, not filesystem paths. Folder moves therefore do not rewrite Markdown links. Database relation IDs and note frontmatter remain intact when a valid note is moved.

## Vault switching allow-list

`POST /api/vault/open` only accepts directories inside an allow-list of roots:

- `NODUS_VAULT_ROOTS` — a list of root directories separated by the platform path delimiter (`:` on macOS/Linux, `;` on Windows).
- When unset or empty, the only root is the **parent directory of the current vault**. The user's home directory is **not** allowed by default; add it explicitly if wanted.
- The target and every root are resolved with `realpath` before the containment check. A symlink that points outside the roots is rejected (symlink escapes), while a symlink that stays inside is accepted.
- Rejections return HTTP 403 with error code `VAULT_NOT_ALLOWED` and a message naming `NODUS_VAULT_ROOTS`; the Settings UI shows it inline.

This restricts which folders a request (or a local process that can reach the localhost API with an allowed origin) can point the server at. It does not replace OS permissions.

## Health checks

`checkHealth()` scans without throwing for content problems. It returns valid summaries plus issues:

| Issue code | Cause |
|---|---|
| `INVALID_CONTENT` | A note or database cannot be parsed, or a database filename does not match its ID. |
| `UNSUPPORTED_VERSION` | A document declares a newer format version. |
| `DUPLICATE_ID` | The same note ID is present at more than one path. |
| `UNSAFE_PATH` | A symbolic link or junction was skipped, or a file is in a reserved Nodus metadata tree incorrectly. |
| `INCOMPLETE_WRITE` | A `.nodus-tmp-*` file exists; it may belong to an active or interrupted write. Stop writers and preserve and inspect it before cleanup. |

Normal operations are strict: `listNotes`, `snapshot`, export, and backup throw `INVALID_CONTENT` or `UNSUPPORTED_VERSION` rather than silently skipping a bad file. Use `checkHealth` first when diagnosing a vault.

## Export and import

Export is a plain directory, not a proprietary archive:

```
<export>/notes/roadmap.md
<export>/databases/<id>.json
<export>/database-views/<database-id>/<view-id>.json
```

- `exportVault(vault, target)` requires an empty target outside the vault, writes every valid note, definition, and saved view byte for byte, and reports counts. A partial failure can leave a valid subset that import accepts: a plain export has no completeness manifest. Confirm that export succeeded and check its counts; use a verified backup when interrupted-copy detection is required.
- The export is itself a valid vault, so it can be opened directly by `FileSystemVault.open`.

Import is validated in two separable steps:

1. `planImport(sourceDir)` reads and validates the whole directory with the note, database, and saved-view parsers. It rejects malformed files, unsupported versions, duplicate IDs, reserved path/ID mismatches, symbolic links, and paths that collide by case or normalization. It writes nothing.
2. `vault.applyImport(plan, options)` compares the plan with the target. Without `{ overwrite: true }`, any existing ID or path aborts with `CONFLICT` before a single write. With it, matching notes, databases, and views are replaced, old note paths are removed after new files are written, and unrelated data is left alone.

Behavior and limits:

- Imported files keep their original bytes, so unknown frontmatter keys and non-canonical formatting survive.
- Non-Nodus files (for example `README.txt`) are never copied, modified, or deleted.
- If an import changes one or more paths before a later write or deletion fails, it returns `PARTIAL_WRITE`. `details.paths` lists successfully written or deleted paths and the path where the failing operation stopped. No changes are rolled back. A failure before any path changes returns its original error.
- **Manual recovery:** stop edits to the affected vault, inspect every reported path and check for duplicate note IDs, then create a backup of the current vault before repairing files. Use storage health checks after repair. Validate and preview a new import before applying it. Do not blindly retry: files may have changed since the failed attempt. There is no automatic crash recovery or guaranteed retry.
- Import is one-way copying. It is not synchronization, does not track history, and does not merge divergent content.
- With `overwrite: true`, an exact-path note replacement is allowed only when note IDs match. Same-ID relocation can write a new path and remove the old path after all incoming files are written. A different ID at the same path, or any case-insensitive/NFC path collision, remains blocked. Database definitions can be replaced by matching ID.

## Backup and recovery

`createBackup(vault, targetDir)` writes a **directory-based** backup: the same `notes/` + `databases/` layout as the vault, plus a `nodus-backup.json` manifest written **last**, atomically (hash abbreviated here):

```json
{
  "format": "nodus-backup",
  "version": 2,
  "createdAt": "2026-10-27T08:00:00.000Z",
  "app": { "name": "nodus", "version": "0.1.0" },
  "formats": { "note": 1, "database": 1, "databaseView": 1, "backup": 2 },
  "counts": { "notes": 12, "databases": 3, "databaseViews": 4 },
  "files": [
    {
      "kind": "note",
      "id": "6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c",
      "path": "notes/roadmap.md",
      "sha256": "...",
      "bytes": 1483
    }
  ],
  "digest": "..."
}
```

- Files are copied byte for byte with the same atomic write used for notes. A missing manifest means an interrupted or incomplete backup.
- The target must be **empty** and outside the vault. A non-empty target fails with `CONFLICT` and is left untouched; a nonexistent target is created.
- `format` is always `nodus-backup`; current manifests use version `2` to include saved views. Version-1 manifests remain readable and contain only notes and database definitions.

### Manifest metadata and digest

- Each v2 `files` entry carries `kind` (`note` | `database` | `database-view`), the document `id`, the vault-relative `path`, the lowercase hex SHA-256 of the UTF-8 content, and `bytes` (UTF-8 byte length).
- V2 includes `formats` (note/database/database-view/backup versions), `counts` (notes/databases/databaseViews), and a canonical digest. V1 metadata remains optional under its original rules.
- `digest` is the SHA-256 of the manifest serialized canonically: fixed key order (`format`, `version`, `createdAt`, then `app`/`formats`/`counts` when present, then `files` with fixed entry keys), `JSON.stringify` without whitespace, encoded UTF-8. The `digest` field itself is excluded from its own input.
- **Backward compatibility:** valid v1 manifests without `app`, `formats`, `counts`, `bytes`, or `digest` still validate. V1 cannot represent saved views. V2 is explicitly unsupported by older Nodus builds, which reject unknown backup versions rather than dropping saved views. V2 rejects unknown fields and requires byte lengths and digest.
- The hashes and digest are **integrity checks only**: they detect accidental or unauthorized byte changes. They do **not** authenticate the backup or prove who created it — anyone able to edit the backup can recompute them.

### Creating and validating backups

Exposed through the local API (localhost only, origin-checked) and driven by Settings → Backup & restore (typed paths; Nodus has no file picker for backup folders):

- `POST /api/backup` with `{ targetDir }` → 201 `{ targetDir, notes, databases, databaseViews }`.
- `POST /api/backup/validate` with `{ dir }` → 200 `{ manifest, counts }`; failures are 422 `CORRUPT_BACKUP` (with an `issues` list shown in the UI), 422 `UNSUPPORTED_VERSION`, or 404 for a missing directory.

Destination and source rules (`assertBackupTargetAllowed`), in order:

1. Must be absolute — otherwise 400 `INVALID_INPUT`.
2. Must be outside the active vault (realpath containment on the nearest existing ancestor) — otherwise 400.
3. Must be inside a `NODUS_BACKUP_ROOTS` root — otherwise 403 `BACKUP_TARGET_NOT_ALLOWED`.
4. An existing destination must be a directory — otherwise 400; a path that traverses a file is 400; a **nonexistent** destination is allowed and created by the storage layer.

`NODUS_BACKUP_ROOTS` uses the platform path delimiter (`:` on macOS/Linux, `;` on Windows), like `NODUS_VAULT_ROOTS`. When unset or empty the only allowed root is the **parent directory of the active vault**. Roots are `realpath`-resolved; a root that does not exist is skipped. The same rules gate backup **sources** (validate, preview, restore).

`validateBackup(dir)` reads the manifest (`nodus-backup.json` must exist or the backup is treated as incomplete/`CORRUPT_BACKUP`), verifies version-specific fields, every listed file exists, is a regular non-symlink file, hashes match, each note/schema/view parses, IDs match the manifest, reserved paths match their IDs, and IDs/paths are unique. Newer document or manifest versions produce `UNSUPPORTED_VERSION`; other problems produce `CORRUPT_BACKUP` with an issue list. Validation never writes.

### Restore behavior

- `POST /api/restore/preview` with `{ dir }` returns a **read-only** `RestorePreview`: manifest, counts of parseable documents (from parsing, not the manifest), and ID/path conflicts, mirroring the checks `applyImport` runs. Preview writes nothing on either side, but it **cannot guarantee** a later restore will be conflict-free: the vault may change in between.
- `POST /api/restore` with `{ dir, overwrite? }` always targets the **active vault** — a client-supplied `destination` field is rejected with 400, and the source passes the same allow-list checks. Restore validates the entire backup first, then applies it through the normal import path; the backup directory is only ever read.
- **Merge semantics:** by default (`overwrite: false`) any existing ID or path aborts with `CONFLICT` (409) *before a single write*. With `overwrite: true`, matching-ID notes at the same exact path and matching-ID databases can be replaced; a matching-ID note can move paths. Different-ID exact-path collisions and case-insensitive/NFC path collisions remain blocked. Unrelated vault content is untouched. Restore **merges into the active vault — it never replaces or clears the vault as a whole**, and never touches files outside it. The Settings UI requires explicit confirmation showing the exact source on every restore; overwrite remains off until user enables it.
- **Not globally atomic:** each file write is atomic, but merge restore spans files. An I/O failure after changes returns `PARTIAL_WRITE` (500) with `details.paths` listing completed changes and the path of the failed operation. The Settings UI tells the user to inspect the affected vault. The backup itself remains unchanged.
- Not implemented and not claimed: transactional restore, rollback, encryption, automatic/scheduled backups, durable recovery journal, or automatic crash recovery.

### Backup path checks (security)

- The allow-list and active-vault exclusion above are enforced on the localhost API before any read or write; `realpath` (or the nearest existing ancestor for not-yet-created targets) is used for containment, so a symlinked parent that resolves into the vault or outside the roots is rejected.
- **Residual race:** containment is checked, then the path is used — POSIX/Windows offer no atomic "create only inside X" primitive, so a symlink swapped into place between check and use can still race (same class as the hash-then-rename window described under Concurrency). The checks restrict what the local API accepts; they do not replace OS permissions.

What a backup protects against:

- Accidental edit or deletion of vault files, when a recent backup exists elsewhere.
- Silent corruption that changes bytes, because hashes are checked.

What it does **not** protect against:

- Disk failure, filesystem corruption, ransomware, or loss of the backup itself.
- Deletion or modification of both the vault and the backup.
- Malicious tampering that recomputes the hashes. Hashes detect corruption, not forgery; they authenticate nothing.
- Concurrent writers while the backup is created.
- Non-Nodus files in the vault (they are not backed up).
- Attachments, settings, or UI state (not implemented in Phase 1 or 2).

Store backups on a different device or service for real disaster recovery. Phase 2 performs no upload.

## Privacy and network boundary

- The adapter reads and writes local files only.
- No telemetry, analytics, AI calls, accounts, credentials, or third-party transfers.
- No note content, metadata, or backup leaves the machine.

## Future cross-device access

Phase 2 storage is local only, and the experimental relay/sync implementation (`src/relay/`, `src/sync/`) is not wired into the application, any script, or the UI. Nothing here makes Nodus reachable from another device. A later, separately approved phase would need:

1. **Transport:** HTTPS with modern TLS, or a private overlay network.
2. **Authentication:** per-device credentials or passkeys, session expiry, and revocation.
3. **Authorization:** scoped access to one personal vault, not multi-tenant accounts.
4. **Sync:** change detection, revisions or operation logs, resumable transfer, and idempotent retries.
5. **Conflict handling:** an approved revision model, then policy for concurrent edits. Phase 1 has none.
6. **Recovery:** server-side snapshots, restore, and integrity checks, using the backup contract here.
7. **Encryption:** at rest and in transit, with keys stored outside note files and backups.

Do not build a cloud adapter or claim anywhere-access until those exist.

## Known limitations

- One malformed note blocks `listNotes`, `snapshot`, export, and backup until fixed or moved out of the vault. `checkHealth` identifies it.
- Every ID lookup scans and parses all notes. This is deliberate simplicity, not a performance design.
- Hidden directories are invisible, including notes a user might place there.
- Symbolic links are unsupported.
- Paths that collide by case are rejected even on case-sensitive filesystems, to keep vaults portable.
- Optional `expectedHash` narrows, but does not eliminate, the check-then-write race: there is no OS-level compare-and-swap or locking enforced against non-cooperating writers, no trash, and no distributed transactions. The lock file coordinates cooperating Nodus processes only.
- Database definitions contain property schemas only. Saved Table/Kanban/Calendar configuration lives in independently versioned view files, and rows are derived from Markdown. Relations remain deferred.
- The `databases/` and `database-views/` directories are reserved namespaces owned by Nodus.
