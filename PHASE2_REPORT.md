# Nodus — Phase 2 Report: Storage Adapters & Recovery

> **Historical snapshot.** This report describes Phase 2 as it stood in the
> working tree before the repository's first commit; it was never updated for
> later phases. Git-state claims below are historical, not current — the
> repository is now tracked on `main`.

**Status:** Implemented and verified. Historical snapshot (see note above).

## 1. Summary

Phase 2 adds a filesystem-backed vault adapter, portable export/import, and verified backup/restore. The Phase 1 domain, formats, validators, and public API are unchanged; storage is a new layer above them.

- One primary adapter: `FileSystemVault` (Markdown notes + JSON database definitions).
- Contracts are filesystem-independent (`NoteStore`, `DatabaseStore`, `VaultStorage`).
- Note identity is the Phase 1 UUID v4; moves preserve ID and bytes.
- Duplicate IDs, path collisions, malformed content, and unsupported versions are explicit structured errors.
- Writes are per-file atomic (temp file + `fsync` + rename). No vault-wide transactions are claimed.
- Export/import validates everything before writing and refuses overwrite without an explicit flag.
- Backups are byte-for-byte copies with a SHA-256 manifest written last; restore validates fully first and never modifies the backup.
- No network, telemetry, accounts, credentials, or third-party transfer.

## 2. Files created or changed

### Created

| File | Reason |
|---|---|
| `src/storage/contracts.ts` | Small storage interfaces: note CRUD, database CRUD, snapshot, health, import application. |
| `src/storage/errors.ts` | `StorageError` with ten codes, separate from Phase 1 `NodusError`; wraps domain errors as `cause`. |
| `src/storage/fs/layout.ts` | Vault layout constants: `databases/<id>.json`, backup manifest name, temp prefix, reserved path check. |
| `src/storage/fs/safe-path.ts` | Path containment, real-path checks for symlink/junction escapes, symlink rejection, inside-root detection. |
| `src/storage/fs/atomic.ts` | Temp-file + `fsync` + atomic rename, temp cleanup on failure, best-effort POSIX directory sync. |
| `src/storage/fs/scan.ts` | Deterministic vault walk: notes, database files, leftover temp files, skipped symlinks, hidden-path rules. |
| `src/storage/fs/vault.ts` | `FileSystemVault`: CRUD, move, snapshot, health, import application, duplicate and conflict detection. |
| `src/storage/portable/export.ts` | Portable vault mirror export; requires empty target outside the vault. |
| `src/storage/portable/import.ts` | `planImport` (full read-only validation) and `applyImport`; duplicate/path/version checks. |
| `src/storage/backup/backup.ts` | `createBackup`, `validateBackup`, `restoreBackup` with manifest and hashes. |
| `src/storage/index.ts` | Storage public exports. |
| `test/storage-vault.test.ts` | CRUD, identity, duplicate IDs, malformed content, health, snapshots, database storage. |
| `test/storage-paths.test.ts` | Traversal, reserved paths, junction escape, symlink notes, hidden files. |
| `test/storage-portable.test.ts` | Export/import round trips, validation, collisions, overwrite, unrelated files. |
| `test/storage-backup.test.ts` | Manifest, hashes, tampering, missing files, restore conflicts, interrupted-write detection. |
| `test/tmp.ts` | Isolated temp directories with cleanup. |
| `docs/storage.md` | Contracts, layout, errors, safe writes, export/import, backup, limitations, future sync requirements. |
| `PHASE2_REPORT.md` | This report. |

### Changed

| File | Reason |
|---|---|
| `src/index.ts` | Re-exports storage API. |
| `test/helpers.ts` | Added `storageErrorCode` helper. |
| `tsconfig.json` | Added `"types": ["node"]` so the approved dev typings are used. |
| `package.json` | Added dev dependency `@types/node@^22.20.5` (authorized); updated description. |
| `pnpm-lock.yaml` | Records the authorized dev dependency. (The repository uses pnpm; no `package-lock.json` exists.) |
| `README.md` | Phase 2 status, storage layout, consistency boundaries, deferrals, privacy, limitations link. |

No Phase 1 source file (`src/domain`, `src/format`, `src/links`, `src/database`) or Phase 1 test was modified in Phase 2.

## 3. Storage layout and format decisions

```
<vault>/
  <note.path>.md
  databases/<database-id>.json
```

- Notes keep their Phase 1 relative paths; `path` is not stored in frontmatter.
- Database definitions are separate JSON files named by their UUID. `databases/` is reserved for definitions.
- `createNote`/`replaceNote`/database writes serialize canonically. `moveNote`, export, import, and backup preserve raw bytes, including unknown frontmatter and formatting.
- Hidden files/directories are not scanned. Symbolic links and junctions are never followed.
- Paths that collide after case-folding and NFC normalization are rejected, keeping vaults portable to case-insensitive filesystems.
- Duplicate note IDs are detected at the vault boundary, not in `parseNote`.

## 4. Export/import and backup/recovery behavior

### Export

- `exportVault(vault, target)`: empty target outside the vault; mirrors notes and definitions byte for byte; no proprietary archive or wrapper manifest.
- The export is itself a valid vault.
- Partial failure leaves a partial export, which import validation rejects.

### Import

- `planImport(source)`: read-only; parses every document with Phase 1 validators; rejects malformed files, unsupported versions, duplicate IDs, database filename/id mismatches, symlinks, temp files, and case-folded path collisions.
- `applyImport(vault, plan, { overwrite })`: computes ID and path conflicts first. Default aborts with `CONFLICT` before writing. With explicit overwrite, writes all targets atomically, removes old paths after the new writes, and leaves unrelated notes and non-Nodus files untouched.
- I/O failure mid-apply is `PARTIAL_WRITE`, listing written paths. Re-running is the recovery path.

### Backup

- `createBackup(vault, target, { now? })`: empty target outside the vault; copies every valid note and definition; writes `nodus-backup.json` last.
- Manifest: `{ format: "nodus-backup", version: 1, createdAt, files[{ kind, id, path, sha256 }] }`.
- `validateBackup(dir)`: checks manifest structure/version, every hash, every document, ID/path consistency, duplicates, and database naming. Missing/malformed/incomplete → `CORRUPT_BACKUP`; newer version → `UNSUPPORTED_VERSION`.
- `restoreBackup(backup, target, { overwrite })`: validates first, then applies through the import path. Without `overwrite`, any conflict aborts before writing. The backup directory is only ever read.
- Failed validation creates no target directory. Failed restore leaves the backup unchanged.

## 5. Tests and checks

All executed on Node.js 24.19.0, Windows 11, PowerShell.

| Check | Command | Result |
|---|---|---|
| Full suite | `npm test` | **9 files, 203 tests passed**, 0 failed |
| Storage suites | `npx vitest run test/storage-*.test.ts` | **4 files, 70 tests passed** |
| Phase 1 regression | included in full suite | 133 tests still pass |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| Dependency tree | `npm ls --depth=0` | `yaml@2.9.1`, `typescript@7.0.2`, `vitest@5.0.5`, `@types/node@22.20.5` |

Coverage includes CRUD, stable identity across moves, duplicate ID/path handling, unsafe paths and junction escapes, Unicode/code-fence/unknown-metadata preservation, database version validation, not-found/storage errors, export/import round trips, collision-safe imports, backup hashes/tamper/missing files, restore conflicts, and preservation of target and backup on failure.

## 6. Known limitations and unresolved decisions

**Unresolved decisions (reported, not guessed):**

1. **No revision model.** Phase 1 has no revision field, so `replaceNote` is last-write-wins and stale writes are not detected. Adding revisions requires an approved decision. Tests assert explicit-overwrite behavior, not revision conflicts.
2. **No vault-wide transaction.** File-level writes are atomic; multi-file operations are not. `PARTIAL_WRITE` is the documented contract.
3. **No remote/sync design.** Authentication, transport, sync protocol, and conflict policy are not approved.

**Known limitations:**

- One malformed note blocks strict operations (`listNotes`, `snapshot`, export, backup) until fixed; `checkHealth` diagnoses without throwing.
- ID lookups scan and parse all notes; no index or cache.
- Hidden directories are invisible, including notes placed there.
- Symbolic links/junctions are unsupported.
- Case-folded path collisions are rejected even on case-sensitive filesystems.
- `deleteNote`/`deleteDatabase` are permanent; no trash.
- No file locking or concurrent-writer coordination.
- `overwrite: true` on an import can replace a note at a conflicting path with a different ID; that note is lost. It is never the default.
- Backups are neither off-site nor tamper-proof; SHA-256 detects corruption, not forged hashes.
- Backups exclude non-Nodus files, attachments (not implemented), settings, and UI state.
- Windows directory `fsync` is skipped; durability is bounded by the OS/filesystem.
- Orphaned `.nodus-tmp-*` files are reported but not deleted automatically.

**Still deferred:** persisted vault entity, folders, attachments, link records, view definitions, relations, database rows/queries, search, graph, UI, sync, authentication, remote access, AI, telemetry.

## 7. User data safety

- No real vault or personal file was read or written.
- All tests used fresh directories under the OS temp directory and removed them afterward.
- Existing repository files were not reset, rewritten, or deleted.
- No migration or bulk rewrite of user data was performed.

## 8. Git, dependencies, and network

- No commit, push, publish, deploy, or remote Git change.
- At Phase 2 completion nothing was committed (all 53 files untracked); the repository has since been committed and pushed on `main`.
- One dependency change, explicitly authorized: dev-only `@types/node@^22.20.5`. No runtime dependency was added.
- No network calls in source or tests; no telemetry, analytics, or third-party transfer.
- `node_modules/` remains git-ignored.

## 9. Proposed next phase: secure personal cross-device access

Phase 3 should be approved separately and scoped as a personal, single-user system — not multi-tenant SaaS.

1. **Revision and conflict decision.** Choose a revision representation (for example an integer `nodus.revision` or an opaque content hash) and define stale-write behavior and tests. This is the prerequisite for safe multi-device edits.
2. **Personal access service.** One deployment per person; HTTPS with modern TLS; no public content endpoints without authentication.
3. **Authentication.** Device pairing or passkeys, short-lived sessions, revocation, and vault-scoped authorization. No credentials in notes, exports, or backups.
4. **Sync protocol.** Change detection, resumable/idempotent transfer, tombstones for deletes, duplicate-ID prevention, and a defined conflict policy. Start without CRDTs; add merging only after revision semantics are proven.
5. **Minimal web access.** A separately approved read/edit client using the same storage contracts, with no dependency from the domain layer to the web framework.
6. **Encryption.** TLS in transit; encryption at rest for the service and backups; key custody outside vault files.
7. **Recovery.** Remote snapshots using the Phase 2 backup manifest, retention policy, integrity checks, and restore drills.
8. **Threat model and privacy review.** Explicit data flows, logging that excludes note content, and a clear statement of what is and is not protected.

Explicitly out of scope until separately approved: multi-tenant accounts, real-time collaboration, CRDTs, distributed transactions, AI, analytics, and public sharing.
