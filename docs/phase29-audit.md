# Phase 29A — Advanced Import & Export Architecture Audit

**Audit date:** 2026-11-04

**Roadmap status:** Phase 29 — **IN PROGRESS**. Phase 29A audit and 29B portable export are complete. Phase 29C preview was owner-accepted on 2026-11-05 with freshness limitations carried into Phase 29D. Phase 29D.1–29D.6 implementation and verification are recorded in [the Phase 29D handoff](phase29d-handoff.md); formal Phase 29D acceptance remains pending owner review.

## Executive summary

Nodus already has useful local portability building blocks: a raw-file portable vault directory export/import library, versioned checksummed backup/restore, managed attachment copying, database schema and saved-view files, a property catalog, automation definitions/history, templates, and JSON import/export for graph-view preferences. Core storage APIs are local filesystem abstractions, with path validation, strict parsing, ID/collision checks, vault locking and per-file atomic writes. The Phase 29B implementation adds a distinct v1 portable manifest, one root-lock snapshot for portable resources, export completeness validation, and a full-vault `/api/export` action in Settings → Backup & restore.

The remaining gap is primarily import preview/conflict workflow and package-level publication/recovery. Portable export now writes `nodus-export.json` last, after writing exact snapshotted bytes, then validates resource inventory, lengths, and checksums before reporting success. Failures can leave an incomplete destination directory without a valid completion manifest; there is no staging-directory rename or automatic cleanup/recovery. Snapshot coherence is guaranteed for Nodus writers using the vault root lock; external editors or sync tools that bypass it are outside the guarantee. Backup still uses its separate recovery contract and existing snapshot behavior. General portable import validates the source before applying it and refuses conflicts by default, but writes multiple files sequentially; a later failure is reported as `PARTIAL_WRITE` without general rollback. Backup restore has a stronger manifest validation and a conflict preview, but its multi-file application likewise is not transactional.

Database portability is structurally substantial: definitions, Markdown-backed record values, saved views and ordering, and optional metadata/configuration files are included. Stable database, property, note, view, and relation IDs are preserved. Relations and rollups depend on the matching schemas and record IDs being present; missing or incompatible references are diagnosed and retained rather than rewritten. Formula expressions remain schema data and formula results are derived. There is no general ID-remapping/import-into-existing-different-identity workflow, no CSV database interchange, no ZIP package format, and no cross-tool Markdown migration profile.

Phase 29 should first make package inspection and conflict decisions explicit, then harden package-level commit/recovery, then expose reliable portable Markdown/attachment exchange, and then provide structured database portability using dependency-aware validation. Any package manifest or new migration format should be versioned and preserve source Markdown/files where possible. Do not treat backup format as an interchange format without an explicit product decision: backups preserve Nodus files and identity, while cross-tool import needs a distinct mapping and diagnostics contract.

## Existing architecture and execution paths

### Full-vault portable directory export/import

The portable functions are `exportVault(vault, targetDir)` in `src/storage/portable/export.ts`, `planImport(sourceDir)` and `applyImport(vault, plan, options)` in `src/storage/portable/import.ts`. They are re-exported by `src/storage/index.ts` and the package barrel `src/index.ts`.

1. A caller supplies a `VaultStorage` and destination directory to `exportVault`. It requires the storage adapter to provide `snapshotForPortableExport`, rejects destinations inside the source vault, and captures notes, databases, saved views, attachments, catalog, view ordering, automation, templates, folders, and exclusion diagnostics under one root lock. It then releases the lock, requires an empty target, writes each resource atomically and writes `nodus-export.json` last. The output remains a directory shaped like a Nodus vault.
2. `planImport` accepts a directory, walks supported vault entries without following child symlinks, parses Markdown and structured JSON, validates managed attachments, and returns an in-memory `ImportPlan`; it writes nothing. It detects duplicate note/database/view/attachment IDs, path collisions after case folding and Unicode NFC normalization, malformed supported files, mismatched database/view paths, unsupported versions, and leftover Nodus temporary entries.
3. `applyImport` delegates to `VaultStorage.applyImport`. `FileSystemVault` revalidates the plan and destination state under the vault root lock, captures expected destination hashes, refuses ID/path conflicts unless overwrite is explicitly enabled, and checks those hashes immediately before writes. A plan can therefore become stale without silently replacing a file that changed after preflight.
4. The normal apply writes files one by one using atomic file writes. Saved-view ordering is written after view files. If a later operation fails after earlier writes, it returns `PARTIAL_WRITE` with affected paths; normal portable import has no all-files rollback. A separate `atomicNewFiles` transaction path exists for database-template application only and accepts a deliberately constrained package; it is not general portable-import atomicity.

- Full-vault export is exposed at `POST /api/export` and in Settings → Backup & restore. The UI asks for a typed local destination under the existing allowed backup roots; there is no native folder picker in this workflow. Full-vault import remains a library capability, not a general `/api/import` route. The API refuses the active vault as export target and non-empty destinations are rejected by the storage exporter.

### Backup and restore

`createBackup`, `validateBackup`, `previewRestore`, and `restoreBackup` live in `src/storage/backup/backup.ts`. A backup is a folder containing copied files plus `nodus-backup.json`, currently manifest v7; the reader supports versions 1–7 and rejects unsupported future versions. The manifest records resource kind, stable ID, path, SHA-256, byte length, format versions, counts, creation time, optional application version, and a canonical manifest digest. It is written last, so its absence indicates an incomplete backup. Validation checks manifest structure/version, listed paths, hashes, byte lengths, file identity and format parsing before restore.

The UI path is `ui/src/BackupRestoreSection.tsx` → methods in `ui/src/api.ts` → `/api/backup`, `/api/backup/validate`, `/api/restore/preview`, `/api/restore` in `src/ui-server/api.ts` → backup functions → `FileSystemVault.applyImport`. Backup destinations must be empty, outside the vault, and under `NODUS_BACKUP_ROOTS` (or the default allowed parent); the UI currently requires typing the path. Restore preview is read-only and reports counts and ID/path/catalog conflicts. Restore merges; it does not replace the whole vault or delete unrelated destination data. Overwrite defaults off and must be explicitly enabled for supported conflicts. Case/normalization path collisions remain blocked.

### Markdown, frontmatter, and records

`src/format/note-format.ts` parses/serializes Markdown notes and Nodus YAML frontmatter. Plain Markdown without Nodus frontmatter is accepted with a deterministic path-derived identity; its text is retained in the import plan. Managed Nodus notes preserve note UUID, title, timestamps, tags, aliases, and unknown top-level frontmatter. Portable import/export and backup/restore use raw file bytes for existing files and preserve valid UTF-8 BOMs and line/body bytes where the raw-byte pathway applies. Normal edits may serialize the document and are not byte-preserving by design.

Database records are not rows in a separate database file. A record is a Markdown note with a `nodus_data` frontmatter namespace; `src/database/note-properties.ts` projects its per-database values against schemas. Thus Markdown files carry the record identity and values. Exporting the Markdown files and database definitions preserves the records without a second persistence system. Unsupported namespace versions and malformed values are surfaced as diagnostics; the source values are retained rather than silently discarded.

### Attachments and filesystem boundaries

Managed attachments live at `attachments/<uuid>-<safe-name>.<extension>`. `src/storage/fs/attachments.ts` accepts PNG, JPEG, GIF, WebP, AVIF, PDF, and valid UTF-8 `.txt`; one file is limited to 10 MiB. The attachment API uses binary request bodies, validates extension/content signatures and path/name constraints, and never overwrites an existing generated target. The editor attachment browser uploads individual files, inserts relative Markdown links, and can open/delete managed attachments. Managed attachment bytes are included in portable directory export/import and backup/restore. This is not arbitrary file synchronization: ordinary non-managed files are outside the scanner's supported entry set.

The filesystem scanner, safe-path helpers, atomic writer, and vault lock are in `src/storage/fs/scan.ts`, `safe-path.ts`, `atomic.ts`, `root-lock.ts`, `layout.ts`, and `vault.ts`. Child symlinks are not followed; recognized paths are resolved/validated within the root. The portable directory walker reports symlinks and unsupported entries that it recognizes, but ordinary visible non-Markdown files outside reserved managed trees are not general import resources. Hidden paths are excluded except explicitly handled Nodus-owned hidden catalogs/manifests. Empty folders and arbitrary hidden application metadata are not represented by portable export.

### Database schemas, relations, views, and templates

- `src/database/schema.ts` serializes versioned `nodus-database` JSON schemas (versions 1–3). Schemas preserve database UUID, property UUID/name/type, Select and Multi-select option UUID/name, relation configuration, rollup configuration, and formula expressions.
- `src/database/note-properties.ts` stores record values inside note frontmatter keyed by database and property UUIDs. It validates/project values and reports missing schemas/properties, unsupported namespaces and invalid values without rewriting them.
- `src/database/relations.ts` resolves relation UUIDs across note records and schemas. Rollups are derived. Missing and incompatible targets are diagnostics; stored relation IDs remain. `src/database/formula-engine.ts` evaluates formula definitions from schema data; calculated results are not persisted.
- Saved database view definitions are separate versioned JSON under `database-views/<database-id>/<view-id>.json`, parsed/validated in `src/database/database-view.ts`. They preserve layout settings and query configuration, including filters, sorts, grouping and Calendar date-property configuration. `.nodus-orders/database-views/<database-id>.json` preserves per-database display order. Both are included by portable export/import and backup/restore.
- `properties/catalog.json` is an optional versioned catalog and is copied when present. A legacy source without a catalog does not clear a destination catalog.
- `.nodus-automations/automations.json` and `history.json` and `.nodus-templates/templates.json` are included by current portable export/import and backup manifest v6/v7 onward. Template catalogs preserve note/database template definitions; database templates include a schema, views, and starter-row values. Applying a database template is a special atomic-new-files flow that assigns new database/view/note identities; that behavior is distinct from full-vault import, which preserves identities.
- Graph saved views are a separate browser-driven JSON capability in `ui/src/GraphSavedViews.tsx` and `ui/src/graph-saved-views.ts`. The browser downloads `nodus-graph-views.json`, reads a selected JSON file, previews diagnostics/conflicts, and supports graph-view conflict strategies. These are graph visualization preferences, not full-vault data; local graph view/history and workspace UI preferences are not included in the vault portable export.

## Current format support matrix

“Supported” below means implemented in the inspected execution paths, not merely named in a roadmap or type.

| Format/resource | Import | Export | Preserved / transformed | Validation and limitations |
|---|---|---|---|---|
| Markdown `.md` notes | Yes, as files in a Nodus-shaped directory passed to `planImport`; backup restore also imports notes from a validated backup | Yes, copied at vault-relative paths with a resource record in `nodus-export.json` v1 | Existing note bytes, Nodus frontmatter, unknown frontmatter, body, IDs and relative paths are retained on raw-byte path. Plain Markdown gets path-derived identity when parsed. | UTF-8 required; malformed Nodus frontmatter/version, duplicate IDs, path collisions, reserved/unsafe paths rejected. No external-product migration profiles, link rewriting, folder mapping, or full-vault browser import flow. |
| Plain text `.txt` | As a managed attachment only, not as a note/document importer | Managed `.txt` attachment bytes are copied | Attachment bytes and path identity retained; Markdown links remain relative. | UTF-8 and attachment path required; 10 MiB per file. Arbitrary `.txt` files are not imported as notes or exported as general files. |
| Nodus JSON database schema | Yes, in a portable directory or validated backup | Yes, under `databases/<uuid>.json` | Database/property/option IDs and types; relation/rollup/formula configuration preserved. | Strict JSON/version/schema validation and ID/path match. Cross-schema relation integrity and values are projection diagnostics; no general identity remapping. |
| Record data | Yes, through imported `.md` records | Yes, as ordinary Markdown notes | Note IDs and `nodus_data` database/property keyed values remain in YAML frontmatter. | Generic note parse plus source preservation; property/schema mismatch can remain diagnosable source data. Records are not a standalone CSV/JSON table export. |
| Saved-view JSON and ordering | Yes, in portable directory/backup | Yes, as `database-views/` files and `.nodus-orders/` manifests | View IDs, database IDs, filters, sorts, grouping, layout settings, Calendar properties and ordering. | Strict supported-version/path checks; view references can be diagnosed if a partial package lacks schema/dependencies. Graph view preferences have their own browser JSON import/export. |
| Property catalog JSON | Optional | Optional | Raw bytes and catalog definitions preserved. | Validated version/content; existing destination conflict requires overwrite; absent legacy catalog does not delete destination catalog. |
| Automation/template JSON | Optional, portable directory and supported backup versions | Included in current portable export and backup | Automation definitions/history and templates retained. Database template apply generates new identities for created resources. | Strict parser validation. Full import apply is multi-file; template creation has a special bounded transaction/recovery journal. |
| Attachment images/PDF | Yes, managed attachment entries in portable directory/backup; browser attachment upload handles files | Yes, managed attachment bytes copied | Binary bytes, generated stable attachment ID/path and Markdown references preserved. | PNG/JPEG/GIF/WebP/AVIF/PDF signatures; 10 MiB per file. No arbitrary binary file/folder importer. |
| CSV `.csv` | No general CSV importer found | No database/note CSV export found | None. | No CSV adapter, mapping UI, or round-trip contract in the inspected implementation. |
| ZIP archives | No | No archive writer found | None. Portable export is a directory tree, not a ZIP. | No archive extraction/path traversal or decompression-bomb implementation exists because ZIP input is not supported; this becomes required security work if ZIP is proposed. |
| Backup directory / `nodus-backup.json` | Yes via validate/preview/restore | Yes via backup creation | Byte-level files plus versioned manifest and integrity metadata. | Manifest v7 writer; readers accept v1–v7. This is a Nodus recovery format, not a cross-tool interchange format. |
| Graph saved-view JSON | Yes in Graph Saved Views browser flow | Yes as a browser download | Graph saved-view configuration only; conflict strategies operate on those view records. | Separate from notes, database rows/schemas, saved database views, and full-vault portability. |

No CSV, ZIP, arbitrary JSON/JSON-lines, plain-text-note, or product-specific migration adapter was found. No cloud service is required for the existing storage/import/export pathways.

## Database portability assessment

| Concern | Verified current behavior | Limitation / dependency |
|---|---|---|
| Database identity | Schema UUID and `databases/<id>.json` path preserved by raw portable export/import. | Existing ID conflict blocks default apply. There is no safe “clone with new identity” operation for a whole imported workspace. |
| Property identity and types | Property UUIDs, names, supported types and type-specific configuration are serialized in schema JSON. | External schemas require mapping from source concepts to Nodus types and values; no profile/mapping UI. |
| Select options | Stable option IDs and names are schema fields and survive round trip. | External textual labels/options need a conflict/mapping policy. |
| Record identity/values | Record note UUID and Markdown frontmatter values survive with the Markdown file. | Source values can be diagnostically invalid or reference unknown schema IDs; no generic record table adapter. |
| Relations | UUID references are preserved. Whole compatible sets of schemas and records can resolve after import. | No ID remapping stage. A subset/partial import may produce missing or incompatible target diagnostics. Import order/dependency graph should be explicit for future remapping/preview; current files are written notes before database definitions. |
| Rollups | Definitions are schema data; outputs are recomputed from relation/record data. | Results are intentionally not serialized as authoritative values. Missing relation/schema dependencies leave diagnostics/unavailable derived values. |
| Formulas | Expressions and stable property references are schema data; values are recalculated on projection. | Derived results are not exported as record values. Relation-aware formula functions depend on configured relation targets and their schemas; partial imports can leave those dependencies unavailable. |
| Saved views | Saved-view files and order manifests are included; supported configs survive unchanged. | A view may refer to absent schema properties if a partial package is imported; reference diagnostics do not remap external concepts. UI selection state is separate local preference. |
| Calendar configuration | Start/end property IDs and legacy `datePropertyId` are stored inside saved view files, so current portable/backup file copying preserves them. | Compatibility depends on retaining the referenced schema properties; importing a view alone cannot make missing properties valid. |
| Templates | Catalog carries database schema, views and starter row values; template application has an identity-generating specialized path. | Template application is not equivalent to full workspace migration and has limits on counts/file kinds. |

Recommended dependency order for a future identity-remapping/import-profile workflow: parse/validate all schemas; create an explicit source→destination database/property/option/record ID mapping; validate and stage record note frontmatter; resolve relation dependencies after all target identities are known; recompute rollups/formulas; validate saved views against final schemas; then make the package visible. For the current same-identity portable format, preservation of the whole package avoids remapping but destination conflicts still need an explicit plan.

## Import safety and validation

### Existing safeguards

- Import planning is read-only. Supported Markdown/JSON/resources are parsed before destination mutation.
- Duplicate note, database, saved-view and attachment identities are rejected. Paths collide after case folding/NFC normalization are rejected.
- Database file IDs must match paths; view paths must match both IDs. Unsupported/future versions fail closed.
- Import walk does not follow child symlinks; unsafe scanner issues and leftover `.nodus-tmp-*` entries reject the package. Managed attachment paths/content/size are validated.
- `FileSystemVault.applyImport` holds the vault root writer lock, validates incoming plans again, compares destination IDs/paths, defaults to no overwrite, and hash-rechecks each target immediately before write. Competing Nodus writers are serialized; a non-cooperating external editor has the documented hash-to-rename residual race.
- Restore first validates manifest digests, file checksums/lengths, identities and known file formats. The UI offers read-only validation and conflict preview and requires explicit overwrite selection. Paths are restricted to allowed backup roots.
- Template database application has a specialized staged transaction journal, rollback/recovery checks, and health reporting. Do not generalize those guarantees to ordinary imports.

### Gaps and risks

- Full-vault portable import is not integrated into the UI and does not expose a target-conflict preview workflow. `planImport` previews source validity only; target conflicts are detected during `applyImport`.
- Generic portable import/restore may leave already-written files after a later failure. It reports `PARTIAL_WRITE` and paths; it does not automatically roll back. Retrying blindly can encounter a partially changed destination.
- A user-selected source directory is not a bounded archive. There is no ZIP support, compressed-size/expanded-size ratio enforcement, or whole-package byte/file-count ceiling. Notes are held in an in-memory plan; large workspace memory/time has no dedicated measured import/export benchmark. Attachment size is checked, though bytes are read before portable attachment size rejection.
- Scanner semantics intentionally support Markdown and managed internal files, not all visible files. Unknown ordinary non-Markdown files may be outside the import set; arbitrary hidden files and empty folders are omitted. A portability preview should state what is included and skipped instead of implying a filesystem mirror.
- The generic import contract has no user-selectable skip/rename/merge strategy. `overwrite: true` is coarse and allowed behavior differs by resource kind; case/normalized note-path collisions remain rejected. Relations keep source IDs; no reference mapping exists for importing records as new identities.
- The import source directory itself is `stat`-checked (which follows a root symlink) before the child walker avoids symlinks. If source selection becomes a UI/API boundary, validate the chosen root and allowed-root policy deliberately, and include it in security tests.
- Broken relation references are preserved and diagnosable rather than always rejecting an import. This protects user data but requires preview to explain unresolved references and package dependency omissions.
- There is no recovery checkpoint for a generic partial import. Diagnostics currently identify affected paths, but the user must inspect/copy/repair before retrying.

### Proposed safe import flow (Phase 29A audit baseline)

1. **Inspect source:** identify directory/archive/format, bounds, file kinds, versions, and whether the source root is safe.
2. **Validate package:** parse the whole source, verify hashes/manifest where present, validate paths/IDs/schema/property values/attachments, and collect warnings without writes.
3. **Preview:** show included/skipped resources, conversion losses, unresolved relations, unsupported fields, counts/size, and target conflicts.
4. **Resolve conflicts:** offer explicit, documented per-resource choices (skip, keep, rename/remap, merge only where semantics are defined, or overwrite with clear confirmation); do not silently pick.
5. **Stage/apply:** bind the plan to source hashes and destination revisions; stage safely and apply through vault APIs, not UI filesystem writes.
6. **Recover/report:** return complete structured diagnostics and an operation identity; either provide transaction rollback/recovery or make a partial result unmistakable and safely resumable. Do not claim atomicity if only per-file writes occurred.

## Export safety

### Existing guarantees

- Portable export refuses a target inside the vault and a non-empty target; each resource is written via the existing exclusive atomic writer, which cannot replace an existing file. The manifest is the final completion marker.
- Backup also refuses a non-empty target and writes per-file SHA-256/byte-length entries plus a canonical digest manifest last. Missing manifest indicates incomplete backup; validation checks integrity before restore.
- Vault snapshots use the root lock; Nodus writes are serialized. Export/backup refuse to proceed while an uncommitted template-apply transaction makes snapshots unsafe.
- Raw Markdown/database/view/attachment bytes and relative paths are copied; supported attachments keep their generated identity and Markdown-relative references.

### Limits

- A failure part-way through export can leave a partial target, but without a valid `nodus-export.json` completion manifest. There is no automatic staging-directory publication, cleanup, or rollback.
- The target is created and populated in-place; there is no final atomic directory rename guaranteeing consumers see either no package or a complete package.
- Portable export captures all resource classes under one lock for Nodus-cooperating processes and releases it before destination writes. Direct external filesystem writers do not honor that lock and can still race reads; no universal filesystem snapshot guarantee is claimed.
- Backup is stronger in integrity detection, but it uses the same split resource snapshots and writes files sequentially. Its manifest detects missing/partial bytes; it does not make the snapshot temporally coherent or the creation transactional.
- The portable v1 manifest declares resources, component format versions, skipped paths, and exact byte checksums. It does not perform cross-version conversion. It is an integrity record, not an authenticated signature. No staged publication or automatic cleanup/recovery exists for interrupted exports.
- No measured large-workspace import/export performance benchmark was found. Existing database, graph, retrieval and UI benchmarks may inform profiling harnesses, but they do not prove import/export scalability.

### Implemented in the current Phase 29 work

- New `nodus-portable-export` manifest v1 in `src/storage/portable/manifest.ts`; exact bytes, SHA-256, canonical digest, resource type-scoped identities, normalized path/identity checks, version/required-feature handling, and full output completeness validation.
- `FileSystemVault.snapshotForPortableExport()` snapshots all managed resource classes under one vault root lock. Export writes after lock release, declares `cooperating-nodus-writers`, and aborts if the strict source snapshot cannot be read.
- Supported resources include notes, database definitions, saved views, managed attachments, property catalog, saved-view order, automation definitions/history, template catalog, and visible folders. Unknown ordinary file types, hidden user paths, and symlinks are listed in `excluded`; supported managed resources are copied raw or fail the snapshot.
- `/api/export` uses the same absolute path, allowed-root, and vault-exclusion checks as backup destinations. Settings → Backup & restore has a separate typed-path Portable export action with loading, server-confirmed success, explicit exclusions, and failure feedback. No fake folder-picker or cancellation behavior is presented.
- Existing `planImport` accepts older manifest-free directory exports and validates `nodus-export.json` when present. A malformed or unsupported present manifest fails closed and never falls back to legacy planning.

### Recommended future package direction

Keep ordinary Markdown and attachment files directly inspectable. Future work should make import validate the portable manifest, produce preview/conflict plans bound to source and destination revisions, and consider staged export publication/recovery if supported safely by the filesystem contract. Maintain raw source bytes where no conversion is required.

## Existing tests and performance tools

### Existing relevant test coverage

- `test/storage-portable.test.ts`: directory export/import, round-trip, source parsing, malformed/future content, duplicate IDs, path mismatch/collision, temporary files, unknown frontmatter/Unicode/body preservation, default conflicts, explicit overwrite and unrelated-content retention.
- `test/storage-portable-manifest.test.ts`: manifest required fields/version/features, optional fields, duplicate IDs/paths, invalid kinds/paths, exact checksums/sizes, missing/extra resources, destination conflicts, exclusions, and a lock-ordered concurrent note/schema/attachment snapshot.
- `test/storage-backup.test.ts` and `test/storage-backup-order.test.ts`: manifest versions, digest/count/hash/length checks, missing/tampered/symlinked/invalid paths, BOM/UTF-8 fidelity, restore preview/conflicts, concurrent mutations, stale preflight checks, partial-write reporting, view-order compatibility.
- `test/storage-attachments.test.ts`, `test/ui-attachments.test.ts`, `test/editor-attachments.test.ts`: attachment bytes/types/size/path safety, API upload/read/delete, reference handling, and relative Markdown link behavior.
- `test/metadata-portability.test.ts`: property catalog, note values, views, attachments, portable round trips, malformed/future/duplicate catalog rejection, destination conflicts and legacy catalog behavior.
- `test/database-relations.test.ts`, `test/relation-storage-hardening.test.ts`, `test/database-formulas.test.ts`, `test/database-formula-contract.test.ts`: relation/rollup/formula behavior, diagnostics, source preservation and some backup/portable round trips.
- `test/storage-database-views.test.ts`, `test/database-view-order.test.ts`, `test/database-templates.test.ts`, `test/database-automations-api.test.ts`, `test/storage-template-apply.test.ts`: view/order/template/automation portability and the specialized template transaction path.
- `test/ui-backup.test.ts`, `test/ui-backup-client.test.ts`, `test/ui-backup-flow.test.ts`: backup API and restore UI/client behavior. `scripts/workspace-customization-smoke.mjs`: Playwright portable export Settings failure/loading/retry/success flow. `test/graph-saved-views.test.ts` covers portable graph-view JSON parsing and conflict behavior.

### Missing or limited coverage

- No full-vault import UI/API/browser end-to-end workflow exists to test today. Portable export is covered by a Playwright Settings smoke for injected API failure, pending/loading state, retry, success, and manifest/resource presence; cancellation is unsupported.
- No external tool/profile fixtures, conversion golden tests, CSV mapping tests, or import-preview UX tests exist.
- No ZIP/archive tests exist because archive import/export is absent. If introduced, test traversal entries, symlinks, duplicate normalized names, encrypted/unsupported members, compression bombs, size/count limits and interrupted extraction before integration.
- Round-trip tests exist for core notes, frontmatter, attachments and structured schemas, but there is no single complete multi-database package test asserting identity mapping, all relation references, saved views/order, formulas/rollups, templates, property catalog, automations and portability diagnostics as one package contract. Existing subsystem portability tests plus export manifest validation cover these resource families separately.
- Existing tests cover conflict defaults, overwrite, malformed packages and partial write reporting; they do not demonstrate generic import rollback or resumable recovery, because neither is implemented.
- No dedicated large-workspace import/export benchmark or resource bound test was found. Useful existing tools include `pnpm bench:databases`, `pnpm bench:graph`, `pnpm bench:retrieval`, `pnpm bench:database-ui`, and `pnpm analyze:bundle`; add a separate reproducible import/export benchmark rather than inferring portability performance from unrelated projection/UI measures.

## Recommended Phase 29 work packages

These are proposed implementation work packages inside the existing official **Phase 29 — Advanced Import & Export** milestone. They are not new official phases or a change to the roadmap scope.

### Package 1 — Portability contract and safety baseline

- **Objective / user outcome:** Define supported sources/resources, versions, fidelity guarantees, safety bounds and loss reporting before changing formats. Users can tell what an import/export will include and what it may transform.
- **Reuse:** `VaultStorage`, `ImportPlan`, `StorageError`, raw-byte snapshots, existing path/ID validators, backup manifest parsing and current docs/tests.
- **Likely modules:** `src/storage/contracts.ts`, `src/storage/portable/`, `src/storage/backup/backup.ts`, `src/ui-server/dto.ts`, `docs/storage.md`, `docs/phase29-audit.md`.
- **Dependencies:** None; this should precede new behavior.
- **Tests:** Contract fixtures for current v1–v7 backup, current portable directory shape, deterministic diagnostics, source hash binding and resource/byte limits.
- **Data-safety risk:** An inaccurate fidelity promise or changed interpretation of current formats can lose user data.
- **Acceptance:** Documented resource matrix and version policy; no silent unsupported-resource omission; validation errors identify the affected resource/path; legacy fixtures remain readable.

### Package 2 — Coherent, verifiable workspace export

- **Objective / user outcome:** Produce a portable package that is either clearly complete or clearly incomplete and describes all included content.
- **Reuse:** Existing raw-byte entries, managed attachment paths, schema/view/catalog/automation/template serializers, backup checksums, atomic writer and root lock.
- **Likely modules:** `src/storage/fs/vault.ts` snapshot contract, `src/storage/portable/export.ts`, manifest DTOs/types, export route/UI, docs.
- **Dependencies:** Package 1 contracts; decide snapshot lock/coherence strategy before manifest implementation.
- **Tests:** Cross-resource consistent snapshot under concurrent Nodus writes, manifest inventory/hash verification, interrupted target behavior, empty/nonempty target protection, attachments/relative links, large fixture measurements.
- **Data-safety risk:** Mixed-version resource snapshots, partial output mistaken for success, overwriting a destination.
- **Acceptance:** Export either publishes a verifiable complete package or reports its incomplete staging location; package manifest matches files; empty-target/containment protections remain; Markdown and attachments remain independently usable.

**Current status:** The v1 manifest, checksums/sizes, pre-publication completeness check, lock-coherent Nodus snapshot, explicit exclusions, export API/client/Settings action, legacy directory import compatibility, and Playwright Settings flow are implemented. The export writes directly into an initially empty destination; on failure that known destination can contain partial files without a completion manifest, but there is no staging rename or automatic recovery. This does not yet meet the stronger “reports its incomplete staging location” acceptance wording via a structured failure DTO, and no large-workspace benchmark is included. Phase 29 remains in progress.

### Package 3 — Import validation and preview progress

`planImport` now detects and validates the shared portable v1 manifest when present, verifies completeness/checksums, and cross-checks parsed resource identity/type/path against the manifest. Legacy manifest-free imports continue through the existing planner. `previewImport` compares a validated plan against a single active-vault snapshot and labels new, identical, and conflicting resources without writes. `POST /api/import/preview` is restricted to existing allowed source roots; Settings exposes a typed-path, read-only preview with counts and warnings. No import action was added.

At Phase 29C acceptance, direct HTTP tests covered valid portable and legacy previews, malformed manifest failure, missing/disallowed/relative paths, structured path diagnostics, a destination hash inventory, and proved preview did not execute an import. Playwright coverage then covered typed source entry, controlled loading, counts, new/identical/conflict rendering, warnings, structured API failure, retry, and absence of an apply action at that milestone. Phase 29D adds a separate explicit execution route. Database preview diagnostics reuse `projectRelations` and `diagnoseDatabaseView` for missing relation targets, invalid reverse-relation references, broken formula references, rollups with missing relation sources, invalid Calendar date references, missing saved-view references, incompatible filters, and invalid grouping.

Remaining limits: malformed database definitions and invalid template catalogs reject the preview rather than being accumulated into a successful preview warning list; a missing template reference is therefore a structured error path, not a per-template warning. Phase 29C was accepted by the owner on 2026-11-05 with its preview freshness limitation carried into Phase 29D. The Phase 29D implementation in the isolated worktree adds reviewed execution and recoverable publication; final D.6 verification and owner acceptance remain pending.

### Phase 29D.1 — Execution contract and freshness validation

**Status:** Implemented and retained as the basis for execution in the isolated `feature/phase-29d-1-import-freshness` worktree; no commit or push has been made.

- Portable planning now verifies exact byte length and SHA-256 of every parsed resource against the manifest, including the exact bytes used for Markdown/JSON decoding. It also rechecks the exact manifest bytes and portable file/folder inventory after parsing so source changes observed during planning fail closed.
- Preview source fingerprint is deterministic SHA-256 over the canonical sorted importable resource identity/path/size/content-hash tuples, exact manifest-byte hash for portable packages, visible folder inventory, format, and portable exclusion list. Legacy fingerprints cover only resources/folders recognized by the existing importer; arbitrary unrecognized files are not imported and are not represented as resources.
- Destination fingerprint is deterministic SHA-256 over the lock-coherent `snapshotForPortableExport()` resource identities/paths/sizes/content hashes, property catalog, saved-view ordering, automation/template resources, visible folders, and exclusions.
- `POST /api/import/preview` returns a 256-bit random opaque `previewId` and expiry (five minutes). Middleware keeps at most 64 process-local sessions and evicts expired/oldest entries. Restarting the process invalidates all handles. Preview remains read-only.
- The server-side contract binds canonical source and destination roots, both fingerprints, and each conflict's source/destination content hash and permitted choices. Conflict-decision validation requires one explicit decision per conflict and rejects any choice outside the recorded safe set; replace remains restricted to the previewed matching resource identity and path.
- `validateImportPreviewFreshness` rereads/replans the source and captures a fresh destination snapshot, rejecting changed paths, bytes, folders, manifest, or vault selection as `STALE_PREVIEW`; expired handles are `PREVIEW_EXPIRED` (HTTP 409). Invalidated source packages require a fresh preview and diagnostics.

**Concurrency boundary:** destination snapshots are coherent against Nodus writers that honor the vault root lock. External filesystem writers are not blocked. The freshness function is an observation, not authorization to write. D.2/D.3 execution rebuilds the source plan and stages exact in-memory validated bytes, then revalidates the destination under the root lock through publication and final verification. Arbitrary external writers can still race a replacement between its final hash check and atomic rename; this cannot be made a portable filesystem compare-and-swap with current primitives. Additions use exclusive hard links, and recovery refuses to alter paths whose inode/hash ownership is ambiguous.

### Phase 29D.2–29D.5 — Reviewed execution, recovery, API, and UI

**Status:** Implemented in this worktree; final D.6 verification remains in progress. These changes do not alter the original checkout and have not been committed or pushed.

- `POST /api/import/execute` accepts only a one-use server-side preview handle, explicit confirmation, and one add/skip/replace decision per previewed resource. The server rechecks the allowed source root and reparses the package. Storage binds execution to the exact destination vault path and rechecks the full destination snapshot under the vault root lock before any publication.
- Exact validated resource bytes are copied to a private mode-restricted staging directory and reverified by size and SHA-256. Replacements have verified preimage copies. The durable transaction journal records source/destination fingerprints, decisions, file states, baseline inventory, resource hashes, staged/backup names, and folder ownership. Journal structure and digest are checked before status/recovery/retry operations.
- Adds use exclusive hard-link publication from staged bytes. Replace requires the previewed kind, ID, exact path, and destination hash; the preimage is retained and the existing atomic writer is used. Destination and source parsers plus relation/formula/rollup/view/automation/template dependency checks run before publication. Empty and required parent folders are tracked and recreated.
- Multi-file publication is recoverable but not package-atomic. Final success is reported only after re-reading and hashing all selected resources. Failed or interrupted publication leaves a journal; rollback removes additions only when staged inode ownership matches and restores replacements only when published inode ownership and backup hash match. Created folders are removed only if their inode matches and they remain empty. Retry uses staged bytes only after the workspace matches the recorded baseline plus provably operation-published resources. Ambiguous states remain visible for manual inspection.
- The API exposes operation list/status, explicit safe rollback, and explicit retry. Settings → Backup & restore now presents explicit per-resource choices, separate replacement consent, confirmation, request loading and server-confirmed completion, errors, and pending/corrupt recovery entries. It has no drag-to-import, streaming progress, or cancellation; the request is synchronous and does not claim per-resource live progress.
- Storage health reports unfinished/corrupt import journals so they are discoverable outside the Backup & restore panel. Journal cleanup/retention is intentionally not automatic; committed operation history and replacement backups remain until a future reviewed cleanup policy exists.

### Phase 29D.6 — Reliability and acceptance

**Status:** Verification in progress. Acceptance is not claimed until the final required suite, typecheck, browser smokes, external build, and diff checks have passed on the final source state and remaining limitations are reviewed.

Known residual constraints: cooperating Nodus writes are serialized; external filesystem writes are not. The replacement inode and exact atomic-temp basename are now journaled before rename; real restart tests verify owned temp cleanup before rename and rollback after rename. External writers can still race filesystem operations. A crash after creating an operation directory but before its initial journal is durably written may leave an unreadable orphan directory; publication has not started in that window, and manual preservation/inspection is required. A killed process can also leave the vault root lock; Nodus deliberately does not auto-steal it, so recovery requires the documented manual stale-lock procedure before the recovery UI/API can acquire the vault. The journal digest is corruption detection, not a keyed authenticity signature. The UI has a loading state but no live percentage, stream, or cancellation. Journals, staged payloads, and replacement backups are retained indefinitely; no cleanup policy is implemented. The portable source is a directory package; archive import remains unsupported. Resource limits are now enforced: 10,000 resources, 20,000 filesystem inventory entries, 64 MiB/resource, 256 MiB total resource bytes, a 16 MiB portable manifest, and 64 path segments. The measured planning/preview workload and restart evidence are recorded in `docs/phase29d-handoff.md`.

**Verification added:** `test/storage-portable-freshness.test.ts` checks stable fingerprints, changed portable and legacy source rejection, changed destinations, bounded/expiring/one-use handles, and decisions. `test/storage-import-execution.test.ts` checks exact staging, explicit replacement, stale destination/root rejection, partial failure rollback, interrupted recovery, external edit preservation, staged retry, folder preservation, dependency rejection, and injected ENOSPC while finalizing staged state. `test/storage-import-limits.test.ts` checks count, per-resource, package-byte, path-depth, and pre-parse inventory enforcement. `test/ui-import-preview-api.test.ts` covers execute/status/reuse behavior. The real process/browser recovery smoke is `pnpm run test:import-recovery`; it kills and restarts an API child during staging, addition publication, replacement rename, and rollback, and verifies ambiguous external edits remain untouched. See [Phase 29D handoff](phase29d-handoff.md) for final command results after D.6 verification.

### Package 3 — Import validation and preview/conflict plan

- **Objective / user outcome:** Let users inspect a source and understand additions, skipped items, conversions, unresolved references and conflicts before changing the vault.
- **Reuse:** `planImport`, `ImportPlan`, `previewRestore` patterns, schema/note/view parsers, relation/formula diagnostics, existing backup UI primitives.
- **Likely modules:** `src/storage/portable/import.ts`, vault planning contracts, `src/ui-server/api.ts`, `src/ui-server/dto.ts`, `ui/src/api.ts`, a focused shadcn-based import review UI.
- **Dependencies:** Package 1 resource contract; Package 2 manifest if portable package depends on it.
- **Tests:** No-write preview; stale source/destination revision; malformed and future versions; duplicate IDs/paths; collision choice matrix; missing schema/relation/attachment cases; accessible browser preview and retry.
- **Data-safety risk:** Preview/apply drift or broad overwrite choices hiding conflict semantics.
- **Acceptance:** Preview is read-only, resource diagnostics are reviewable, and safe choices are conservative; an eventual apply must bind to source/destination revisions and reject stale plans; no default overwrite.

### Package 4 — Markdown and attachment migration profiles

- **Objective / user outcome:** Import/export supported Markdown folder packages and attachments while preserving source content and clearly reporting transformations.
- **Reuse:** `parseNote`, raw Markdown storage, managed attachment validator, relative link helpers, `planImport` path rules and attachment browser workflow.
- **Likely modules:** `src/storage/portable/`, format adapters under a narrow import/export boundary, preview UI/API, fixture directories under `test/fixtures`.
- **Dependencies:** Packages 1 and 3; only add a product profile when real fixtures and expected semantics are available.
- **Tests:** Golden fixtures for frontmatter (including unknown fields), Unicode/BOM/CRLF, links, missing/duplicate attachments, nested paths, filename collisions, unsupported syntax, preservation/loss report.
- **Data-safety risk:** Rewriting source metadata/links or moving files incorrectly can break external workflows and attachment references.
- **Acceptance:** Supported profiles are fixture-backed; unchanged content remains byte-preserved where possible; every transformation/loss is previewed; external compatibility claims are limited to tested fixtures.

### Package 5 — Structured database portability and identity mapping

- **Objective / user outcome:** Move schemas and records with useful saved views, relations and computed definitions intact, including a clear way to clone or map identities where required by the approved product flow.
- **Reuse:** `parseDatabase`, `projectNoteProperties`, relation diagnostics, formula validation, saved-view/order parsers, template database serializer and raw note storage.
- **Likely modules:** `src/database/schema.ts`, `note-properties.ts`, `relations.ts`, `formula-engine.ts`, `database-view.ts`, `database-view-order.ts`, portable planner/apply, DTO/UI.
- **Dependencies:** Package 3 conflict and mapping plan; schema mapping must precede record/reference rewrites. Do not introduce ID remapping unless the roadmap-approved user flow requires it.
- **Tests:** Multi-database package round trip, select option mapping, records/IDs, forward and reverse relation references, missing targets, rollup/formula recomputation, views/filters/sort/group/calendar configs/order, template behavior, no source mutation.
- **Data-safety risk:** Partial ID remapping can orphan relations or make saved views point at the wrong property/database.
- **Acceptance:** Same-identity portable packages preserve all stable IDs and values; any new-identity workflow produces a complete deterministic mapping and zero silent reference rewrites; derived values are recomputed, not stored as authoritative data.

### Package 6 — Apply recovery, diagnostics, and performance acceptance

- **Objective / user outcome:** Make failures understandable and recoverable, and set evidence-based limits for large local workspaces.
- **Reuse:** Existing template apply transaction journal/recovery, `StorageHealth`, `PARTIAL_WRITE`, database benchmarks, test temp-vault helpers and browser smoke patterns.
- **Likely modules:** `src/storage/fs/vault.ts`, transaction journal/recovery helpers, storage health DTO/UI, import flow, benchmark scripts and tests.
- **Dependencies:** Packages 2–5 define staged files and apply plans.
- **Tests:** Fault injection at each stage, restart/recovery, preservation of unrelated/conflicting files, idempotent retry/resume, filesystem/path adversarial cases, synthetic size scaling and memory measurements.
- **Data-safety risk:** A recovery protocol that deletes ambiguous user files, replays stale intent, or falsely claims rollback.
- **Acceptance:** Every failed apply reports exact changed/uncertain paths and a safe next action; recovery never overwrites a changed target; large-workspace limits are measured and documented; no cloud dependency is required.

## Risks and decision points

1. **Import identity policy:** Preserve IDs for restore/same-workspace portability. Decide whether Phase 29 needs a clone-with-remapping flow; do not silently reassign record IDs because relation and view references depend on them.
2. **Transaction scope:** Existing per-file atomicity is not a package transaction. Decide whether to stage/rename a whole package, maintain a rollback journal, or expose resumable partial state; document filesystem limits and external-writer races.
3. **Snapshot semantics:** Portable export now represents one lock-ordered logical snapshot for cooperating Nodus writers. Direct external filesystem edits remain outside that guarantee; a future filesystem snapshot or immutable-copy prerequisite would be needed to close that boundary.
4. **Format boundaries:** Keep backup/recovery validation distinct from the portable manifest and future external interchange adapters. Keep plain Markdown visible and portable alongside package metadata.
5. **Unknown data:** Existing parsers preserve unknown note frontmatter values in supported note documents but strict versioned Nodus envelopes reject unknown keys. A migration adapter needs an explicit preserve/warn/reject policy for fields unknown to Nodus.
6. **Documentation drift:** `src/properties/catalog.ts` still has a comment describing portable backup/export integration as a later milestone, although current export/import code includes the catalog. Reconcile this stale comment when implementation work touches that boundary; this audit does not alter source.
7. **Resource bounds:** Directory imports can contain large files/workspaces; if archives are ever approved, add compressed and expanded bounds, file count, path depth, duplicate normalized path, and decompression controls before extraction.
8. **Optional workspace state:** Decide whether graph preferences or browser-local workspace preferences belong in an export. They are currently separate from vault data; do not imply they are included.
9. **Local-first requirement:** Import/export and recovery must remain fully local; no mandatory authentication, hosted database, Supabase, or collaboration service is appropriate to this milestone.

## Exact source and test files inspected

The following files were inspected directly for this audit:

- `src/storage/portable/export.ts`, `src/storage/portable/import.ts`
- `src/storage/backup/backup.ts`, `src/storage/contracts.ts`, `src/storage/index.ts`
- `src/storage/fs/vault.ts`, `src/storage/fs/scan.ts`, `src/storage/fs/attachments.ts`, `src/storage/fs/layout.ts`, `src/storage/fs/safe-path.ts`, `src/storage/fs/atomic.ts`, `src/storage/fs/root-lock.ts`
- `src/format/note-format.ts`, `src/database/schema.ts`, `src/database/note-properties.ts`, `src/database/relations.ts`, `src/database/database-view.ts`, `src/database/database-view-order.ts`, `src/database/formula-engine.ts`, `src/database/automations.ts`, `src/database/templates.ts`, `src/properties/catalog.ts`
- `src/ui-server/api.ts`, `src/ui-server/dto.ts`, `src/index.ts`
- `ui/src/BackupRestoreSection.tsx`, `ui/src/backupRequest.ts`, `ui/src/backupRestore.ts`, `ui/src/GraphSavedViews.tsx`, `ui/src/graph-saved-views.ts`, `ui/src/editor/AttachmentBrowser.tsx`, `ui/src/api.ts`
- `test/storage-portable.test.ts`, `test/storage-backup.test.ts`, `test/storage-backup-order.test.ts`, `test/storage-attachments.test.ts`, `test/ui-attachments.test.ts`, `test/editor-attachments.test.ts`, `test/metadata-portability.test.ts`, `test/database-relations.test.ts`, `test/relation-storage-hardening.test.ts`, `test/database-formulas.test.ts`, `test/database-formula-contract.test.ts`, `test/storage-database-views.test.ts`, `test/database-view-order.test.ts`, `test/database-templates.test.ts`, `test/database-automations-api.test.ts`, `test/storage-template-apply.test.ts`, `test/storage-reliability.test.ts`, `test/graph-saved-views.test.ts`, `test/ui-backup.test.ts`, `test/ui-backup-client.test.ts`, `test/ui-backup-flow.test.ts`
- `package.json`, `docs/ROADMAP.md`, `docs/storage.md`, `docs/README.md`, `docs/note-format.md`, `docs/database-format.md`, `docs/database-relations.md`, `docs/database-formulas.md`, `docs/database-views.md`, `docs/templates.md`, `docs/property-format.md`, `docs/structured-data-performance.md`

No source code, tests, vault data, backup data, or generated assets were modified for this audit.
