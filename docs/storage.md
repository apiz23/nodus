# Nodus Storage (Phase 2)

Nodus stores a vault as ordinary Markdown files and versioned JSON definitions. There is no database engine, wrapper format, network call, or background process.

## Vault layout

```
<vault>/
  notes/roadmap.md                    # any *.md at any relative path
  projects/nodus/plan.md
  databases/9b2e4f10-...-2c6d9e0a4b73.json
```

- **Notes** are stored at their Phase 1 `Note.path`, which is workspace-relative, `/`-separated, and ends in `.md`. The path is not stored in frontmatter.
- **Database definitions** are stored at `databases/<database-id>.json`, one definition per file. The file name must equal the definition's `id`.
- The `databases/` tree is reserved. Notes with paths under it are rejected with `INVALID_INPUT`.
- Files are written as UTF-8 without a byte order mark.

### Scan rules

- Only `*.md` files are notes. JSON files outside `databases/` are ignored.
- Hidden files and directories (any segment starting with `.`) are not scanned. This excludes `.git`, `.obsidian`, and similar tooling directories. A note placed in a hidden directory is invisible to Nodus.
- Symbolic links and junctions are never followed. `checkHealth` reports them as `UNSAFE_PATH`.
- Leftover `.nodus-tmp-*` files are reported by `checkHealth` as `INCOMPLETE_WRITE`. They are never read as notes.
- Scans are on demand and read every note. There is no index or cache in Phase 2.

## Contracts

`src/storage/contracts.ts` defines two entity stores and one vault contract. None of them reference a filesystem, browser, network, or UI type.

```ts
interface NoteStore {
  listNotes(): Promise<NoteSummary[]>;
  readNote(id: string): Promise<Note>;
  readNoteAtPath(path: string): Promise<Note>;
  createNote(note: Note): Promise<void>;
  replaceNote(note: Note): Promise<void>;
  moveNote(id: string, toPath: string): Promise<Note>;
  deleteNote(id: string): Promise<void>;
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
| `UNSUPPORTED_VERSION` | A note, database, or backup version is newer than this build. |
| `CORRUPT_BACKUP` | The manifest is missing/invalid, a file is missing, a hash mismatches, or a document is inconsistent. |
| `PARTIAL_WRITE` | A multi-file operation stopped after some files were written. `details.paths` lists them. |
| `STORAGE_FAILURE` | An I/O operation failed. |

## Safe writes

`createNote`, `replaceNote`, `moveNote`, database writes, export, and backup use the same atomic file write:

1. Write to `.nodus-tmp-<uuid>` in the target directory.
2. Flush the file handle (`fsync`).
3. Rename the temporary file over the target.
4. On POSIX, best-effort `fsync` of the directory. Skipped on Windows.

Guarantees:

- A reader never observes a half-written file at the target path.
- A failed write removes its temporary file.
- No note content is deleted unless the operation explicitly deletes or replaces it.

Not guaranteed:

- Atomicity across several files. There is no vault-wide transaction.
- Durability against power loss beyond what the OS/filesystem guarantees.
- Protection from another process editing the same file concurrently.
- File locking.

### Concurrency

Phase 1 has no revision field. Phase 2 does **not** invent one. Consequences:

- `replaceNote` and `replaceDatabase` are last-write-wins.
- There is no stale-revision detection and no merge.
- Stale-write detection requires an approved revision/token decision in a future phase. The storage contract is the place to add it; the file formats would not need to change.
- Import and restore never overwrite by default. They abort with `CONFLICT` before writing unless `{ overwrite: true }` is passed.

### Deletion and moves

- `deleteNote` and `deleteDatabase` remove the file permanently. There is no trash directory in Phase 2.
- `moveNote` writes the note at the new path first, then removes the old file. If removal fails, it throws `PARTIAL_WRITE` and leaves both files; `checkHealth` then reports a duplicate ID.
- Nodes are not rewritten. Phase 1 title links can break on a rename; ID-pinned links survive.

## Health checks

`checkHealth()` scans without throwing for content problems. It returns valid summaries plus issues:

| Issue code | Cause |
|---|---|
| `INVALID_CONTENT` | A note or database cannot be parsed, or a database filename does not match its ID. |
| `UNSUPPORTED_VERSION` | A document declares a newer format version. |
| `DUPLICATE_ID` | The same note ID is present at more than one path. |
| `UNSAFE_PATH` | A symbolic link or junction was skipped, or a file is in the reserved `databases/` tree incorrectly. |
| `INCOMPLETE_WRITE` | A `.nodus-tmp-*` file remains from an interrupted write. |

Normal operations are strict: `listNotes`, `snapshot`, export, and backup throw `INVALID_CONTENT` or `UNSUPPORTED_VERSION` rather than silently skipping a bad file. Use `checkHealth` first when diagnosing a vault.

## Export and import

Export is a plain directory, not a proprietary archive:

```
<export>/notes/roadmap.md
<export>/databases/<id>.json
```

- `exportVault(vault, target)` requires an empty target outside the vault, writes every valid note and definition byte for byte, and reports counts. A partial failure leaves a partial export; importing it will fail validation rather than lose data.
- The export is itself a valid vault, so it can be opened directly by `FileSystemVault.open`.

Import is validated in two separable steps:

1. `planImport(sourceDir)` reads and validates the whole directory with the Phase 1 parsers. It rejects malformed files, unsupported versions, duplicate IDs, database filename/id mismatches, symbolic links, and paths that collide by case or normalization. It writes nothing.
2. `vault.applyImport(plan, options)` compares the plan with the target. Without `{ overwrite: true }`, any existing ID or path aborts with `CONFLICT` before a single write. With it, notes and databases are replaced, old paths are removed after the new files are written, and unrelated notes are left alone.

Behavior and limits:

- Imported files keep their original bytes, so unknown frontmatter keys and non-canonical formatting survive.
- Non-Nodus files (for example `README.txt`) are never copied, modified, or deleted.
- A write failure is reported as `PARTIAL_WRITE` with the paths already written. Re-running the import is the recovery path.
- Import is one-way copying. It is not synchronization, does not track history, and does not merge divergent content.
- With `overwrite: true`, a note at a conflicting path can be replaced by a different ID; that old note is lost. This is why overwrite is never the default.

## Backup and recovery

`createBackup(vault, targetDir)` writes the same layout plus a manifest (hash abbreviated here):

```json
{
  "format": "nodus-backup",
  "version": 1,
  "createdAt": "2026-10-25T12:00:00.000Z",
  "files": [
    {
      "kind": "note",
      "id": "6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c",
      "path": "notes/roadmap.md",
      "sha256": "..."
    }
  ]
}
```

- Files are copied byte for byte. The manifest is written **last**, atomically, so a missing manifest means an interrupted or incomplete backup.
- The target must be empty and outside the vault.
- `validateBackup(dir)` checks the manifest shape and version, every hash, every document with the Phase 1 parsers, IDs against the manifest, database filenames, and duplicate IDs/paths. Newer document or manifest versions produce `UNSUPPORTED_VERSION`; other problems produce `CORRUPT_BACKUP` with an issue list.
- `restoreBackup(backupDir, targetRoot, { overwrite })` validates first, then applies the backup through the normal import path. It never writes to the backup directory. Without `overwrite`, existing IDs or paths abort before any write.
- A failed validation creates no target directory and leaves the backup untouched.
- A restoration I/O failure is `PARTIAL_WRITE`; the backup remains unchanged and re-running the restore is the recovery path.

What a backup protects against:

- Accidental edit or deletion of vault files, when a recent backup exists elsewhere.
- Silent corruption that changes bytes, because hashes are checked.

What it does **not** protect against:

- Disk failure, filesystem corruption, ransomware, or loss of the backup itself.
- Deletion or modification of both the vault and the backup.
- Malicious tampering that recomputes the hashes. Hashes detect corruption, not forgery.
- Concurrent writers while the backup is created.
- Non-Nodus files in the vault (they are not backed up).
- Attachments, settings, or UI state (not implemented in Phase 1 or 2).

Store backups on a different device or service for real disaster recovery. Phase 2 performs no upload.

## Privacy and network boundary

- The adapter reads and writes local files only.
- No telemetry, analytics, AI calls, accounts, credentials, or third-party transfers.
- No note content, metadata, or backup leaves the machine.

## Future cross-device access

Phase 2 is local only. Nothing here makes Nodus reachable from another device. A later, separately approved phase would need:

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
- No revisions, locks, trash, or distributed transactions.
- Database definitions have no views, relations, rows, or query execution. Those remain deferred.
- The `databases/` directory is a reserved namespace owned by Nodus.
