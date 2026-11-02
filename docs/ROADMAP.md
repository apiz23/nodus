# Nodus Master Development Roadmap

**Status:** Living document — single source of truth for project history, current state, and proposed work.

**Last updated:** 2026-11-02
**Latest verified implementation commit:** `3952db3` — Phase 18L implementation; prior integrated baseline was `a481276`.
**Repository:** `apiz23/nodus` (`origin`)
**Roadmap owner:** project maintainer

> This document records what exists, what was completed, what still needs review, and what is only proposed.
> A feature appearing under “Future milestones” is **not** implemented. A feature appearing in the feature inventory **is** implemented unless explicitly marked otherwise.

---

## MANDATORY WORKFLOW FOR FUTURE CODING AGENTS

Every coding agent working on Nodus must complete these steps before, during, and after a task.

1. **Read `AGENTS.md`.** It contains the standing shadcn/ui reuse policy and working-tree safety rules.
2. **Read this roadmap (`docs/ROADMAP.md`) before starting any task.** Check the milestone history, feature inventory, architecture decisions, known limitations, and session log.
3. **Inspect the relevant source code and tests.** Documentation can lag behind code. Verify behavior in `src/`, `ui/src/`, `test/`, and `scripts/`.
4. **Check whether the requested feature already exists.** Search this roadmap and the implementation before designing anything.
5. **Reuse existing implementations instead of duplicating them.** Extend the existing storage contracts, database model, query helpers, editor primitives, and shadcn/ui compositions.
6. **Identify dependencies and potential regressions.** Read the affected contracts, format versions, tests, and this document’s risk register.
7. **Update this roadmap when implementation status changes.** Update existing sections; do not create a competing roadmap file.
8. **Record newly discovered limitations and architectural decisions.** Add them to the relevant section and the session log.
9. **Run relevant tests and verification.** At minimum, run the focused tests for the changed area. Run `pnpm test`, `pnpm typecheck`, and `pnpm build` when the change is broad.
10. **Report exactly what changed and what remains incomplete.** Do not describe planned work as delivered work.

### Additional non-negotiable rules

- Never assume a planned feature is already implemented.
- Never reimplement an existing capability without a documented reason.
- Never remove existing functionality to simplify a new implementation.
- Do not introduce unnecessary dependencies.
- Do not silently change existing data formats or contracts.
- Do not mark milestones complete without actual verification.
- Do not start a dependent phase while its prerequisites are incomplete without documenting the decision.
- Preserve unrelated user changes in the working tree.
- Do not reset, clean, stage, commit, or push unrelated files.
- Do not implement a future phase merely because it is listed here. Future phases are proposals, not commitments.

---

## Table of Contents

1. [How to Read This Roadmap](#1-how-to-read-this-roadmap)
2. [Current State at a Glance](#2-current-state-at-a-glance)
3. [Completed and Historical Milestones](#3-completed-and-historical-milestones)
   - [3.1 Milestone Summary](#31-milestone-summary)
   - [Phase 1 — Application Foundation and Domain Model](#phase-1--application-foundation-and-domain-model)
   - [Phase 2 — Vault and Storage](#phase-2--vault-and-storage)
   - [Phase 2A — Markdown Editor](#phase-2a--markdown-editor)
   - [Phase 3 — Relay and Sync Foundation (Experimental)](#phase-3--relay-and-sync-foundation-experimental)
   - [Phase 4 — Navigation and Organization](#phase-4--navigation-and-organization)
   - [Phase 5 — UX and Workspace Polish](#phase-5--ux-and-workspace-polish)
   - [Phase 6 — Search and Discovery](#phase-6--search-and-discovery)
   - [Phase 7A — Metadata, Catalogs, and Portability](#phase-7a--metadata-catalogs-and-portability)
   - [Phase 7B — Database Foundation and Saved Views](#phase-7b--database-foundation-and-saved-views)
   - [Phase 7C — Relations and Rollup Foundation](#phase-7c--relations-and-rollup-foundation)
   - [Phase 7D — Formula Engine and Authoring](#phase-7d--formula-engine-and-authoring)
   - [Phase 8 — Storage Reliability and Cross-Process Coordination](#phase-8--storage-reliability-and-cross-process-coordination)
   - [Phase 9 — Database Performance and Caching (Needs Review)](#phase-9--database-performance-and-caching-needs-review)
   - [Phase 10 — Gallery and Persistent Saved-View Ordering](#phase-10--gallery-and-persistent-saved-view-ordering)
   - [Phase 11A — Relation Lifecycle and Layout Coverage](#phase-11a--relation-lifecycle-and-layout-coverage)
   - [Phase 11B — Aggregate Rollups and Relation Search](#phase-11b--aggregate-rollups-and-relation-search)
   - [Phase 11C — Relation-Aware Formulas](#phase-11c--relation-aware-formulas)
   - [Phase 12 — Database Automations](#phase-12--database-automations)
   - [Phase 13 — Templates and Database Templates](#phase-13--templates-and-database-templates)
   - [Phase 15P — Productivity and Command Experience](#phase-15p--productivity-and-command-experience-delivered-track)
   - [Phase 14 — Template Reliability and Vault Health Integration](#phase-14--template-reliability-and-vault-health-integration)
   - [Phase 16 — Markdown Editor Enhancements](#phase-16--markdown-editor-enhancements)
   - [Phase 17G — Knowledge Graph and Relationship Exploration](#phase-17g--knowledge-graph-and-relationship-exploration)
   - [Phase 18L — Link Integrity and Repair](#phase-18l--link-integrity-and-repair)
4. [Proposed Future Milestones (Phases 15 and 17–34)](#4-proposed-future-milestones-phases-15-and-17-34)
   - [Future Milestone Summary](#future-milestone-summary)
     - [Phase 15 — Advanced Database Queries](#phase-15--advanced-database-queries)
     - [Phase 17 — Database Protection and Safeguards](#phase-17--database-protection-and-safeguards)
     - [Phase 18 — Tasks and Project Management](#phase-18--tasks-and-project-management)
     - [Phase 19 — Calendar and Timeline Improvements](#phase-19--calendar-and-timeline-improvements)
     - [Phase 20 — Notifications and Reminders](#phase-20--notifications-and-reminders)
     - [Phase 21 — Import and Migration](#phase-21--import-and-migration)
     - [Phase 22 — Plugin and Extension Architecture](#phase-22--plugin-and-extension-architecture)
     - [Phase 23 — Graph View](#phase-23--graph-view)
     - [Phase 24 — Backlinks and Knowledge Discovery](#phase-24--backlinks-and-knowledge-discovery)
     - [Phase 25 — Advanced Markdown](#phase-25--advanced-markdown)
     - [Phase 26 — Whiteboards and Visual Workspace](#phase-26--whiteboards-and-visual-workspace)
     - [Phase 27 — Advanced Search](#phase-27--advanced-search)
     - [Phase 28 — AI Integration](#phase-28--ai-integration)
     - [Phase 29 — Sync Architecture](#phase-29--sync-architecture)
     - [Phase 30 — Conflict Resolution](#phase-30--conflict-resolution)
     - [Phase 31 — Mobile Experience](#phase-31--mobile-experience)
     - [Phase 32 — Security and Privacy](#phase-32--security-and-privacy)
     - [Phase 33 — Performance and Scalability](#phase-33--performance-and-scalability)
     - [Phase 34 — Release Preparation](#phase-34--release-preparation)
5. [Feature Inventory](#5-feature-inventory)
6. [Architecture and Technical Decision Records](#6-architecture-and-technical-decision-records)
7. [Data and Format Compatibility Matrix](#7-data-and-format-compatibility-matrix)
8. [Verification and Development Tooling](#8-verification-and-development-tooling)
9. [Known Limitations and Risk Register](#9-known-limitations-and-risk-register)
10. [Development Session Log](#10-development-session-log)
11. [Roadmap Maintenance Rules](#11-roadmap-maintenance-rules)

---

## 1. How to Read This Roadmap

### Status vocabulary

| Status | Meaning |
|---|---|
| **COMPLETE** | Implemented in committed code and covered by verification. Limitations may still exist and are listed. |
| **COMPLETE WITH LIMITATIONS** | Delivered and verified, but a documented gap is intentional or accepted. |
| **PARTIAL** | A meaningful subset exists; the milestone’s full scope is not delivered. |
| **NEEDS REVIEW** | Implementation exists, but completeness, correctness, or performance has open questions that must be resolved before calling it done. |
| **IN_PROGRESS** | Work exists only in the working tree, is uncommitted, or is explicitly still being built. |
| **PLANNED** | Proposed, not started. No implementation should be assumed. |
| **READY** | Proposed and unblocked by prerequisites, but not started. |
| **BLOCKED** | Cannot start until a named dependency or decision is resolved. |

### Evidence conventions

- **Commit hashes** are abbreviated Git hashes verified with `git log` at the time of writing.
- **Source paths** are repository-relative and point to the implementation, not to a proposal.
- **Tests** are listed by file; passing status is recorded only after an actual run.
- **Phase labels:** the repository uses `Phase 2A` for the editor, `Phase 3` for the experimental relay foundation, `Phase 7A–7D` for metadata/views/relations/formulas, `Phase 8D` for a bundle recheck, and `Phase 11A–11C` in tests/scripts. Phase 4–6 and Phase 10 are reconstructed from commit chronology and are marked as inferred where relevant.
- **No feature is complete merely because a document says so.** Where documentation and code disagree, this roadmap follows code and records the drift.

### Scope of this document

This roadmap covers the application, storage, database, editor, search, UI, tests, and the experimental sync layer. It does not authorize product implementation. A future phase begins only after its objective, dependencies, and acceptance criteria are reviewed and approved.

---

## 2. Current State at a Glance

| Area | State | Primary evidence |
|---|---|---|
| Markdown notes | **Implemented** | `src/domain/note.ts`, `src/format/note-format.ts`, `ui/src/editor/**` |
| Filesystem vault | **Implemented with documented limits** | `src/storage/fs/vault.ts`, `docs/storage.md` |
| Portable export/import | **Implemented** | `src/storage/portable/`, `test/storage-portable.test.ts` |
| Backup/restore | **Implemented; manifest v7, reads v1–v7** | `src/storage/backup/backup.ts` |
| Atomic writes and conditional writes | **Implemented** | `src/storage/fs/atomic.ts`, `src/storage/fs/root-lock.ts`, `expectedHash` contracts |
| Cross-process vault lock | **Implemented for cooperating Nodus processes only** | `src/storage/fs/root-lock.ts`, `test/storage-root-lock.test.ts` |
| Markdown editor | **Implemented with Phase 16 outline and table editing** | `ui/src/editor/CodeMirrorEditor.tsx`, `ui/src/Editor.tsx`, `ui/src/editor/documentOutline.ts` |
| Search | **Implemented as in-memory derived index with TTL** | `src/search/`, `src/indexing/snapshot-cache.ts`, `docs/global-search.md` |
| Wiki links, backlinks, graph | **Implemented, with explicit repair and rename-safe title links** | `src/links/`, `ui/src/BacklinksPanel.tsx`, `ui/src/DiscoveryView.tsx`, `ui/src/GraphView.tsx` |
| Database schemas | **Implemented, versions 1–3** | `src/database/schema.ts` |
| Database rows | **Implemented as derived projections from `nodus_data`** | `src/database/note-properties.ts` |
| Saved views | **Implemented, versions 1–3; table/list/kanban/calendar/gallery** | `src/database/database-view.ts`, `ui/src/DatabaseLayouts.tsx` |
| Relations and rollups | **Implemented** | `src/database/relations.ts`, `src/database/relation-contract.ts` |
| Formula engine | **Implemented** | `src/database/formula-*.ts`, `ui/src/database/FormulaEditor*.tsx` |
| Database automations | **Implemented with documented limits** | `src/database/automations.ts`, `ui/src/DatabaseAutomations.tsx`, `docs/database-automations.md` |
| Note and database templates | **Implemented with documented limits** | `src/database/templates.ts`, `ui/src/TemplatesView.tsx`, `docs/templates.md` |
| Command palette, shortcuts, recent notes | **Implemented with documented limits** | `ui/src/CommandPalette.tsx`, `ui/src/shortcuts.ts`, `ui/src/recentNavigation.ts`, `docs/shortcuts.md` |
| Relay/sync | **Experimental and unwired** | `src/relay/`, `src/sync/`, `docs/phase3/` |
| Local UI API | **Implemented, loopback-only with origin and path allow-lists** | `src/ui-server/api.ts`, `ui/vite.config.ts` |
| Test suite | **100 files / 1,155 executed tests** (Phase 18L integration) | `test/` |
| CI pipeline | **Not present** | no `.github/` workflow |
| Performance guarantees | **Not enforced in CI; measurements are historical** | `docs/structured-data-performance.md`, benchmarks |

**Current working tree caveat:** verify `git status` before starting work. Uncommitted typography/editor changes and untracked `.agents/`, `.impeccable/`, `.pnpm-store/`, and `skills-lock.json` content have existed outside earlier phase commits and must be preserved. Phase 18L was delivered from a clean worktree created from `origin/main`; the original `main` worktree with those changes was left untouched.

**Verified verification state for this document:** Phase-specific verification is recorded in each milestone and the integration session log below.

- Phase 18L: serial full suite passed, **100 files / 1,155 tests**; focused repair/discovery suite passed, 5 files / 33 tests.
- Phase 18L: typecheck, build, browser, database-view, vault-onboarding, discovery/graph smokes, graph benchmark, and `git diff --check` passed. Local browser checks used loopback access.
- Production build reports the App chunk at 799.91 kB (796.92 kB at the Phase 17 baseline). The advisory remains; no bundling refactor was made.
- Phase 17G baseline: serial full suite passed, 98 files / 1,137 tests; graph benchmark recorded 78.45 ms for 5,000 notes / 15,000 links.

---

## 3. Completed and Historical Milestones

### 3.1 Milestone Summary

| Phase | Name | Status | Key commits |
|---|---|---|---|
| 1 | Application foundation and domain model | COMPLETE | `aa7bac8` |
| 2 | Vault and storage | COMPLETE | `aa7bac8`, `0bae973`, `a91b02f` |
| 2A | Markdown editor | COMPLETE WITH LIMITATIONS | `4de6c70`, `7305eb0` |
| 3 | Relay and sync foundation | PARTIAL — experimental, unwired | `aa7bac8` and follow-ups |
| 4 | Navigation and organization | COMPLETE | `8a34823`, `ff0ec55`, `d110092`, `8d52c8c` |
| 5 | UX and workspace polish | COMPLETE WITH LIMITATIONS | `92fbe86`, `7601437`, `f05c33c`, `c34b9b8`, `9ffe814` |
| 6 | Search and discovery | COMPLETE WITH LIMITATIONS | `266647d`, `49bd8f4`, `47dacb6`, `7a3a419`, `ba0bfe6` |
| 7A | Metadata, catalogs, and portability | COMPLETE | `18aa1e4`, `49d20a5`, `b8226a1`, `34b895a`, `954dfcd` |
| 7B | Database foundation and saved views | COMPLETE | `f47c7cf`, `7e9eb99`, `85703df`, `aa7c58d`, `3c5bdf1`, `e8b299c` |
| 7C | Relations and rollup foundation | COMPLETE | `a30a997`, `6041cf6` |
| 7D | Formula engine and authoring | COMPLETE | `6041cf6`, `53dc8be` |
| 8 | Storage reliability and cross-process coordination | COMPLETE WITH LIMITATIONS | `e741c76`, `3dcb79c`, `6cef715`, `1363c28`, `440ec85` |
| 9 | Database performance and caching | **NEEDS REVIEW** | `7a3a419`, `ba0bfe6`, `4532618`, `53dc8be` |
| 10 | Gallery and persistent saved-view ordering | COMPLETE | `5913d61` |
| 11A | Relation lifecycle and layout coverage | COMPLETE | `214abe7` |
| 11B | Aggregate rollups and relation search | COMPLETE | `12678e5`, `b1379ad` |
| 11C | Relation-aware formulas | COMPLETE WITH DOCUMENTATION DEBT | `45eab83`, `02e6215` |
| 12 | Database automations | COMPLETE WITH LIMITATIONS | `a1466ae` |
| 13 | Templates and Database Templates | COMPLETE WITH LIMITATIONS | `18539bb` |
| 14 | Template reliability and vault health integration | COMPLETE WITH LIMITATIONS | `feat: improve template reliability and vault health` |
| 16 | Markdown editor enhancements | COMPLETE WITH LIMITATIONS | `4f1ed22` |
| 15P | Productivity and command experience | COMPLETE WITH LIMITATIONS | `2f8e41e` |
| 17G | Knowledge graph and relationship exploration | COMPLETE WITH LIMITATIONS | `df89954` |
| 18L | Link integrity and repair | COMPLETE WITH LIMITATIONS | Phase 18 delivery commit |

---

### Phase 1 — Application Foundation and Domain Model

**Objective:** Establish a portable, I/O-free core for notes, paths, IDs, wiki links, database schemas, validation errors, and migrations.

**Implemented functionality**

- Note format version 1: YAML frontmatter, title, tags, aliases, timestamps, stable `nodus.id`, preserved unknown top-level keys, strict rejection of unknown `nodus` keys.
- Stable UUID v4 identity; deterministic path-derived ID for plain Markdown with no frontmatter.
- Workspace-relative POSIX path validation and reserved-name rejection.
- Wiki-link parsing and resolution contracts (`resolved`, `unresolved`, `ambiguous`).
- Database definition format version 1 with base property types: `text`, `number`, `checkbox`, `date`, `select`, `multi-select`.
- Structured `NodusError` codes and a migration contract.

**Important source files**

- `src/domain/note.ts`, `src/domain/ids.ts`, `src/domain/paths.ts`, `src/domain/tags.ts`, `src/domain/errors.ts`
- `src/format/note-format.ts`, `src/format/migration.ts`
- `src/links/wikilink.ts`
- `src/database/schema.ts`
- `docs/note-format.md`, `docs/wiki-links.md`, `NODUS_PHASE1_PLAN.md`

**Tests and verification**

- `test/note-format.test.ts` (format, frontmatter, plain Markdown IDs, BOM/CRLF, version rejection)
- `test/migration.test.ts`
- `test/paths.test.ts`
- `test/tags.test.ts`
- `test/database.test.ts` (base schema v1)
- `test/wikilink.test.ts`

**Commits**

- `aa7bac8` — first commit; contains the domain, format, schema, and wiki-link foundation.

**Known limitations**

- No persisted vault metadata, folder entity, or attachment metadata.
- Note identity for plain Markdown depends on path until a Nodus-managed move adds frontmatter.
- No migration has been required yet; the migration contract exists but no version transition is implemented.

**Status:** **COMPLETE WITH LIMITATIONS**

---

### Phase 2 — Vault and Storage

**Objective:** Add a filesystem-backed vault with safe paths, atomic writes, portable export/import, and verified backup/restore.

**Implemented functionality**

- `VaultStorage` contracts independent of Node and the filesystem.
- `FileSystemVault` implementation: create, read, update, move, and delete notes and database definitions.
- Vault-level duplicate-ID detection and path-collision checks.
- Symlink rejection, hidden-path exclusion, reserved `databases/` and `database-views/` namespaces.
- Per-file atomic replacement: temporary sibling, write, `fsync`, rename.
- Read-only import planning and conflict-safe apply.
- Byte-for-byte export mirror and byte-for-byte backups with a SHA-256 manifest written last.
- Restore validation, conflict preview, and explicit-overwrite behavior.
- Health reporting for malformed documents, duplicate IDs, unsafe paths, and leftover temporary files.
- Conditional write support (`expectedHash`, `STALE_WRITE`) added in `a91b02f`.

**Important source files**

- `src/storage/contracts.ts`, `src/storage/errors.ts`
- `src/storage/fs/vault.ts`, `src/storage/fs/layout.ts`, `src/storage/fs/atomic.ts`, `src/storage/fs/safe-path.ts`, `src/storage/fs/scan.ts`
- `src/storage/portable/export.ts`, `src/storage/portable/import.ts`
- `src/storage/backup/backup.ts`
- `docs/storage.md`, `PHASE2_REPORT.md`

**Tests and verification**

- `test/storage-vault.test.ts`
- `test/storage-paths.test.ts`
- `test/storage-portable.test.ts`
- `test/storage-backup.test.ts`
- `test/storage-reliability.test.ts`
- `test/storage-root-lock.test.ts` (added with Phase 8 hardening)

**Commits**

- `aa7bac8` — storage foundation.
- `0bae973` — `ENOTDIR` safe-path handling.
- `a91b02f` — conditional writes, revision hashes, vault allow-list, TOCTOU narrowing.

**Known limitations**

- Multi-file operations are not transactions; failures can leave `PARTIAL_WRITE`.
- One malformed note blocks strict listing, export, and backup.
- Every ID lookup scans and parses all notes.
- Locking is cooperative and does not protect against external editors.
- Backup manifest version was later extended through v7; see Phase 7A, 10, Phase 12, and Phase 13.

**Status:** **COMPLETE** (foundation; later hardening in Phase 8)

---

### Phase 2A — Markdown Editor

**Objective:** Deliver a raw-Markdown-first live editor with formatting commands, task lists, wiki links, preview, icons, attachments, and draft recovery.

**Implemented functionality**

- CodeMirror 6 editor with Live, Source, and Preview modes.
- Live decorations for headings, emphasis, links, code, lists, blockquotes, tables, and fenced code; syntax marks reveal near the selection.
- Formatting keymap and toolbar: bold, italic, strikethrough, inline code, headings, lists, blockquote, fenced code, links.
- Interactive GFM task lists with undoable source transactions.
- Wiki-link widgets with modifier-click / keyboard open behavior.
- Read-only GFM preview with links, images, tables, task lists, code copy, and escaped HTML.
- Page icons, tags, aliases, and general property editing.
- Managed attachments with paste, drop, upload, reference warnings, and backup/export inclusion.
- Autosave, manual save, stale-write handling, draft recovery, conflict resolution, and external-change detection.
- Homogeneous LF/CRLF preservation (mixed line endings explicitly not preserved).

**Important source files**

- `ui/src/Editor.tsx`, `ui/src/editor/CodeMirrorEditor.tsx`, `ui/src/editor/createEditorState.ts`
- `ui/src/editor/liveMarkdown.ts`, `ui/src/editor/wikiLinks.ts`, `ui/src/editor/taskList.ts`, `ui/src/editor/markdownCommands.ts`
- `ui/src/editor/MarkdownPreview.tsx`, `ui/src/editor/MarkdownToolbar.tsx`
- `ui/src/editor/DraftRecoveryDialog.tsx`, `ui/src/editor/ConflictResolutionDialog.tsx`, `ui/src/editor/ExternalChangeDialog.tsx`
- `ui/src/draftRecoveryJournal.ts`, `ui/src/scheduleAutosave.ts`
- `docs/editor.md`, `docs/phase2a-editor-acceptance.md`

**Tests and verification**

- `test/editor-state.test.ts`, `test/editor-tasklist.test.ts`, `test/editor-wikilinks.test.ts`
- `test/editor-markdown-commands.test.ts`, `test/editor-markdown-preview.test.tsx`
- `test/editor-attachments.test.ts`
- `test/ui-editor-layout.test.tsx`, `test/ui-editor-reliability.test.ts`, `test/draft-recovery-journal.test.ts`
- `scripts/browser-smoke.mjs`, `scripts/editor-*-smoke.mjs`
- Acceptance evidence in `docs/phase2a-editor-acceptance.md` (manual checks user-confirmed, environment not recorded).

**Commits**

- `4de6c70` — editor-introducing workspace commit.
- `7305eb0` — Phase 2A acceptance documentation.
- Later polish: `33cf07a`, `5fa715e`, `6dad914`, `c0618c9`, `13954be`, `b77168c`, `b7e6c63`.

**Known limitations**

- No block editor, slash menu, drag-to-reorder blocks, or HTML table widget.
- 1 MB note responsiveness is unverified; large-note checks are user-confirmed without measurements.
- Mixed line endings are not byte-preserved.
- SVG preview is unsupported; remote images must be HTTPS; local images are raster-only.
- No automatic wiki-link rewrite on note rename.

**Status:** **COMPLETE WITH LIMITATIONS**

---

### Phase 3 — Relay and Sync Foundation (Experimental)

**Objective:** Design and prototype an optional single-owner relay plus a programmatic sync client without making sync a prerequisite for local work.

**Implemented functionality**

- SQLite relay repository using `node:sqlite`: migrations, WAL, documents, versions, change feed, tombstones, retired IDs, operations, device sequences.
- Vault identity and epoch tracking.
- Pairing codes, hashed bearer tokens, revocation, rate limiting.
- Relay HTTP endpoints for health, vault, pairing, push, pull, operations, device state, snapshot, documents, devices, and revocation.
- Admin CLI for pairing, revocation, and health.
- Sync client with pairing, bootstrap, pull/push, durable outbox, apply ledger, conflict copies, mass-delete guard, and restart recovery.
- Phase 3 architecture, protocol, threat model, acceptance criteria, and ADRs.

**Important source files**

- `src/relay/auth.ts`, `src/relay/cli.ts`, `src/relay/contracts.ts`, `src/relay/db.ts`, `src/relay/identity.ts`, `src/relay/rate-limit.ts`, `src/relay/server.ts`
- `src/sync/client.ts`, `src/sync/conflicts.ts`, `src/sync/contracts.ts`, `src/sync/paths.ts`, `src/sync/state.ts`
- `docs/phase3/**`
- `src/index.ts` exports the sync client and sync types; the relay server/CLI are not exported as product entry points.

**Tests and verification**

- `test/relay/auth.test.ts`, `test/relay/cli.test.ts`, `test/relay/db.test.ts`
- `test/relay/identity.test.ts`, `test/relay/server.test.ts`, `test/relay/sync-service.test.ts`
- `test/sync-client.test.ts`

**Commits**

- `aa7bac8` — relay and sync foundation were present in the first commit.
- No package `bin`, npm script, or UI route wires the relay into the product.

**Known limitations**

- **Experimental and intentionally unwired.** There is no multi-device setup, onboarding UI, or production credential storage.
- Relay backup encryption is planned, not implemented (`age` interface only).
- Phase 3 acceptance checklist still contains unchecked crash/restore cases.
- `docs/phase3/roadmap.md` is stale about filesystem watching; derived database snapshots now have a watcher/reconciler, but the editor does not live-reload external edits.
- Sync metadata lives outside the vault, and no production conflict UX exists.

**Status:** **PARTIAL — EXPERIMENTAL, UNWIRED**

---

### Phase 4 — Navigation and Organization

**Objective:** Make a large vault navigable through a persistent sidebar, folder tree, note actions, graph, and discovery views.

**Implemented functionality**

- Sidebar navigation: All notes, Discovery, Local graph, Databases, Settings.
- Merged folder/note tree with expand/collapse, persisted expanded folders, and keyboard tree navigation.
- Folder create, rename, move, delete with impact review and confirmation token.
- Note create, rename path, move, delete with stale-write protection.
- Sidebar resize/collapse, mobile drawer with focus trap, breadcrumb, focus mode.
- Local wiki-link graph with pan/zoom, filtering, neighbor focus, and node lists.
- Discovery view for unresolved links, ambiguous links, and isolated notes.
- Command palette with fixed workspace commands and note search.

**Important source files**

- `ui/src/Sidebar.tsx`, `ui/src/PageTree.tsx`, `ui/src/SidebarToggle.tsx`
- `ui/src/GraphView.tsx`, `ui/src/graph-model.ts`
- `ui/src/DiscoveryView.tsx`, `ui/src/CommandPalette.tsx`, `ui/src/BacklinksPanel.tsx`
- `src/storage/fs/folders.ts`
- `docs/wiki-links.md`

**Tests and verification**

- `test/storage-folders.test.ts`
- `test/graph.test.ts`, `test/graph-api.test.ts`, `test/ui-backlinks.test.ts`, `test/ui-discovery.test.ts`
- `test/ui-sidebar.test.tsx`
- `scripts/sidebar-smoke.mjs`, `scripts/graph-smoke.mjs`, `scripts/discovery-smoke.mjs`

**Commits**

- `8a34823` — local note graph.
- `ff0ec55` — folder and file management.
- `d110092` — sidebar tree restoration and resizing.
- `8d52c8c` — navigation and responsive database interaction polish.

**Known limitations**

- No drag-and-drop for notes or folders; moves use dialogs/path rename.
- Breadcrumb is display-only.
- Graph is limited to 200 nodes and derived from confirmed links only.
- Folder deletion is permanent; there is no trash.

**Status:** **COMPLETE**

---

### Phase 5 — UX and Workspace Polish

**Objective:** Establish the shadcn/ui-first design system, onboarding, settings, vault selection, backup UI, and public landing page.

**Implemented functionality**

- shadcn/ui component set under `ui/src/components/ui` with semantic tokens and accessible primitives.
- Warm paper/light and graphite/dark themes; moss accent; Oswald/DM Sans typography (current working-tree font update).
- First-run vault onboarding: default vault, existing folder, native folder picker, recovery states.
- Per-user vault preference outside the vault; `NODUS_VAULT` override.
- Settings: vault identity/path/counts, health issues, vault switching, sync placeholder, backup/restore.
- Backup/restore UI with validation, preview, conflict handling, and explicit overwrite.
- Getting-started guide persisted per vault.
- Public landing page at `/`; workspace at `/app`.
- Accessibility conventions: skip links, focus management, tree semantics, dialog focus restoration, live save status, reduced motion.

**Important source files**

- `ui/src/App.tsx`, `ui/src/SettingsView.tsx`, `ui/src/VaultOnboarding.tsx`, `ui/src/GettingStartedGuide.tsx`
- `ui/src/BackupRestoreSection.tsx`, `ui/src/backupRequest.ts`, `ui/src/backupRestore.ts`
- `ui/src/LandingPage.tsx`
- `ui/src/components/ui/**`, `ui/src/index.css`, `DESIGN.md`
- `src/ui-server/app-preferences.ts`, `src/ui-server/folder-picker.ts`

**Tests and verification**

- `test/ui-app-preferences.test.ts`, `test/ui-backup-flow.test.ts`, `test/ui-backup-client.test.ts`, `test/ui-backup.test.ts`
- `test/ui-getting-started.test.tsx`, `test/vite-security.test.ts`
- `scripts/vault-onboarding-smoke.mjs`, `scripts/browser-smoke.mjs`

**Commits**

- `92fbe86` — shadcn-first UI policy.
- `7601437` — shared select, checkbox, and disclosure primitives.
- `f05c33c`, `c34b9b8` — landing page and hierarchy polish.
- `9ffe814` — vault onboarding and getting started.
- `02805bc` — workspace/design/benchmark documentation.

**Known limitations**

- No automated axe/ARIA audit.
- Manual accessibility/IME acceptance is user-confirmed but not reproducible from recorded artifacts.
- Sync settings show a static “Not connected” state.
- Typography/design tokens changed in the current working tree and are not yet committed.

**Status:** **COMPLETE WITH LIMITATIONS**

---

### Phase 6 — Search and Discovery

**Objective:** Provide fast, deterministic local search across metadata and content, with filters, backlinks, discovery, and a command palette.

**Implemented functionality**

- In-memory search index over title, aliases, path, body, tags, and registered property values.
- Deterministic ranking with stable tie-breakers and a 50-result limit.
- Unicode-aware snippets with safe offset handling.
- Metadata filters: tag/property, type-aware operators, AND/OR, invalid-metadata diagnostics.
- Shared snapshot cache with 5-second TTL and generation-based invalidation.
- Debounced sidebar search with abort/stale-response handling and keyboard navigation.
- Command palette with ranked note search and fixed commands.
- Backlinks (confirmed/ambiguous), discovery (unresolved/ambiguous/orphans), and graph projections.
- Rebuild/invalidation on writes, moves, deletes, tags, properties, catalog changes, restore, and import.

**Important source files**

- `src/search/search-index.ts`, `src/search/note-filters.ts`
- `src/indexing/snapshot-cache.ts`
- `src/links/link-index.ts`, `src/links/backlinks.ts`, `src/links/graph.ts`, `src/links/wikilink.ts`
- `ui/src/useNoteSearch.ts`, `ui/src/NoteFiltersPopover.tsx`, `ui/src/SearchResultContext.tsx`
- `docs/global-search.md`, `docs/search-benchmark.md`

**Tests and verification**

- `test/search-index.test.ts`, `test/note-filters.test.ts`, `test/ui-search.test.ts`
- `test/link-index.test.ts`, `test/backlinks.test.ts`, `test/wikilink.test.ts`
- `test/graph.test.ts`, `test/graph-api.test.ts`, `test/ui-discovery.test.ts`
- `scripts/search-smoke.mjs`, `pnpm bench:search`

**Commits**

- `266647d` — linked mentions API, index, and editor panel.
- `49bd8f4` — deterministic ranking, snippets, keyboard navigation.
- `47dacb6` — stale-result prevention and Unicode snippets.
- `7a3a419` — reuse verified note parsing and editor link resolvers.
- `ba0bfe6` — reproducible search benchmarks.

**Known limitations**

- Search is not persistent; every process rebuilds an in-memory index.
- External filesystem edits appear only after TTL expiry or explicit refresh.
- No full-text ranking beyond literal substring rules.
- No persisted link records; backlinks and graph are rebuilt from notes.
- Search covers registered properties only; arbitrary YAML is excluded.

**Status:** **COMPLETE WITH LIMITATIONS**

---

### Phase 7A — Metadata, Catalogs, and Portability

**Objective:** Add a vault-wide registered note-property catalog with stable IDs, aliases, typed values, and full portability.

**Implemented functionality**

- `nodus-property-catalog` version 1 at `properties/catalog.json`.
- Stable property IDs and stable YAML keys; mutable display names and option labels.
- Types: `text`, `number`, `checkbox`, `date`, `select`, `multi-select`, `url`.
- Select option aliases retained after rename.
- Property create/rename/delete and option add/rename/remove with explicit confirmation for values at risk.
- Values remain ordinary top-level YAML keys; Nodus does not rewrite them on catalog changes.
- Catalog included in backup (manifest v4) and portable export/import.
- Catalog and note metadata included in search filters.
- Canonical option-alias handling and metadata search fixes.

**Important source files**

- `src/properties/catalog.ts`
- `src/storage/fs/vault.ts` (property catalog storage)
- `src/storage/backup/backup.ts`, `src/storage/portable/export.ts`, `src/storage/portable/import.ts`
- `src/search/note-filters.ts`
- `ui/src/editor/PropertyEditor.tsx`, `ui/src/api.ts`, `src/ui-server/api.ts`
- `docs/property-format.md`

**Tests and verification**

- `test/property-catalog.test.ts`
- `test/storage-properties.test.ts`
- `test/metadata-portability.test.ts`
- `test/ui-property-api.test.ts`, `test/ui-general-properties.test.ts`
- `test/phase7a-integration.test.ts`
- `test/database-view-order.test.ts` and backup-order tests for portability interactions

**Commits**

- `18aa1e4` — metadata catalogs and portability.
- `b8226a1` — canonicalize property option aliases.
- `34b895a` — metadata search/filter alias fix.
- `954dfcd` — preserve user attachment folders in backups.
- `49d20a5` — strengthen Phase 7A integration coverage.

**Known limitations**

- The general property catalog is separate from database schemas; they are not unified.
- Catalog delete/removal preserves note YAML and does not migrate values.
- Unknown/unregistered YAML is not searchable.
- Some docs still describe an older backup manifest version; see the risk register.

**Status:** **COMPLETE**

---

### Phase 7B — Database Foundation and Saved Views

**Objective:** Deliver structured database definitions, row membership, typed values, and portable saved views with table/list/kanban/calendar layouts.

**Implemented functionality**

- `nodus-database` version 1 base schema with typed properties, stable IDs, and option IDs.
- Row membership and values in note `nodus_data`; schema remains in `databases/<id>.json`.
- Membership is explicit; adding a note requires confirmation.
- Saved views as independent versioned JSON files under `database-views/<database-id>/`.
- Table and List layouts; Kanban grouped by select; Calendar by date.
- Saved view creation, rename, duplicate, switch, save, reset, and delete.
- Typed sorting, AND filters, grouping, and property visibility.
- View format v3: ordered sorts and valueless empty/not-empty filters.
- Virtualized Table and List; grouped List.
- Portability of databases and views through backup/export/import.
- Database query helpers and typed filter validation.

**Important source files**

- `src/database/schema.ts`, `src/database/note-properties.ts`, `src/database/database-view.ts`
- `src/storage/fs/vault.ts`
- `ui/src/DatabasesView.tsx`, `ui/src/DatabaseLayouts.tsx`, `ui/src/SavedViewControls.tsx`
- `ui/src/database-table.ts`, `ui/src/database-view-layout.ts`
- `docs/database-format.md`, `docs/database-views.md`

**Tests and verification**

- `test/database.test.ts`
- `test/note-properties.test.ts`
- `test/storage-database-views.test.ts`
- `test/database-view-layout.test.ts`, `test/ui-database-table.test.ts`, `test/ui-database-layouts.test.tsx`
- `test/ui-database-client.test.ts`, `test/ui-databases.test.tsx`
- `scripts/database-views-smoke.mjs`

**Commits**

- `f47c7cf` — structured data, saved-view storage, database rows.
- `7e9eb99` — versioned view sorting/filters.
- `85703df` — List view.
- `aa7c58d` — record grouping.
- `e8b299c` — view compatibility and isolation tests.
- `3c5bdf1` — saved-view v3 documentation.
- `ceed16a`, `4293085`, `3f810d4`, `2a6b78b` — list/grouping tests and docs.

**Known limitations**

- No database deletion, property deletion, option deletion, or property-type changes in the UI.
- Deleting a database does not cascade-delete views; orphan views are diagnosed.
- Gallery lacks real image previews.
- Kanban/Calendar/Gallery are not virtualized.
- Calendar note creation is two API operations and is not atomic.
- View filter/validator mismatch: UI offers empty filters for rollups/formulas that the view diagnostic rejects.

**Status:** **COMPLETE**

---

### Phase 7C — Relations and Rollup Foundation

**Objective:** Add stable database relations, derived reverse fields, and rollups without copying referenced note content.

**Implemented functionality**

- Database schema version 2: `relation` and `rollup` property types.
- Forward relation cardinality `one` or `many`, stored as note UUIDs.
- Reverse relations computed from forward edges; never persisted.
- Relation projection resolving target title/path and `resolved`/`missing`/`incompatible` status.
- Cross-database relation targets with configuration diagnostics.
- Rollup operations over related records, with typed values and cycle detection.
- Relation picker UI, schema configuration, reverse fields, and relation backlinks.
- Relation storage hardening: write-time target/membership revalidation, stale-write rejection, no cascade deletion.
- Portable relations through backup/export/import; dangling IDs remain diagnosable.

**Important source files**

- `src/database/schema.ts`, `src/database/relation-contract.ts`, `src/database/relations.ts`, `src/database/note-properties.ts`
- `src/storage/fs/vault.ts`
- `ui/src/RelationControl.tsx`, `ui/src/RelationSchemaFields.tsx`, `ui/src/RelationBacklinksPanel.tsx`
- `docs/database-relations.md`

**Tests and verification**

- `test/relation-contract.test.ts`
- `test/database-relations.test.ts`
- `test/relation-storage-hardening.test.ts`
- `test/ui-relations.test.ts`, `test/ui-relation-backlinks.test.ts`, `test/ui-relation-layouts.test.tsx`
- `test/relation-api-lifecycle.test.ts`
- `scripts/relations-smoke.mjs`

**Commits**

- `a30a997` — database relations and rollups.
- `6041cf6` — schema v2/v3 completion, relation storage hardening, formula integration.
- Later expansions: `214abe7` (11A), `12678e5`/`b1379ad` (11B).

**Known limitations**

- No persistent relation index or reverse index; projections are whole-vault derived.
- Relation candidate search still scans the source database.
- Missing targets are diagnosable but not automatically repaired.
- Some docs list only the original rollup set and miss later operations.

**Status:** **COMPLETE**

---

### Phase 7D — Formula Engine and Authoring

**Objective:** Add a safe, deterministic formula property with schema, query, and editor integration.

**Implemented functionality**

- Hand-written tokenizer, Pratt-style parser, AST validator, and bounded evaluator; no `eval`/`Function`.
- Types: string, number, boolean, date, null, error.
- Arithmetic, comparison, logical, unary, and lazy `if(...)`.
- Standard library for strings, numbers, and dates.
- Formula schema version 3; expressions stored in database definitions.
- Derived values computed during projection; never persisted.
- Dependency analysis, direct/indirect cycle detection, type inference, memoization, and per-record error isolation.
- Formula sorting/filtering/grouping integration with typed query behavior.
- Formula editor with stable-UUID references, completions, diagnostics, help, and live preview.
- Lazy-loaded formula editor chunk.
- Backup/portable compatibility for schema v3.

**Important source files**

- `src/database/formula-contract.ts`, `src/database/formula-tokenizer.ts`, `src/database/formula-engine.ts`
- `src/database/relations.ts` (projection integration)
- `ui/src/database/FormulaEditor.tsx`, `ui/src/database/FormulaEditorImpl.tsx`, `ui/src/database/formula-editor-model.ts`
- `docs/database-formulas.md`

**Tests and verification**

- `test/database-formula-contract.test.ts`, `test/database-formula-engine.test.ts`
- `test/database-formulas.test.ts`
- `test/formula-editor-model.test.ts`, `test/ui-formula-editor.test.tsx`
- `benchmark/formula-evaluation.benchmark.ts`

**Commits**

- `6041cf6` — formula engine, schema v3, editor, tests.
- `53dc8be` — defer formula editor from workspace entry.

**Known limitations**

- Direct formula access to relation values is unsupported; relation access uses `related*` functions added in Phase 11C.
- Relation target properties cannot themselves be formulas, relations, or select/multi-select.
- Formula errors are excluded from filters and sort keys by design.
- Documentation does not yet document relation-aware functions.

**Status:** **COMPLETE** (relation-aware extension in Phase 11C)

---

### Phase 8 — Storage Reliability and Cross-Process Coordination

**Objective:** Harden storage for data safety, byte fidelity, malformed input, and cooperating concurrent processes.

**Implemented functionality**

- Raw-byte hashing and conditional writes across note, database, view, catalog, tag, order, and automation paths.
- Atomic writes with `fsync` and rename; exclusive-create helper for attachments.
- Vault-root lock: process-local queue plus cross-process lock file with owner metadata.
- Lock recovery safety: exact-owner verification, inode/device checks, no blind deletion.
- Malformed UTF-8 rejection and byte preservation.
- Import/backup byte fidelity for BOMs, CRLF, unknown frontmatter, and attachments.
- Comprehensive path containment and symlink/junction rejection.
- `PARTIAL_WRITE` diagnostics and storage health reporting.
- Failure-injection, concurrency, and recovery tests.

**Important source files**

- `src/storage/fs/root-lock.ts`, `src/storage/fs/atomic.ts`, `src/storage/fs/safe-path.ts`
- `src/storage/fs/vault.ts`, `src/storage/fs/layout.ts`, `src/storage/fs/scan.ts`
- `src/storage/errors.ts`, `src/storage/contracts.ts`
- `src/storage/backup/backup.ts`, `src/storage/portable/import.ts`
- `docs/storage.md`

**Tests and verification**

- `test/storage-root-lock.test.ts`
- `test/storage-root-lock-recovery.test.ts`
- `test/storage-reliability.test.ts`
- `test/storage-vault.test.ts`
- `test/storage-backup.test.ts`, `test/storage-portable.test.ts`
- `test/storage-attachments.test.ts`, `test/storage-folders.test.ts`

**Commits**

- `a91b02f` — conditional writes and TOCTOU narrowing precursor.
- `e741c76` — broad storage hardening.
- `3dcb79c` — import/backup byte fidelity.
- `ba02da5` — malformed UTF-8 rejection.
- `6cef715` — cross-process write coordination.
- `1363c28` — lock recovery safety.
- `440ec85` — path and recovery guidance hardening.
- `fd7de35` — browser smoke coverage.

**Known limitations**

- Locking is cooperative; external editors and network/sync filesystems are outside the guarantee.
- Hash-check → rename is not OS-level compare-and-swap.
- No multi-file transaction or rollback.
- No automatic stale-lock recovery; manual procedure only.
- Platform verification is concentrated on macOS; Windows/Linux/network filesystems are unverified.
- `checkHealth` does not inspect hidden Nodus metadata such as `properties/catalog.json`, view order, or automation files.
- `deleteDatabase` has no `expectedHash` option.
- Atomic replacement does not preserve file mode/ACL/xattrs.
- Backup/export read notes, view order, and automation files under separate lock acquisitions; not point-in-time coherent.

**Status:** **COMPLETE WITH LIMITATIONS**

---

### Phase 9 — Database Performance and Caching (Needs Review)

**Objective:** Reduce repeated parsing, projection, and request cost for database and search workloads while keeping disk content authoritative.

**Implemented functionality**

- `SnapshotReconciler`: recursive watcher, debounce, periodic reconcile, state machine, single-flight rebuilds, and trust invalidation on watcher loss.
- Database row snapshot cache keyed by content manifest, with bounded read batches and retry on stat/content mismatch.
- Parse-cache reuse only for identical content hashes.
- Search snapshot cache with TTL and generation invalidation.
- Reuse of verified note parsing and link resolvers.
- Formula editor lazy chunk and bundle split.
- Reproducible search, database rows, query, relation backlink, formula, and browser performance benchmarks.
- Performance documentation with historical measurements.

**Important source files**

- `src/storage/fs/snapshot-reconciler.ts`
- `src/storage/fs/vault.ts` (`snapshotNotes`, `databaseRowsSnapshot`)
- `src/indexing/snapshot-cache.ts`
- `src/ui-server/api.ts` (hosted snapshot option)
- `docs/structured-data-performance.md`, `docs/database-views.md` (performance sections)
- `benchmark/**`

**Tests and verification**

- `test/snapshot-reconciler.test.ts`
- `test/storage-note-snapshot.test.ts`
- `test/search-index.test.ts`, `test/note-filters.test.ts`
- `test/ui-database-layouts.test.tsx`
- `test/ui-saved-view-order.test.tsx`
- Benchmarks: `pnpm bench:search`, `pnpm bench:databases`, `pnpm bench:database-ui`

**Commits**

- `7a3a419` — reuse verified note parsing and editor link resolvers.
- `ba0bfe6` — reproducible search benchmarks.
- `4532618` — lifecycle-managed database snapshot reconciliation.
- `53dc8be` — defer formula editor from workspace entry.

**Why this milestone is marked NEEDS REVIEW**

- The cache/watcher lifecycle is not verified across multiple processes, external editors, network filesystems, sleep/wake, or watcher loss at scale.
- Database row requests still scan and parse every vault note to determine membership. The documented ~4.5 s at 5,000 notes is not a solved design.
- There are no CI performance thresholds or regression budgets; benchmark results are local, historical measurements with uncontrolled filesystem caches.
- Backup/export coherence and hidden-metadata invalidation are outside the current cache model.
- The watcher improves derived snapshots but does not make the editor live-reload external edits.
- Documentation describes some measurements as a “Phase 7” baseline and a “Phase 8D” recheck; there is no formally approved Phase 9 acceptance gate.

**Required next steps before marking complete**

1. Define measurable performance budgets and a CI/nightly benchmark policy.
2. Review cache lifecycle and invalidation for all Nodus metadata, not only notes/databases.
3. Measure and document multi-process and external-edit behavior.
4. Decide whether an incremental/persistent index is required for Phase 15/33.
5. Re-run benchmarks on supported Node 24 and record environment, dataset, and variance.

**Status:** **NEEDS REVIEW — do not mark complete**

---

### Phase 10 — Gallery and Persistent Saved-View Ordering

**Objective:** Add a Gallery layout and make saved-view ordering durable and portable.

**Implemented functionality**

- Gallery view: static card grid with card metadata; explicit “No preview” state.
- View type selection includes Table, List, Gallery, Kanban, Calendar.
- Saved-view ordering manifest: `nodus-database-view-order` v1 at `.nodus-orders/database-views/<database-id>.json`.
- Revision increments, exact current-view membership on write, `expectedHash` existence check, deterministic resolution of deleted/unknown/duplicate IDs.
- Keyboard-accessible reorder controls.
- Backup v5 includes view-order manifests; export/import and restore preserve them.
- Legacy vaults without order manifests resolve to default view order.

**Important source files**

- `src/database/database-view-order.ts`
- `src/storage/fs/vault.ts`
- `src/storage/backup/backup.ts`, `src/storage/portable/export.ts`, `src/storage/portable/import.ts`
- `ui/src/saved-view-order.ts`, `ui/src/SavedViewControls.tsx`, `ui/src/DatabaseLayouts.tsx`
- `docs/database-views.md`

**Tests and verification**

- `test/database-view-order.test.ts`
- `test/ui-saved-view-order.test.tsx`
- `test/storage-backup-order.test.ts`
- `test/storage-database-views.test.ts`
- `scripts/database-views-smoke.mjs`

**Commits**

- `5913d61` — gallery views and persistent saved-view ordering.

**Known limitations**

- Gallery has no actual image preview.
- Ordering is per vault/database and not synchronized.
- Deleting a database leaves orphan views and order files.
- View-order docs are incomplete; version 5 backup history is not fully documented.

**Status:** **COMPLETE**

---

### Phase 11A — Relation Lifecycle and Layout Coverage

**Objective:** Prove relations work across creation, linking, removal, restart, rename, move, deletion, cross-database isolation, and every layout.

**Implemented functionality**

- End-to-end relation lifecycle coverage added to tests and browser smoke.
- Relation creation/configuration, target selection, record opening, relation removal, restart persistence.
- Target rename/move/deletion behavior and dangling reference diagnostics.
- Cross-database isolation and relation-aware rendering in Table, List, Kanban, Calendar, and Gallery.

**Important source files**

- `ui/src/RelationControl.tsx`, `ui/src/DatabasesView.tsx`, `ui/src/RelationBacklinksPanel.tsx`
- `src/database/relations.ts`, `src/database/relation-contract.ts`
- `src/storage/fs/vault.ts`

**Tests and verification**

- `test/relation-api-lifecycle.test.ts`
- `test/ui-relation-layouts.test.tsx`
- `test/ui-relations.test.ts`, `test/ui-relation-backlinks.test.ts`
- `scripts/database-views-smoke.mjs` (Phase 11A comment block)
- `scripts/relations-smoke.mjs`

**Commits**

- `214abe7` — Phase 11A relation lifecycle and layout tests.

**Known limitations**

- Production behavior existed before the coverage commit; this phase is primarily verification hardening.
- No persistent relation index.
- Deleted targets remain dangling until repaired or cleared.

**Status:** **COMPLETE**

---

### Phase 11B — Aggregate Rollups and Relation Search

**Objective:** Expand rollup operations and make large relation pickers usable.

**Implemented functionality**

- Added rollups: `count-non-empty`, `average`, `minimum`, `maximum` (alongside `count`, `conditional-count`, `sum`, `completed-task-count`, `completion-percentage`).
- Numeric/rollup/date target handling with typed errors and empty-set semantics.
- Nested rollups and circular dependency detection with depth guard.
- Bounded server-side relation candidate search:
  - `GET /api/databases/:id/relation-candidates`
  - validates property/target database
  - query ≤ 200 characters, limit 1–50
  - returns `truncated`
- Debounced server search in the relation picker; embedded candidates for initial render; selected-chip pagination.
- Relation backlinks benchmark.

**Important source files**

- `src/database/relations.ts`, `src/database/schema.ts`
- `src/ui-server/api.ts`
- `ui/src/RelationControl.tsx`, `ui/src/DatabasesView.tsx`
- `benchmark/relation-backlinks.benchmark.ts`

**Tests and verification**

- `test/database-relations.test.ts`
- `test/relation-api-lifecycle.test.ts`
- `test/ui-relations.test.ts`
- `scripts/database-views-smoke.mjs` (Phase 11B comment block)

**Commits**

- `12678e5` — bounded server-side relation candidate search.
- `b1379ad` — aggregate database rollup operations.

**Known limitations**

- No cursor pagination; results are truncated at 50.
- Candidate search still scans/parses the source database’s vault rows.
- Rollup docs list only the original operations.
- Completion percentage uses all resolved targets as the denominator; missing checkbox values count incomplete.

**Status:** **COMPLETE**

---

### Phase 11C — Relation-Aware Formulas

**Objective:** Allow formulas to aggregate related records without copying data into formula rows.

**Implemented functionality**

- Relation-aware functions: `relatedCount`, `relatedSum`, `relatedAverage`, `relatedMin`, `relatedMax`, `relatedCountWhere`.
- Stable relation property UUID + target property UUID/literal inputs.
- Relation preview in the formula editor, loading target rows through the API.
- Dependency/cycle handling across formulas and rollups.
- Typed result inference used by API metadata and editor completion.
- Formula values remain derived and never persisted.

**Important source files**

- `src/database/formula-engine.ts`, `src/database/relations.ts`, `src/database/formula-contract.ts`
- `src/ui-server/api.ts`
- `ui/src/database/FormulaEditor.tsx`, `ui/src/database/FormulaEditorImpl.tsx`, `ui/src/database/formula-editor-model.ts`
- `docs/database-formulas.md`

**Tests and verification**

- `test/formula-relations.test.ts`
- `test/database-formulas.test.ts`
- `test/formula-editor-model.test.ts`, `test/ui-formula-editor.test.tsx`
- `benchmark/formula-evaluation.benchmark.ts`

**Commits**

- `45eab83` — relation-aware database formulas.
- `02e6215` — preview relation-aware formulas in the editor.

**Known limitations**

- `docs/database-formulas.md` still says formulas cannot traverse relations and does not document the `related*` functions.
- Target properties cannot be formulas, relations, select, or multi-select.
- Relation preview performs extra per-target-database requests.
- Formula errors are not filterable and are omitted from sort keys.

**Status:** **COMPLETE WITH DOCUMENTATION DEBT**

---

### Phase 12 — Database Automations

**Objective:** Provide local, declarative workflows that respond to database record events without arbitrary scripting or network execution.

**Implemented functionality**

- Versioned automation definitions and execution history in `.nodus-automations/`, stored by stable database, automation, record, and property UUIDs.
- Triggers for record membership creation, watched-property updates (including clearing a property), record deletion, and transitions into ANDed conditions.
- Typed conditions and ordered actions: set/clear supported properties, update dates, and set checkboxes.
- Deterministic automation-ID ordering, atomic event claims under the vault lock, duplicate suppression, and no recursive execution from action writes.
- Management UI for creating/editing, enabling/disabling, confirmed deletion, and viewing execution outcomes.
- Backup v6, portable export/import, and restore of definitions and history, while continuing to read backup versions 1–5.

**Important source files**

- `src/database/automations.ts`
- `src/storage/contracts.ts`, `src/storage/fs/layout.ts`, `src/storage/fs/vault.ts`
- `src/storage/backup/backup.ts`, `src/storage/portable/export.ts`, `src/storage/portable/import.ts`
- `src/ui-server/api.ts`, `ui/src/DatabaseAutomations.tsx`, `ui/src/DatabasesView.tsx`
- `docs/database-automations.md`

**Tests and verification**

- `test/database-automations.test.ts`, `test/database-automations-api.test.ts`
- `test/ui-database-client.test.ts`, `test/ui-databases.test.tsx`
- `scripts/browser-smoke.mjs` (automation create/edit/toggle/run/history/delete flow)
- Full suite: `pnpm exec vitest run --no-cache --maxWorkers=2` — 89 files / 1,062 tests passed.
- `pnpm typecheck`, `pnpm build`, `pnpm test:database-views`, `pnpm test:browser`, `pnpm test:vault-onboarding`, `pnpm bench:databases`, and `git diff --check` passed.

**Commit**

- `a1466ae` — database automations (pushed to `origin/main`).

**Known limitations**

- Events run synchronously in the local API request path; there is no worker or scheduler.
- A deleted record cannot receive row-local actions, so matching deletion automations are recorded as failures.
- Action lists are ordered but not transactional; successful earlier actions remain if a later action fails.
- History is append-only and unbounded. A persisted `running` claim is not retried after a crash, avoiding duplicate side effects.
- The UI currently omits relation properties from action targets even though the storage validator supports relation assignments.
- Hidden automation files are included in backup/export but are not yet inspected by storage health checks (L-05).

**Status:** **COMPLETE WITH LIMITATIONS**

---

### Phase 13 — Templates and Database Templates

**Objective:** Create reusable note and database templates without duplicating the editor or database engine.

**Implemented functionality**

- Strict, versioned `nodus-templates` v1 catalog in `.nodus-templates/templates.json`, stored through the vault root lock, atomic replacement, and SHA-256 compare-and-swap writes.
- Note templates include Markdown, title, tags, aliases, icon, custom frontmatter, and declared text/date/number variables with deterministic interpolation and validation.
- Database templates capture validated schemas, saved views, and optional starter rows checked with existing note-property rules.
- Templates workspace supports create/edit/save/delete, preview, explicit apply, plus a direct “From template” entry from note creation.
- Note apply uses the existing safe path allocator; database apply assigns fresh database/view/record IDs and uses `applyImport` conflict checks.
- Portable export/import includes the catalog. Backup manifest v7 includes the template file identity, hash, bytes, and count; manifest versions 1–6 remain supported.

**Important source files**

- `src/database/templates.ts`, `src/storage/contracts.ts`, `src/storage/fs/layout.ts`, `src/storage/fs/vault.ts`
- `src/storage/portable/export.ts`, `src/storage/portable/import.ts`, `src/storage/backup/backup.ts`
- `src/ui-server/api.ts`, `ui/src/TemplatesView.tsx`, `ui/src/Sidebar.tsx`, `ui/src/App.tsx`
- `docs/templates.md`

**Tests and verification**

- `test/database-templates.test.ts`, `test/database-templates-api.test.ts`; focused template and automation set: 4 files / 14 tests passed.
- Full suite: `pnpm test --maxWorkers=1` — 91 files / 1,067 tests passed.
- `pnpm typecheck`, `pnpm build`, `pnpm test:database-views`, `pnpm test:browser`, `pnpm test:vault-onboarding`, `pnpm bench:databases`, and `git diff --check` passed.
- Browser smoke covers template create/edit/preview/apply/delete. Build reports the existing App chunk size advisory above 500 kB.

**Known limitations**

- Database template schema/view/row writes reuse import safety and per-file atomic writes but are not one multi-file transaction; a later filesystem failure is surfaced as an incomplete import.
- Hidden template files are not included in `checkHealth` diagnostics, consistent with the existing gap for hidden metadata (L-05).
- Database template definitions are captured from an existing database in the UI; there is no standalone visual schema designer inside the template workspace.

**Status:** **COMPLETE WITH LIMITATIONS**

---

### Phase 15P — Productivity and Command Experience (Delivered Track)

**Numbering note:** the task brief calls this Phase 15. This roadmap reserves Phase 15 for **Database Protection and Safeguards** (still planned), so this delivered work is recorded as **15P** to avoid renumbering future milestones.

**Objective:** Improve command discovery, keyboard ergonomics, recent-note navigation, and accessibility without replacing the existing application architecture or duplicating command implementations.

**Implemented functionality**

- Command palette grouped as Recent notes, Notes, Navigation, Databases, Folders, Appearance, and Help.
- Command search by title, keywords, and category with deterministic ranking; duplicate command IDs are deduplicated first-wins.
- Keyboard shortcut labels beside commands, generated from the central shortcut registry and platform detection.
- Keyboard-only selection through the shared shadcn Command primitive, focused input on open, visible platform labels, and separate loading, empty, search-error, and command-execution-error states.
- Command failures keep the palette open, show `role="alert"`, and offer **Try again**.
- Central shortcut registry for command palette, new note, save, recent notes, and shortcut reference; conflict detection and an editor-binding collision audit.
- Focus policy that blocks app shortcuts in text fields, respects editor-specific allowances, IME composition, already-handled events, app modals, Sheets, and dialogs.
- Recent-notes quick switcher (`Mod+Shift+H`) and a shortcut reference dialog (`Mod+/`).
- Recent notes persist per vault in versioned localStorage, reconcile moved/renamed notes by stable ID, omit deleted notes, and recover from corrupt/full/unavailable storage.
- Command entries for databases (stable IDs) and folders (current paths); database selection reuses the existing Databases view state.
- Command palette, recent-notes, and shortcut-reference accessibility labels, dialogs, focus behavior, and keyboard paths.

**Important source files**

- `ui/src/shortcuts.ts`, `ui/src/commands.ts`, `ui/src/recentNavigation.ts`
- `ui/src/CommandPalette.tsx`, `ui/src/RecentNotesDialog.tsx`, `ui/src/ShortcutReferenceDialog.tsx`
- `ui/src/App.tsx`, `ui/src/Sidebar.tsx`
- `docs/shortcuts.md`, `docs/global-search.md`, `docs/editor.md`, `README.md`
- `test/ui-command-palette.test.ts`, `scripts/browser-smoke.mjs`

**Tests and verification**

- `test/ui-command-palette.test.ts` — 22 tests covering command registration/deduplication, search and ranking, grouping, execution failures, shortcut conflicts, platform labels, editor collision audit, focus policy, text-entry classification, recent-note persistence, moved/deleted destinations, and corrupt-preference recovery.
- `test/ui-editor-reliability.test.ts` — existing shortcut tests passed against the new handler (80 tests in the focused pair).
- Full serial suite: `pnpm test --maxWorkers=1` — **92 files / 1,089 tests passed**.
- `pnpm typecheck` — passed.
- `pnpm build` — passed; existing App chunk advisory above 500 kB remains.
- `pnpm test:browser` — passed with real keyboard navigation, palette command search/execution, recent-note switching, shortcut labels, and the shortcut reference dialog.
- `git diff --check` — passed.

**Commit**

- `feat: improve productivity and command experience` (this delivery; use `git log -1` for the hash).

**Known limitations**

- Recent-note history is local to the browser profile and vault path; there is no cross-device or server-side recent list.
- The registry owns application/workspace shortcuts. Editor formatting shortcuts remain registered by CodeMirror and are audited for collisions rather than reimplemented.
- Folder commands route through the existing note search path (view All notes with the folder path as query) rather than adding folder-selection state to the tree.
- Command execution errors are surfaced by the palette, but existing domain handlers may also report errors in their own surfaces.
- Command items are not virtualized; the list is bounded to current databases, all folders, five recent notes, and notes returned by the existing 50-result search limit.
- Previous shortcut behavior accepted either Meta or Ctrl; that cross-platform tolerance is retained while display labels remain platform-specific.

**Status:** **COMPLETE WITH LIMITATIONS**

---

### Phase 14 — Template Reliability and Vault Health Integration

**Objective:** Make template catalogs visible to vault health diagnostics and make database template application recoverable after multi-file failures.

**Completed work**

- Reuse the strict template catalog parser in read-only vault health checks. Missing optional storage remains healthy; malformed data, unsupported versions, duplicate IDs, unsafe entries, and I/O failures report path-scoped standard health issues.
- Validate saved views in their persisted internal representation and check their references against the template database definition.
- Stage generated database-template files and validate the complete write set before promotion. Publish with exclusive hard links, database definition last, and inode-checked rollback.
- Recover prepared transactions on the next explicit database template apply. Preserve unverified files and journals; report incomplete recovery through health diagnostics. Refuse backup/export snapshots while an uncommitted transaction is pending.
- Add focused storage, API, parser, and UI coverage; document recovery behavior and limits in `docs/templates.md`.

**Guarantees and limitations:** This is a recoverable staged-write protocol, not filesystem-wide transactionality. Nodus root locking is cooperative. External programs may race, and readers may observe the short publication sequence. Rollback removes only files whose inode and content hash still match staged transaction files; unknown or edited files are preserved with the journal for inspection.

**Status:** **COMPLETE**

### Phase 16 — Markdown Editor Enhancements

**Status:** COMPLETE WITH LIMITATIONS.

The CodeMirror editor now exposes a debounced heading outline with nested navigation, duplicate-safe shared preview anchors, active-heading tracking, and empty-document guidance. Rectangular spreadsheet paste creates a Markdown table; Tab/Shift+Tab navigate parsed table cells and Tab appends a row at the end. Existing Markdown source, parser, autosave, conflict handling, and shadcn primitives remain in use. See `docs/editor.md` for keyboard behavior and the observed performance measurement. Extraction still walks the complete syntax tree after a debounce; large heading-heavy documents may have a brief outline refresh pause.

---

### Phase 17G — Knowledge Graph and Relationship Exploration

**Numbering note:** the task brief calls this Phase 17. This roadmap reserves Phase 17 for **Tasks and Project Management** (still planned), so the delivered graph work is recorded as **17G** to avoid renumbering future milestones.

**Objective:** Extend the existing wiki-link graph into a reliable, filterable relationship explorer with outgoing links, unresolved-target exploration, isolated-note discovery, stable IDs, and bounded performance.

**Implemented functionality**

- Path fallback in the existing wiki-link resolver: workspace-relative path with or without `.md`, normalized separators/NFC/lowercase; title/alias/ID still take precedence.
- External URL schemes ignored as internal relationships; unresolved, ambiguous, duplicate, and self-reference occurrences remain explicit.
- Link index now exposes `isolatedNotes` (no confirmed incoming or outgoing links; self-links excluded) alongside the legacy incoming-only `orphanNotes`.
- Graph projection adds aggregated `unresolvedLinks`, `unresolvedCount`, `ambiguousCount`, and `isolatedNodeIds`; graph projection is cached with the shared knowledge snapshot.
- Backlinks API response now includes `outgoing` occurrences with target ID/title/path, resolution status, candidate IDs, and self-reference flags.
- Discovery API adds `isolated`; the UI now presents isolated notes with the stricter two-way definition while retaining the compatibility `orphans` field.
- Interactive graph: search, folder filter, isolated-note toggle, unresolved-link toggle, reset filters, neighborhood focus, selection/neighbor edge highlighting, dashed unresolved virtual nodes, double-click open, and accessible node controls.
- Backlinks panel: incoming linked mentions plus outgoing link occurrences, status badges, snippets, paths, navigation, and self-reference handling.
- No new dependency or storage format; graph remains derived from Markdown and rebuilds from the existing five-second vault snapshot.

**Important source files**

- `src/links/wikilink.ts`, `src/links/link-index.ts`, `src/links/backlinks.ts`, `src/links/graph.ts`
- `src/ui-server/dto.ts`, `src/ui-server/api.ts`
- `ui/src/graph-model.ts`, `ui/src/GraphView.tsx`, `ui/src/BacklinksPanel.tsx`, `ui/src/DiscoveryView.tsx`
- `docs/knowledge-graph.md`, `docs/wiki-links.md`
- `test/graph-exploration.test.ts`, `test/graph-api.test.ts`, `test/backlinks.test.ts`, `test/ui-backlinks.test.ts`, `test/ui-discovery.test.ts`
- `scripts/graph-smoke.mjs`, `scripts/discovery-smoke.mjs`, `benchmark/graph.benchmark.ts`

**Tests and verification**

- Focused relationship/link/graph suite on the integrated branch: 10 files / 87 tests passed.
- Full serial suite on the integrated Phase 15–17 branch: **98 files / 1,137 tests passed**.
- `pnpm typecheck` — passed.
- `pnpm build` — passed; App chunk is 796.92 kB and the existing 500 kB advisory remains.
- `pnpm test:browser`, `pnpm test:vault-onboarding`, `pnpm test:database-views` — passed.
- `scripts/graph-smoke.mjs` and updated `scripts/discovery-smoke.mjs` — passed in Chromium.
- `pnpm bench:graph` — passed; local measurements recorded below.
- `git diff --check` — passed.

**Performance measurements**

- 1,000 notes / 3,000 link occurrences: 16.27 ms total (12.52 ms index, 3.72 ms graph projection).
- 5,000 notes / 15,000 link occurrences: 78.45 ms total (55.88 ms index, 21.11 ms graph projection).
- Five-run median after one warm-up on Node 24.18.1; local development observation, no filesystem or UI rendering.

**Commit**

- `df89954` — `feat: add knowledge graph exploration` (implementation commit).

**Known limitations**

- Radial deterministic layout only; no force simulation or persisted node positions.
- 200-node display bound; larger vaults need search, folder, or focus filtering.
- Unresolved targets are virtual text nodes and cannot be opened as notes.
- Path links intentionally break when a note moves; ID-pinned links remain stable.
- No heading/block targets, frontmatter link extraction, or automatic link rewriting.
- No persistent relationship index; external edits appear after the snapshot TTL or explicit refresh.
- Ambiguous targets remain excluded from confirmed edges until source Markdown is edited.

**Status:** **COMPLETE WITH LIMITATIONS**

---

### Phase 18L — Link Integrity and Repair

**Numbering note:** the roadmap reserves Phase 18 for **Tasks and Project Management** (still planned). This delivered work is recorded as **18L** to avoid renumbering future milestones.

**Objective:** Make broken and ambiguous wiki links actionable from Discovery, and keep title-based links working when a note is renamed, without introducing a persistent index, new storage format, or dependency.

**Implemented functionality**

- Deterministic, local repair suggestions for unresolved links, ranked from normalized titles, aliases, workspace paths, shared words, and a bounded edit-distance comparison. Up to three suggestions are returned; the source note is excluded.
- Ambiguous links expose their resolver candidates in stable order for explicit disambiguation.
- Safe single-occurrence link rewrite: revision-checked source write, exact offset/target/display verification, explicit display preservation, and readable display text when pinning a bare link.
- Repairs default to the target note's stable UUID; a title target is used only when it resolves uniquely, otherwise the server falls back to the stable ID.
- Discovery UI shows suggestion buttons with reasoning labels, empty guidance, a repair status message, errors, and keyboard-accessible controls. The action re-reads the source hash immediately before the revision-checked write.
- Rename-safe title links: when a note title changes and confirmed incoming title links exist, the previous title is retained as an alias on the renamed note. This is a single-note metadata change; no other Markdown file is rewritten.
- No new dependency, storage format, or persistent index. Markdown remains authoritative and the existing link resolver, snapshot cache, `expectedHash` contract, and shadcn primitives are reused.

**Important source files**

- `src/links/link-repair.ts`, `src/links/link-edit.ts`, `src/links/wikilink.ts`
- `src/ui-server/api.ts`, `src/ui-server/dto.ts`
- `ui/src/DiscoveryView.tsx`, `ui/src/api.ts`, `ui/src/App.tsx`
- `test/link-repair.test.ts`, `test/link-repair-api.test.ts`, `scripts/discovery-smoke.mjs`
- `docs/wiki-links.md`, `docs/knowledge-graph.md`, `README.md`

**Tests and verification**

- Focused link repair and discovery suite: `test/link-repair.test.ts`, `test/link-repair-api.test.ts`, `test/ui-discovery.test.ts`, `test/graph-api.test.ts`, `test/graph-exploration.test.ts` — 5 files / 33 tests passed.
- Full serial suite: **100 files / 1,155 tests passed**.
- `pnpm typecheck` and `pnpm build` passed. The production build reports the App chunk at 799.91 kB; the existing 500 kB advisory remains.
- `pnpm test:browser`, `pnpm test:database-views`, `pnpm test:vault-onboarding`, `scripts/discovery-smoke.mjs`, and `scripts/graph-smoke.mjs` passed.
- `pnpm bench:graph` passed with the added suggestion benchmark; results are below.
- Browser smoke covers rename-safe title links, suggestion display, keyboard repair, stable-ID pinning, and resolver refresh.

**Performance measurements**

- Graph baseline on the final code: 1,000 notes / 3,000 occurrences: 16.16 ms median (12.37 ms index, 3.76 ms graph); 5,000 / 15,000: 81.33 ms median (57.68 ms index, 21.90 ms graph).
- Repair suggestions, 5-run median after warm-up: 1,000 notes / 250 unique targets: 80.81 ms total (0.323 ms per target); 5,000 notes / 500 unique targets: 975.98 ms total (1.952 ms per target). Repeated targets benefit from the per-request target cache in the API.
- Fuzzy edit-distance work is bounded per target; normalized prefix, containment, and token checks still run for every note.
- Local Node 24.18.1 measurements, no filesystem or browser rendering. No thresholds are enforced.

**Known limitations**

- Suggestions are lexical, not semantic; they do not inspect note bodies for topical similarity.
- Repair handles one occurrence in one source note; there is no repair-all or vault-wide rewrite.
- Path links still break when a note moves. Only title links benefit from the automatic alias.
- The previous-title alias is retained only when a whole-vault link scan succeeds and confirmed incoming title links exist. If the scan fails because another note is malformed, the save still succeeds but link preservation is skipped.
- The alias is ordinary metadata and can be removed later; doing so breaks those title links again.
- No heading/block targets or frontmatter link extraction.

**Status:** **COMPLETE WITH LIMITATIONS**

---

## 4. Proposed Future Milestones (Phases 15, 17–34)

These milestones are **proposals, not commitments**. They are ordered by likely dependency, not by promised delivery date. Do not start a phase until its prerequisites are complete and its acceptance criteria are reviewed.

### Future Milestone Summary

| Phase | Name | Status | Primary dependencies |
|---|---|---|---|
| 15 | Advanced Database Queries | PLANNED | 7B, 7D, 11, 9 review |
| 17 | Database Protection and Safeguards | PLANNED | 7A, 7B, 8, 15 |
| 18 | Tasks and Project Management | PLANNED | 13, 15, 19 |
| 19 | Calendar and Timeline Improvements | PLANNED | 7B, 10, 18 |
| 20 | Notifications and Reminders | PLANNED | 12, 18, 19 |
| 21 | Import and Migration | PLANNED | 7A, 8, 13 |
| 22 | Plugin and Extension Architecture | PLANNED | 15, 17, 32 |
| 23 | Graph View | PLANNED | 6, 9 review, 24, 27 |
| 24 | Backlinks and Knowledge Discovery | PLANNED | 6, 27 |
| 25 | Advanced Markdown | PLANNED | 2A, 6, 7A |
| 26 | Whiteboards and Visual Workspace | PLANNED | 23, 25, 27 |
| 27 | Advanced Search | PLANNED | 6, 9 review, 15, 24 |
| 28 | AI Integration | PLANNED | 22, 27, 32 |
| 29 | Sync Architecture | BLOCKED | 3, 8, 30, 32 |
| 30 | Conflict Resolution | PLANNED | 3, 8 |
| 31 | Mobile Experience | PLANNED | 26, 29, 30, 32 |
| 32 | Security and Privacy | PLANNED | 8, 21, 29 |
| 33 | Performance and Scalability | PLANNED | 9 review, 15, 23, 27 |
| 34 | Release Preparation | PLANNED | All prior |

### Phase 15 — Advanced Database Queries

**Objective:** Move beyond single-level saved-view filters and sorts while keeping queries portable.

**Expected features**

- OR groups and nested filter trees.
- Filters over formula and rollup results.
- Sorting by formula values with explicit error ordering.
- Saved queries reusable across views/databases.
- Offset/cursor pagination for large result sets.
- Query validation and diagnostics in the UI.

**Dependencies:** Phase 7B (view contract), 7D (formula typing), 11B/C (derived values), Phase 9 review (performance).

**Potential architecture impact**

- Saved-view version 4 or a separate query document.
- Shared query AST between server and UI to prevent validator drift.
- Query evaluation must remain deterministic and side-effect free.

**Acceptance criteria**

- Query semantics are documented and versioned.
- Server and UI accept/reject the same query shapes.
- Formula/rollup errors are handled without hiding records silently.
- Large datasets stay within an agreed performance budget.
- Backward compatibility for view versions 1–3.

**Status:** **PLANNED**

---

### Phase 17 — Database Protection and Safeguards

**Objective:** Allow safe schema evolution, including deletion and type changes, without orphaning data or breaking relations.

**Expected features**

- Property deletion, option removal, and type migration with impact preview.
- Dependency detection for relations, rollups, formulas, filters, sorts, and automations.
- Explicit confirmation and documented irreversible steps.
- Database deletion and optional saved-view cleanup.
- Audit or recovery journal for schema changes.

**Dependencies:** Phase 7A (catalog deletion patterns), 7B (schemas/views), 8 (conditional writes), 15 (query references).

**Potential architecture impact**

- New schema mutation operations and impact-report APIs.
- Relation/rollup/formula repair or quarantine behavior.
- Migration policy changes; no silent data deletion.

**Acceptance criteria**

- Impact preview lists every dependent object before mutation.
- No operation removes values without explicit confirmation.
- Interrupted operations are detectable and recoverable.
- Tests cover relations, formulas, views, automations, and portability.

**Status:** **PLANNED**

---

### Phase 18 — Tasks and Project Management

**Objective:** Model tasks and projects on top of databases, not as a separate parallel system.

**Expected features**

- Task statuses, priorities, assignees (single-owner), dates, dependencies, and checklists.
- Project/board views, WIP limits, and progress summaries.
- Recurrence rules (only if justified by real use cases).
- Timeline and dependency visualization.

**Dependencies:** Phase 13 (templates), 15 (queries), 19 (timeline).

**Potential architecture impact**

- Reuse database schemas, rollups, formulas, and saved views.
- Avoid a second task-specific data format unless documented as a compatibility exception.

**Acceptance criteria**

- Tasks remain ordinary database rows with portable note values.
- Project progress values are derived, not duplicated storage.
- Dependency cycles are detected and surfaced.
- Tests cover lifecycle, queries, and portability.

**Status:** **PLANNED**

---

### Phase 19 — Calendar and Timeline Improvements

**Objective:** Expand the existing Calendar layout into a scheduling and timeline surface.

**Expected features**

- Multiple date properties, ranges, and time-of-day support.
- Drag/drop rescheduling with revision checks.
- Timeline/Gantt-style view with dependencies.
- Timezone and locale behavior documented.
- Atomic create-and-schedule flow.

**Dependencies:** Phase 7B (calendar layout), Phase 10 (saved views), Phase 18 (task dates/dependencies).

**Potential architecture impact**

- New view settings version; date-only format remains the default.
- Preview of time zones without changing stored date semantics.
- Reuse `expectedHash` writes for all moves.

**Acceptance criteria**

- Date-only behavior remains backward compatible.
- Rescheduling is atomic from the user’s perspective or reports partial failure.
- Timeline scales and virtualizes.
- Tests cover ranges, timezones, conflicts, and portability.

**Status:** **PLANNED**

---

### Phase 20 — Notifications and Reminders

**Objective:** Remind the user about dates and tasks without turning Nodus into a cloud service.

**Expected features**

- Local reminders and in-app notification inbox.
- Reminder rules tied to date/task properties.
- Snooze, dismiss, and completion actions.
- Optional operating-system notifications with explicit permission.

**Dependencies:** Phase 12 (automation events), 18 (tasks), 19 (dates).

**Potential architecture impact**

- New scheduled evaluation path; possibly a local background process.
- Reminder state storage and backup policy.
- Explicit privacy and permission boundaries.

**Acceptance criteria**

- No network dependency for local reminders.
- Missed reminders are detectable after restart.
- No duplicate notifications after restart or clock change.
- User can disable reminders completely.

**Status:** **PLANNED**

---

### Phase 21 — Import and Migration

**Objective:** Bring existing knowledge into Nodus safely from other tools.

**Expected features**

- Importers for Markdown folders, Obsidian vaults, CSV, and selected database exports.
- Dry-run plan with counts, conflicts, and unsupported items.
- Mapping UI for properties, tags, paths, and dates.
- Resumable import with explicit partial-write reporting.
- Migration report preserving source identity where possible.

**Dependencies:** Phase 7A (metadata), Phase 8 (portable safety), Phase 13 (templates).

**Potential architecture impact**

- Extend `planImport`/`applyImport` rather than creating a second write path.
- New source adapters and mapping documents.
- Preserve unknown source metadata only through documented namespaces.

**Acceptance criteria**

- Import never overwrites without explicit confirmation.
- Non-UTF-8 and unsupported files are reported, not silently skipped.
- Re-running an import is idempotent or reports duplicates clearly.
- Tests cover conflict, rollback reporting, and representative source formats.

**Status:** **PLANNED**

---

### Phase 22 — Plugin and Extension Architecture

**Objective:** Allow controlled extension of Nodus without granting arbitrary filesystem or network access by default.

**Expected features**

- Versioned extension manifest and API surface.
- Permission model for vault reads/writes, UI slots, and optional network access.
- Sandbox/isolation strategy.
- Extension discovery, enable/disable, and failure isolation.
- Compatibility policy for extension APIs.

**Dependencies:** Phase 15 (query API), Phase 17 (safe schema mutation), Phase 32 (security model).

**Potential architecture impact**

- Major API boundary and trust-model work.
- Potential worker or process isolation.
- Extension metadata storage and migration.

**Acceptance criteria**

- Extensions cannot bypass storage contracts or path safety.
- Permission prompts are explicit and auditable.
- A failing extension cannot corrupt vault data or block startup.
- API versioning and deprecation policy are documented.

**Status:** **PLANNED**

---

### Phase 23 — Graph View

**Objective:** Advance the existing basic wiki-link graph into a scalable knowledge-graph surface.

**Important:** The basic graph and Phase 17G exploration features already exist (`ui/src/GraphView.tsx`, `src/links/graph.ts`, `src/links/backlinks.ts`). This phase is **not** the first graph implementation and must not reimplement search, folder filtering, focus, unresolved-target display, or isolated-note discovery delivered in Phase 17G.

**Expected features**

- Larger-node support with clustering/LOD and persisted layout beyond the 200-node bound.
- Additional filters by tag, database membership, and date.
- Shortest-path exploration and saved graph views.
- Accessibility-friendly alternative list view.

**Dependencies:** Phase 6 (link index), Phase 9 review (performance), Phase 24 (discovery), Phase 27 (search).

**Potential architecture impact**

- Persistent or incremental graph index; current graph is in-memory.
- Rendering performance budget and virtualization strategy.
- Avoid making the graph a second source of truth.

**Acceptance criteria**

- Graph remains derived from confirmed links.
- Large-vault performance is measured and bounded.
- Filters and focus are keyboard accessible.
- No persisted edge data without a versioned format decision.

**Status:** **PLANNED**

---

### Phase 24 — Backlinks and Knowledge Discovery

**Objective:** Extend existing backlinks and Discovery into proactive knowledge discovery.

**Important:** Basic backlinks, relation backlinks, unresolved/ambiguous links, and orphan detection already exist.

**Expected features**

- Unlinked-mention detection.
- Suggested links based on titles, aliases, tags, and shared references.
- Duplicate/near-duplicate note detection.
- Orphan/stale note hygiene views.
- Link explanations and confidence, with explicit user acceptance.

**Dependencies:** Phase 6 (search/link index), Phase 27 (advanced search).

**Potential architecture impact**

- Derived suggestion index; no automatic link writes.
- Relevance scoring must be deterministic and local by default.
- Privacy boundary for any future semantic model.

**Acceptance criteria**

- Suggestions never modify notes without explicit action.
- Explanations identify why a suggestion was made.
- Ambiguity is preserved rather than auto-resolved.
- Tests cover ranking, false positives, and refresh behavior.

**Status:** **PLANNED**

---

### Phase 25 — Advanced Markdown

**Objective:** Extend the Markdown authoring experience without breaking the plain-file contract.

**Expected features**

- Footnotes, definition lists, callouts, math, and Mermaid-style diagrams (if approved).
- Table editing affordances.
- Slash commands and block references.
- Better paste handling and Markdown normalization rules.
- Optional frontmatter editing UI with strict validation.

**Dependencies:** Phase 2A (editor), Phase 6 (search), Phase 7A (metadata).

**Potential architecture impact**

- Parser/preview/editor extensions; note format version decision if frontmatter syntax changes.
- Must preserve unknown Markdown and avoid destructive rewrites.
- Feature detection for unsupported constructs.

**Acceptance criteria**

- Files remain readable outside Nodus.
- Source mode remains byte-faithful for unchanged content.
- New syntax degrades gracefully in preview.
- Tests cover round-trip, line endings, and unsupported constructs.

**Status:** **PLANNED**

---

### Phase 26 — Whiteboards and Visual Workspace

**Objective:** Add a canvas for arranging notes, database records, and freeform visual thinking.

**Expected features**

- Canvas with nodes, edges, groups, and annotations.
- Embed notes, database rows, images, and links.
- Pan/zoom, selection, alignment, and keyboard navigation.
- Versioned board file format and portability.
- Optional presentation/export mode.

**Dependencies:** Phase 23 (graph), 25 (Markdown embeds), 27 (search/navigation).

**Potential architecture impact**

- New vault file format and versioning policy.
- Rendering and performance strategy for large boards.
- Stable references to notes/records by ID.

**Acceptance criteria**

- Boards are portable and readable without Nodus where feasible.
- References survive note rename/move by ID.
- Missing targets are diagnosed, not silently dropped.
- Undo/redo and save-conflict behavior are defined.

**Status:** **PLANNED**

---

### Phase 27 — Advanced Search

**Objective:** Evolve the in-memory search into a scalable, persistent, query-capable search system.

**Expected features**

- Persistent incremental index with rebuild and corruption recovery.
- Operators, phrase/prefix/fuzzy matching, field scoping, and saved searches.
- Result grouping, sorting, and pagination.
- Search across database projections and derived values.
- Optional semantic retrieval only with an explicit privacy decision.

**Dependencies:** Phase 6 (current search), Phase 9 review, Phase 15 (query model), Phase 24 (discovery).

**Potential architecture impact**

- Index files inside or beside the vault; backup/rebuild policy.
- Invalidation across external edits and sync.
- Ranking determinism and performance budgets.

**Acceptance criteria**

- Index can be deleted and rebuilt without data loss.
- External edits become visible within a documented bound.
- Search results remain explainable and deterministic by default.
- Benchmarks enforce agreed budgets.

**Status:** **PLANNED**

---

### Phase 28 — AI Integration

**Objective:** Offer optional AI assistance over local knowledge with explicit privacy and provenance.

**Expected features**

- Opt-in provider configuration; local model support if feasible.
- Retrieval over selected notes/databases with citations.
- Summarize, rewrite, and question-answering actions with preview and undo.
- No hidden network calls, telemetry, or vault upload by default.
- Clear separation between generated text and stored user content.

**Dependencies:** Phase 22 (extension boundary), Phase 27 (search/retrieval), Phase 32 (security/privacy).

**Potential architecture impact**

- New network boundary and secret storage.
- Prompt/response logging policy.
- Cost and rate-limit controls.
- Potential vector index storage.

**Acceptance criteria**

- AI is disabled by default and requires explicit configuration.
- Every answer cites the notes used.
- No vault content leaves the machine without informed consent.
- Generated content is never written automatically.
- Failure/offline behavior is explicit.

**Status:** **PLANNED**

---

### Phase 29 — Sync Architecture

**Objective:** Turn the experimental relay/sync foundation into a production multi-device experience.

**Expected features**

- UI onboarding for relay pairing and device management.
- Background sync status, pause/resume, and error recovery.
- Versioned sync metadata outside note content.
- Conflict detection integration with Phase 30.
- Backup/restore and key management for relay data.
- Production packaging and credential storage.

**Dependencies:** Phase 3 (experimental foundation), Phase 8 (storage reliability), Phase 30 (conflict resolution), Phase 32 (security).

**Potential architecture impact**

- Wire `src/relay`/`src/sync` into a supported process boundary.
- Define the supported filesystem and network assumptions.
- No CRDT direction unless explicitly re-decided.

**Acceptance criteria**

- Local-only mode remains fully functional.
- Pairing, revocation, and device loss are recoverable.
- No silent overwrite of divergent edits.
- Sync state and credentials are excluded from note files and portable export.
- End-to-end tests cover restart, offline edits, and conflict paths.

**Status:** **BLOCKED** — requires Phase 30 conflict policy and Phase 32 security decisions before production sync work

---

### Phase 30 — Conflict Resolution

**Objective:** Make every sync conflict explicit, understandable, and recoverable.

**Expected features**

- Edit/edit, edit/delete, move/move, and schema/database conflicts.
- Side-by-side comparison and merge/replace choices.
- Conflict copies with stable naming and preservation.
- Tombstone/restore and bootstrap-required handling.
- Conflict history and recovery guidance.

**Dependencies:** Phase 8 (revision/hash model), Phase 3 (experimental conflict primitives). Integration with Phase 28 after the conflict model is approved.

**Potential architecture impact**

- Shared conflict model between client and relay.
- UI flow for non-text conflicts.
- Never resolve by silent last-write-wins for synced notes.

**Acceptance criteria**

- Divergent content is preserved in every conflict path.
- Users can inspect both sides before choosing.
- Repeated sync attempts do not duplicate conflict copies.
- Tests cover crash and lost-response scenarios.

**Status:** **PLANNED**

---

### Phase 31 — Mobile Experience

**Objective:** Provide a usable mobile or responsive experience without compromising local-first storage.

**Expected features**

- Responsive workspace and touch-optimized navigation/editor.
- Offline-first behavior and mobile-safe file access.
- Optional PWA packaging.
- Mobile sync onboarding and conflict UI.
- Performance and battery budgets.

**Dependencies:** Phase 26 (visual workspace), 29 (sync), 30 (conflicts), 32 (security).

**Potential architecture impact**

- Platform-specific storage adapters or a mobile host.
- Touch/keyboard interaction redesign.
- Background sync constraints.

**Acceptance criteria**

- Core editing works offline.
- No data-loss path on app suspension or storage pressure.
- Touch targets and accessibility meet documented standards.
- Conflict and sync states are understandable on small screens.

**Status:** **PLANNED**

---

### Phase 32 — Security and Privacy

**Objective:** Define and enforce the trust boundary for files, localhost APIs, extensions, sync, and AI.

**Expected features**

- Updated threat model and data-flow inventory.
- Secret/credential storage.
- Backup encryption and key recovery.
- Permission model for plugins/extensions and AI.
- CSP, origin, path allow-list, and dependency-supply-chain hardening.
- Audit log for sensitive operations.

**Dependencies:** Phase 8 (storage), 21 (import), 29 (sync).

**Potential architecture impact**

- Cross-cutting; may change APIs, packaging, and onboarding.
- Encryption/format versioning decisions.
- Clear offline/no-telemetry guarantees.

**Acceptance criteria**

- Every network and filesystem boundary is documented.
- Secrets are never stored in the vault or logs.
- Encryption and key recovery are tested.
- Security-sensitive failures fail closed.
- Dependency policy and review process are documented.

**Status:** **PLANNED**

---

### Phase 33 — Performance and Scalability

**Objective:** Establish measured, enforced performance budgets for large vaults and databases.

**Expected features**

- Persistent/incremental indexes where justified.
- Virtualized and paginated large views.
- Query, formula, relation, graph, and search benchmarks with thresholds.
- Startup and memory budgets.
- Regression detection in CI or a documented nightly job.

**Dependencies:** Phase 9 review, 15 (queries), 23 (graph), 27 (search).

**Potential architecture impact**

- May replace O(n) scans with indexed lookups.
- Cache lifecycle/invalidation redesign.
- Benchmark fixtures and environment policy.

**Acceptance criteria**

- Defined budgets for representative vault sizes.
- Benchmarks run reproducibly and record environment/dataset.
- Regressions block or flag releases.
- No optimization compromises data integrity or portability.

**Status:** **PLANNED**

---

### Phase 34 — Release Preparation

**Objective:** Make releases reproducible, documented, migratable, and recoverable.

**Expected features**

- Versioning and release checklist.
- Packaging and installers for supported platforms.
- CI pipeline with tests, typecheck, build, smoke, and dependency checks.
- Migration/rollback policy for every persistent format.
- Release notes and support documentation.
- Backup/restore verification before release.

**Dependencies:** All prior phases that are in scope for the release.

**Potential architecture impact**

- Build/packaging pipeline and signing.
- Format compatibility and deprecation policy.
- Supported-platform matrix.

**Acceptance criteria**

- Clean-machine install and upgrade are tested.
- Persistent format migrations have fixtures and rollback guidance.
- CI verifies the documented quality gates.
- Release notes accurately state known limitations.

**Status:** **PLANNED**

---

## 5. Feature Inventory

> **Future agents must check this inventory before proposing or implementing a feature.**
> Status values: **Implemented**, **Implemented with limitations**, **Experimental**, **Not implemented**, **Working-tree only**.

### 5.1 Markdown and editor

| Feature | Implementation | Status |
|---|---|---|
| Markdown note body and YAML frontmatter | `src/domain/note.ts`, `src/format/note-format.ts` | Implemented |
| Stable note IDs and path-derived IDs for plain Markdown | `src/domain/ids.ts`, `src/format/note-format.ts` | Implemented |
| Tags and aliases | `src/domain/tags.ts`, `ui/src/editor/TagEditor.tsx` | Implemented |
| Wiki links | `src/links/wikilink.ts`, `ui/src/editor/wikiLinks.ts` | Implemented |
| CodeMirror Live/Source/Preview modes | `ui/src/editor/CodeMirrorEditor.tsx`, `ui/src/Editor.tsx` | Implemented |
| Formatting commands and toolbar | `ui/src/editor/markdownCommands.ts`, `MarkdownToolbar.tsx` | Implemented |
| GFM task lists | `ui/src/editor/taskList.ts`, `taskMarkers.ts` | Implemented |
| Markdown preview | `ui/src/editor/MarkdownPreview.tsx` | Implemented |
| Page icons | `ui/src/PageIconPicker.tsx`, `src/ui-server/page-icon.ts` | Implemented |
| Managed attachments and image paste/drop | `src/storage/fs/attachments.ts`, `ui/src/editor/AttachmentBrowser.tsx` | Implemented |
| Autosave and save states | `ui/src/scheduleAutosave.ts`, `ui/src/App.tsx` | Implemented |
| Draft recovery | `ui/src/draftRecoveryJournal.ts`, `ui/src/editor/DraftRecoveryDialog.tsx` | Implemented |
| External change and conflict dialogs | `ui/src/editor/ConflictResolutionDialog.tsx`, `ExternalChangeDialog.tsx` | Implemented |
| Block editor / slash menu / drag blocks | — | Not implemented |
| Footnotes, math, callouts, diagrams | — | Not implemented (Phase 24) |

### 5.2 Vault and filesystem

| Feature | Implementation | Status |
|---|---|---|
| Filesystem vault open/create | `src/storage/fs/vault.ts` | Implemented |
| Note CRUD, move, delete | `src/storage/fs/vault.ts` | Implemented |
| Folder create/rename/move/delete | `src/storage/fs/folders.ts` | Implemented |
| Path safety and symlink rejection | `src/storage/fs/safe-path.ts`, `src/domain/paths.ts` | Implemented |
| Atomic file writes | `src/storage/fs/atomic.ts` | Implemented |
| Cross-process root lock | `src/storage/fs/root-lock.ts` | Implemented for cooperating processes |
| Conditional writes (`expectedHash`) | `src/storage/fs/vault.ts` | Implemented |
| Duplicate-ID detection | `src/storage/fs/vault.ts` | Implemented |
| Storage health checks | `src/storage/fs/vault.ts`, `ui/src/SettingsView.tsx` | Implemented with hidden-metadata gaps |
| Per-user vault preference | `src/ui-server/app-preferences.ts` | Implemented |
| Vault root allow-list | `src/ui-server/api.ts` | Implemented |
| Filesystem watcher for editor reload | — | Not implemented (derived snapshot watcher only) |
| Trash / undo deletion | — | Not implemented |

### 5.3 Navigation and organization

| Feature | Implementation | Status |
|---|---|---|
| Sidebar navigation | `ui/src/Sidebar.tsx` | Implemented |
| Folder/note tree | `ui/src/PageTree.tsx` | Implemented |
| Sidebar resize/collapse | `ui/src/App.tsx`, `react-resizable-panels` | Implemented |
| Keyboard tree navigation | `ui/src/PageTree.tsx` | Implemented |
| Move note/folder | `ui/src/NoteDialogs.tsx`, folder dialogs | Implemented via dialogs |
| Drag-and-drop moves | — | Not implemented |
| Breadcrumb | `ui/src/Editor.tsx` | Display only |
| Backlinks panel | `ui/src/BacklinksPanel.tsx` | Implemented — incoming and outgoing wiki links |
| Link repair suggestions and disambiguation | `src/links/link-repair.ts`, `ui/src/DiscoveryView.tsx` | Implemented — deterministic local suggestions, explicit action |
| Safe single-occurrence link rewrite | `src/links/link-edit.ts`, `POST /api/notes/:id/links/repair` | Implemented — revision-checked, stable-ID pinned by default |
| Rename-safe title links | `src/ui-server/api.ts`, `src/links/link-repair.ts` | Implemented — previous title retained as alias when incoming title links exist |
| Relation backlinks | `ui/src/RelationBacklinksPanel.tsx` | Implemented |
| Local graph view | `ui/src/GraphView.tsx`, `src/links/graph.ts`, `ui/src/graph-model.ts` | Implemented — interactive graph, filters, unresolved targets, 200-node display bound |
| Discovery view | `ui/src/DiscoveryView.tsx` | Implemented — unresolved, ambiguous, isolated notes |
| Command palette | `ui/src/CommandPalette.tsx` | Implemented |

| Local graph view | `ui/src/GraphView.tsx`, `src/links/graph.ts` | Implemented (basic, 200 nodes) |
| Discovery view | `ui/src/DiscoveryView.tsx` | Implemented |
| Command palette | `ui/src/CommandPalette.tsx`, `ui/src/commands.ts` | Implemented — categories, keyword search, shortcut labels, deduplication, errors |
| Shortcut registry and reference | `ui/src/shortcuts.ts`, `ui/src/ShortcutReferenceDialog.tsx` | Implemented |
| Recent-note quick switcher | `ui/src/recentNavigation.ts`, `ui/src/RecentNotesDialog.tsx` | Implemented, local per-vault history |
| Saved navigation state (expanded folders, sidebar width) | `ui/src/PageTree.tsx`, localStorage | Implemented |

### 5.4 Search

| Feature | Implementation | Status |
|---|---|---|
| Title/alias/path/body/tag/property search | `src/search/search-index.ts` | Implemented |
| Deterministic ranking | `src/search/search-index.ts` | Implemented |
| Unicode-safe snippets | `src/search/search-index.ts` | Implemented |
| Metadata filters (AND/OR) | `src/search/note-filters.ts` | Implemented |
| Search result palette | `ui/src/CommandPalette.tsx`, `ui/src/useNoteSearch.ts` | Implemented |
| Sidebar search | `ui/src/Sidebar.tsx` | Implemented |
| Snapshot cache / invalidation | `src/indexing/snapshot-cache.ts` | Implemented |
| Persistent search index | — | Not implemented |
| External-edit freshness guarantee | — | Not implemented (TTL/refresh only) |

### 5.5 Database schemas

| Feature | Implementation | Status |
|---|---|---|
| Database definition v1–v3 | `src/database/schema.ts` | Implemented |
| Base property types | `src/database/schema.ts` | Implemented |
| Relation/rollup properties (v2) | `src/database/schema.ts` | Implemented |
| Formula properties (v3) | `src/database/schema.ts` | Implemented |
| Stable property/option IDs | `src/database/schema.ts` | Implemented |
| Row membership in `nodus_data` | `src/database/note-properties.ts` | Implemented |
| Explicit add-note membership flow | `ui/src/DatabasesView.tsx`, `src/ui-server/api.ts` | Implemented |
| Schema create/rename/add property | `ui/src/DatabasesView.tsx` | Implemented |
| Property type change | — | Not implemented |
| Property/option deletion UI | — | Not implemented |
| Database deletion UI | — | Not implemented |
| General property catalog | `src/properties/catalog.ts` | Implemented (separate from DB schemas) |

### 5.6 Database layouts

| Feature | Implementation | Status |
|---|---|---|
| Table view | `ui/src/DatabasesView.tsx` | Implemented, virtualized |
| List view | `ui/src/DatabaseLayouts.tsx` | Implemented, virtualized |
| Kanban view | `ui/src/DatabaseLayouts.tsx` | Implemented |
| Calendar view | `ui/src/DatabaseLayouts.tsx` | Implemented |
| Gallery view | `ui/src/DatabaseLayouts.tsx` | Implemented (no image preview) |
| Grouping | `ui/src/DatabaseLayouts.tsx`, `database-view-layout.ts` | Implemented |
| Sorting / multi-sort | `ui/src/database-table.ts` | Implemented |
| Typed filters | `ui/src/database-table.ts` | Implemented |
| Property visibility | `ui/src/DatabasesView.tsx` | Implemented |
| Saved view CRUD and ordering | `ui/src/SavedViewControls.tsx`, `src/database/database-view-order.ts` | Implemented |
| Gallery image previews | — | Not implemented |

### 5.7 Relations and rollups

| Feature | Implementation | Status |
|---|---|---|
| Single/multiple forward relations | `src/database/relation-contract.ts`, `relations.ts` | Implemented |
| Reverse relation projection | `src/database/relations.ts` | Implemented |
| Relation picker and server search | `ui/src/RelationControl.tsx`, `src/ui-server/api.ts` | Implemented |
| Relation backlinks | `src/database/relations.ts`, `ui/src/RelationBacklinksPanel.tsx` | Implemented |
| Rollup: count | `src/database/relations.ts` | Implemented |
| Rollup: conditional count | `src/database/relations.ts` | Implemented |
| Rollup: sum | `src/database/relations.ts` | Implemented |
| Rollup: count non-empty | `src/database/relations.ts` | Implemented |
| Rollup: average / min / max | `src/database/relations.ts` | Implemented |
| Rollup: completed task count | `src/database/relations.ts` | Implemented |
| Rollup: completion percentage | `src/database/relations.ts` | Implemented |
| Persistent relation index | — | Not implemented |

### 5.8 Formula engine

| Feature | Implementation | Status |
|---|---|---|
| Tokenizer/parser/validator/evaluator | `src/database/formula-*.ts` | Implemented |
| Arithmetic, comparison, logical, `if` | `src/database/formula-engine.ts` | Implemented |
| String/number/date functions | `src/database/formula-engine.ts` | Implemented |
| Relation-aware functions | `src/database/formula-engine.ts` | Implemented |
| Cycle/dependency detection | `src/database/relations.ts` | Implemented |
| Query integration (sort/filter/group) | `src/database/relations.ts`, `ui/src/database-table.ts` | Implemented |
| Formula editor and preview | `ui/src/database/FormulaEditor*.tsx` | Implemented |
| Direct relation/select/multi-select formula inputs | — | Not implemented |
| Formula docs for `related*` functions | `docs/database-formulas.md` | Missing / stale |

### 5.9 Database automations

| Feature | Implementation | Status |
|---|---|---|
| Strict, UUID-referenced automation definitions | `src/database/automations.ts`, `src/storage/fs/vault.ts` | Implemented (format v1) |
| Record-created, property-updated, record-deleted, condition-entered triggers | `src/ui-server/api.ts` | Implemented in local API request path |
| Typed conditions and ordered property actions | `src/database/automations.ts`, `ui/src/DatabaseAutomations.tsx` | Implemented with supported-action limits |
| Deterministic execution, deduplicated claims, history | `src/storage/fs/vault.ts`, `src/ui-server/api.ts` | Implemented; append-only history |
| Automation management UI | `ui/src/DatabaseAutomations.tsx` | Implemented; relation assignments not exposed in UI |
| Backup/export/import/restore | `src/storage/backup/backup.ts`, `src/storage/portable/` | Implemented (backup manifest v7) |

### 5.10 Templates

| Feature | Implementation | Status |
|---|---|---|
| Versioned note/database template catalog | `src/database/templates.ts`, `.nodus-templates/templates.json` | Implemented (format v1) |
| Note template metadata and typed variables | `src/database/templates.ts`, `ui/src/TemplatesView.tsx` | Implemented |
| Database template schema, views, starter rows | `src/database/templates.ts`, `src/ui-server/api.ts` | Implemented; schema designer reuses capture from an existing database |
| Preview and explicit safe apply | `ui/src/TemplatesView.tsx`, `src/storage/fs/vault.ts` | Implemented |
| Read-only catalog and interrupted-apply health diagnostics | `src/storage/fs/vault.ts`, `ui/src/SettingsView.tsx` | Implemented; optional catalog absence is healthy |
| Staged database-template apply and inode-checked rollback | `src/storage/fs/vault.ts`, `src/storage/fs/atomic.ts` | Implemented; cooperative-lock and crash-recovery limits documented |
| Template portability | `src/storage/portable/`, `src/storage/backup/backup.ts` | Implemented (backup manifest v7) |

### 5.11 Backup and restore

| Feature | Implementation | Status |
|---|---|---|
| Byte-for-byte backup | `src/storage/backup/backup.ts` | Implemented |
| SHA-256 manifest and digest | `src/storage/backup/backup.ts` | Implemented |
| Manifest versions 1–7 | `src/storage/backup/backup.ts` | Implemented; reads legacy versions 1–6 |
| Backup validation | `src/storage/backup/backup.ts` | Implemented |
| Restore preview and conflicts | `src/storage/backup/backup.ts` | Implemented |
| Restore merge, explicit overwrite | `src/storage/backup/backup.ts`, `src/storage/fs/vault.ts` | Implemented |
| Portable export/import | `src/storage/portable/` | Implemented |
| Backup encryption | — | Not implemented |
| Scheduled/background backups | — | Not implemented |
| Transactional restore / rollback | — | Not implemented |

### 5.12 Performance and reliability

| Feature | Implementation | Status |
|---|---|---|
| Parse cache reused only for identical hashes | `src/storage/fs/vault.ts` | Implemented |
| Database row snapshot cache | `src/storage/fs/vault.ts` | Implemented |
| Snapshot reconciler/watcher | `src/storage/fs/snapshot-reconciler.ts` | Implemented |
| Search TTL snapshot cache | `src/indexing/snapshot-cache.ts` | Implemented |
| Virtualized Table/List | `@tanstack/react-virtual` | Implemented |
| Benchmarks for search/database/formulas/relations | `benchmark/` | Implemented |
| CI performance thresholds | — | Not implemented |
| Persistent/incremental index | — | Not implemented |
| Multi-process cache lifecycle proof | — | Not verified |

### 5.13 UI and accessibility

| Feature | Implementation | Status |
|---|---|---|
| shadcn/ui primitives | `ui/src/components/ui/**` | Implemented |
| Semantic design tokens and dark mode | `ui/src/index.css`, `DESIGN.md` | Implemented |
| Keyboard navigation for tree/menus/dialogs | `ui/src/**` | Implemented |
| Focus restoration and modal focus traps | `ui/src/**` | Implemented |
| Skip links and landmarks | `ui/src/LandingPage.tsx`, `ui/src/App.tsx` | Implemented |
| Live save/error announcements | `ui/src/Editor.tsx`, `ui/src/App.tsx` | Implemented |
| Automated accessibility audit | — | Not implemented |
| Reproducible manual accessibility evidence | — | Partial (user-confirmed only) |

### 5.14 Testing and development tooling

| Feature | Implementation | Status |
|---|---|---|
| Unit/integration test suite | `test/` | 98 files / 1,137 executed tests |
| Browser smoke | `scripts/browser-smoke.mjs` | Implemented |
| Database-view smoke | `scripts/database-views-smoke.mjs` | Implemented |
| Vault onboarding smoke | `scripts/vault-onboarding-smoke.mjs` | Implemented |
| Editor/draft/conflict/attachment smokes | `scripts/editor-*-smoke.mjs`, etc. | Implemented (manual commands) |
| Search benchmark | `pnpm bench:search` | Implemented |
| Database benchmarks | `pnpm bench:databases` | Implemented |
| Graph relationship benchmark | `pnpm bench:graph` | Implemented |
| Browser database performance smoke | `pnpm bench:database-ui` | Implemented |
| Bundle analysis | `pnpm analyze:bundle` | Implemented |
| CI pipeline | `.github/` | Not present |

---

## 6. Architecture and Technical Decision Records

### ADR-001 — Local-first application architecture

**Decision:** Nodus is a local-first application. The browser UI talks only to a loopback Node API; the vault is a local directory. Network services are optional and experimental.

**Why:** User ownership, offline use, and file portability are product commitments.

**Consequences:** Core features must not require an account, cloud service, or network. The relay/sync layer must remain optional. Any future AI or sync feature must have an explicit opt-in and documented data flow.

**References:** `PRODUCT.md`, `README.md` (Privacy), `src/ui-server/api.ts`, `ui/vite.config.ts`.

---

### ADR-002 — Markdown is the primary note format

**Decision:** Notes are ordinary Markdown files. YAML frontmatter is optional but preserved when present. The note body is the source of truth; the editor uses decorations rather than a rich-text document model.

**Why:** Portability and long-term readability outside Nodus.

**Consequences:** No block-database note format. Formatting must remain representable in Markdown. Unknown frontmatter is preserved. Mixed line endings are not guaranteed. Rich features such as whiteboards need a separate versioned format, not a replacement for Markdown.

**References:** `src/format/note-format.ts`, `docs/note-format.md`, `ui/src/editor/liveMarkdown.ts`.

---

### ADR-003 — Stable IDs instead of path-based identity

**Decision:** Nodus-format notes use a UUID v4 in `nodus.id`. Path is location metadata. Plain Markdown without frontmatter gets a deterministic path-derived ID until a Nodus-managed move writes metadata.

**Why:** Renames and moves must not break wiki links, relations, or database membership.

**Consequences:** Moves preserve identity. Duplicate IDs are a vault-level error. External moves of plain notes change their derived identity until metadata is added. Relations and views reference stable IDs, never paths or titles.

**References:** `src/domain/ids.ts`, `src/format/note-format.ts`, `docs/note-format.md` (Stable IDs and paths), `src/database/note-properties.ts`.

---

### ADR-004 — Filesystem storage contracts and vault layout

**Decision:** Storage is defined by filesystem-independent contracts and implemented by `FileSystemVault`. The vault layout is:

```text
<vault>/<note-path>.md
<vault>/databases/<database-id>.json
<vault>/database-views/<database-id>/<view-id>.json
<vault>/properties/catalog.json
<vault>/attachments/<uuid>-<name>
<vault>/.nodus-orders/database-views/<database-id>.json
<vault>/.nodus-automations/automations.json        # automation definitions
<vault>/.nodus-automations/history.json           # execution history
<vault>/.nodus-templates/templates.json           # local note/database templates
```

**Why:** Portable files, predictable paths, and a replaceable storage adapter.

**Consequences:** Reserved namespaces cannot contain notes. Hidden directories are not scanned. Database definitions and saved views are separate versioned files. Rows live in note frontmatter, not database JSON. Deleting a database does not cascade-delete views.

**References:** `src/storage/contracts.ts`, `src/storage/fs/layout.ts`, `docs/storage.md` (Vault layout), `docs/templates.md`.

---

### ADR-005 — Atomic writes, revisions, and vault-root locking

**Decision:**

- Each file write uses a temporary sibling, write, `fsync`, and rename.
- Revision token is the SHA-256 of the raw file bytes.
- Mutations optionally accept `expectedHash`; a mismatch throws `STALE_WRITE` and writes nothing.
- Mutations are serialized by a process-local queue plus a cross-process `.nodus-vault-write.lock` file.

**Why:** Prevent half-written files and detect stale edits across UI, CLI, and multiple Nodus processes.

**Consequences:** No multi-file transaction or rollback. Locking is cooperative and does not protect against external editors or network filesystems. The hash-check → rename window is not an OS-level compare-and-swap. A stale lock requires manual recovery.

**References:** `src/storage/fs/atomic.ts`, `src/storage/fs/root-lock.ts`, `src/storage/fs/vault.ts`, `docs/storage.md` (Safe writes, Concurrency).

---

### ADR-006 — Database metadata and derived projections

**Decision:**

- Database schemas live in separate JSON definitions.
- Membership and stored row values live in the note’s `nodus_data` frontmatter.
- Select values store option UUIDs; relations store note UUIDs.
- Reverse relations, rollups, and formulas are derived projections and are never persisted.
- Saved views are separate versioned JSON files; view ordering is a separate manifest.

**Why:** Portability, stable references, and no duplication of note content.

**Consequences:** Row reads scan notes and project values. Deleting a note can dangle relation IDs without cascading. Schema changes must preserve note values. Derived values cannot be edited. Backup/import must include schemas, views, order, and note metadata.

**References:** `docs/structured-data-adr.md`, `src/database/note-properties.ts`, `src/database/database-view.ts`, `src/database/database-view-order.ts`, `docs/database-relations.md`.

---

### ADR-007 — Formula validation and bounded evaluation

**Decision:** Formulas use a hand-written tokenizer, parser, validator, and evaluator with bounded resources. No `eval`, `Function`, or arbitrary code execution. Formula values are derived and never persisted.

**Why:** Safety, deterministic results, and portability.

**Consequences:** Limited language surface, explicit type system, bounded loops/expressions, and per-record error isolation. Relation access is only through `related*` functions. Formula errors are excluded from filters and sort keys.

**References:** `src/database/formula-contract.ts`, `src/database/formula-tokenizer.ts`, `src/database/formula-engine.ts`, `docs/database-formulas.md`.

---

### ADR-008 — Backup format compatibility and versioning

**Decision:** Every persistent format has an integer version. Backup manifests are written last, list every file with kind, stable ID, path, SHA-256, and byte length, and include a canonical digest. Newer versions are rejected with `UNSUPPORTED_VERSION`; older readers do not silently downgrade.

**Why:** Detect incomplete or corrupt backups and keep restore behavior predictable.

**Consequences:** Adding new vault data requires a manifest version bump and reader compatibility. Phase 13 raises the writer to v7 for the optional template catalog; readers support manifests 1–7, with older versions retaining their existing behavior. Backups are integrity checks, not authenticated signatures. Backup/export are not point-in-time snapshots across all file classes.

**References:** `src/storage/backup/backup.ts`, `docs/storage.md` (Backup and recovery), `README.md` (Compatibility policy).

---

### ADR-009 — shadcn/ui-first component reuse

**Decision:** UI work composes the existing shadcn/ui primitives in `ui/src/components/ui` and established product compositions. Custom domain components may exist, but their controls, menus, dialogs, inputs, and feedback must reuse shared primitives and semantic tokens.

**Why:** Consistent behavior, accessibility, keyboard support, and maintainability.

**Consequences:** Do not replace or reinstall components during routine feature work. Avoid nested overlays. Never use a tooltip as the only access to an action. Preserve local customizations. Add a dependency only when existing primitives cannot reasonably satisfy the need.

**References:** `AGENTS.md`, `ui/src/components/ui/**`, `DESIGN.md`.

---

### ADR-010 — Minimal, justified dependencies

**Decision:** Keep the dependency surface small and purposeful. Prefer platform APIs and existing code. Add a dependency only when it clearly removes risk or complexity and is compatible with the local-first constraint.

**Why:** Security, bundle size, maintainability, and long-term portability.

**Consequences:** New dependencies require justification in the change description. Avoid overlapping libraries. Keep Node and pnpm versions aligned with verified tooling. Fonts and assets should not add hidden network dependencies without an explicit decision.

**References:** `package.json`, `pnpm-lock.yaml`, `AGENTS.md`.

---

### ADR-011 — Loopback-only UI API with allow-lists

**Decision:** The local API binds to `127.0.0.1`, validates request origin, decodes UTF-8 strictly, limits body sizes, and restricts typed vault/backup paths to configured roots. Native folder selection is an explicit user action.

**Why:** A localhost API is still reachable by local processes and malicious web pages; path allow-lists and origin checks reduce accidental exposure.

**Consequences:** `NODUS_VAULT_ROOTS` and `NODUS_BACKUP_ROOTS` define typed-path permissions. The home directory is not implicitly allowed. Symlinks are resolved before containment checks. These controls are defense-in-depth, not a substitute for OS permissions.

**References:** `src/ui-server/api.ts`, `ui/vite.config.ts`, `README.md` (Local UI), `docs/storage.md` (Vault switching allow-list).

---

### ADR-012 — Separate general property catalog from database schemas

**Decision:** The vault-wide `properties/catalog.json` catalog is separate from per-database schemas. General note properties use top-level YAML keys; database rows use `nodus_data` with database property UUIDs.

**Why:** Allow metadata on any note without forcing database membership, while keeping database schemas portable and independent.

**Consequences:** They have different formats, validation, select-value semantics, and deletion rules. Do not merge them casually. Cross-feature work must state which system it targets. Docs must not conflate them.

**References:** `docs/property-format.md`, `docs/structured-data-adr.md`, `src/properties/catalog.ts`, `src/database/note-properties.ts`.

---

### ADR-013 — Experimental sync remains outside the product boundary

**Decision:** The relay and sync client are prototype code. They are not wired to the UI, npm scripts, or a package `bin`. Sync metadata stays outside Markdown and outside the vault content format.

**Why:** Multi-device sync requires production conflict, security, and recovery decisions that are not complete.

**Consequences:** Treat `src/relay/` and `src/sync/` as library/test code only. Do not present sync as available. Phase 28 must explicitly promote, replace, or retire this code.

**References:** `src/relay/`, `src/sync/`, `docs/phase3/`, `README.md` (Scope and deferrals).

---

## 7. Data and Format Compatibility Matrix

| Format | Identifier | Versions | Location | Notes |
|---|---|---|---|---|
| Note | `nodus.version` | 1 | Any visible `*.md` | Plain Markdown has no stored ID |
| Database definition | `nodus-database` | 1–3 | `databases/<uuid>.json` | v2 relations/rollups; v3 formulas |
| Note database values | `nodus-note-properties` | 1 | Note frontmatter `nodus_data` | Derived values rejected |
| General property catalog | `nodus-property-catalog` | 1 | `properties/catalog.json` | Optional file |
| Saved view | `nodus-database-view` | 1–3 | `database-views/<db>/<view>.json` | v3 sorts and empty filters |
| Saved-view order | `nodus-database-view-order` | 1 | `.nodus-orders/database-views/<db>.json` | Hidden manifest |
| Automation definitions | `nodus-database-automations` | 1 | `.nodus-automations/automations.json` | Implemented in Phase 12 |
| Automation history | `nodus-automation-history` | 1 | `.nodus-automations/history.json` | Implemented in Phase 12; append-only |
| Template catalog | `nodus-templates` | 1 | `.nodus-templates/templates.json` | Implemented in Phase 13; portable |
| Template-application journal | `nodus-template-apply-transaction` | 1 | `.nodus-tmp-template-apply-<uuid>/manifest.json` | Ephemeral recovery journal; never part of backup/export |
| Backup manifest | `nodus-backup` | 1–7 | Backup root `nodus-backup.json` | Written last; v7 includes the template catalog |
| App preferences | versioned JSON | 1 | Per-user config directory | Outside vault |
| Sync state | SQLite | internal | `.nodus/sync.sqlite` | Experimental, outside vault content |

**Compatibility rules**

- Readers accept only implemented versions; newer versions are rejected with `UNSUPPORTED_VERSION`.
- Writers emit the lowest compatible version.
- Unknown top-level note keys are preserved; unknown keys under `nodus`, in database files, views, and catalogs are rejected.
- A new persistent format or field requires a version decision and tests before shipping.
- Do not silently rewrite malformed or future-version files.

---

## 8. Verification and Development Tooling

### Required environment

- Node.js **24.0.0 or later** (declared engine; the current development shell may still be on Node 22, which emits an engine warning).
- pnpm **11.9.0**.

### Commands

| Command | Purpose |
|---|---|
| `pnpm test` | Full Vitest suite |
| `pnpm typecheck` | Root and UI TypeScript projects |
| `pnpm build` | Production Vite build |
| `pnpm dev` | Local dev server (5173) |
| `pnpm preview` | Production preview (4173) |
| `pnpm test:browser` | Playwright browser workspace smoke |
| `pnpm test:database-views` | Saved views, layouts, relations, rollups, formulas smoke |
| `pnpm test:vault-onboarding` | First-run/recovery vault flow |
| `pnpm bench:search` | Search performance benchmark |
| `pnpm bench:databases` | Database rows/query/relation/formula benchmarks |
| `pnpm bench:graph` | Relationship indexing and graph projection benchmark |
| `pnpm bench:database-ui` | Chromium 5,000-row layout performance |
| `pnpm analyze:bundle` | Build chunk attribution |

Manual smoke scripts (not package scripts): `scripts/attachments-smoke.mjs`, `discovery-smoke.mjs`, `editor-conflict-resolution-smoke.mjs`, `editor-draft-recovery-smoke.mjs`, `editor-external-touch-smoke.mjs`, `editor-markdown-smoke.mjs`, `editor-shortcuts-smoke.mjs`, `graph-smoke.mjs`, `relations-smoke.mjs`, `search-smoke.mjs`, `sidebar-smoke.mjs`.

### Test suite shape

- **98 test files, 1,137 executed tests** in the combined Phase 15–17 integration verification.
- Unit tests use Node; UI component tests use `react-dom/server` SSR rather than a DOM emulator.
- Real browser coverage is Playwright-based and requires Chromium.
- Relay/sync tests use loopback HTTP and isolated SQLite databases.
- Storage tests use temporary directories and never touch a real vault.
- There is **no CI workflow**. Test runs are local and must be reported honestly.

### Verification expectations for future changes

- Storage/format changes: focused storage tests, `pnpm typecheck`, and `pnpm build`.
- UI changes: relevant UI tests plus `pnpm test:browser` when interaction changes.
- Database/query/formula changes: focused database tests and the relevant benchmark if performance-sensitive.
- Documentation-only changes: `git diff --check`; no product tests are required, but claims must be verified against code.

---

## 9. Known Limitations and Risk Register

| ID | Area | Limitation | Impact | Mitigation / next step |
|---|---|---|---|---|
| L-01 | Storage | Cooperative lock only; external editors can race | Possible stale overwrite outside Nodus | Keep `expectedHash`; document external-editor behavior |
| L-02 | Storage | Generic imports/restores still lack multi-file transactionality | Partial imports/restores | Report `PARTIAL_WRITE`; consider a journal in Phase 21/33 |
| L-03 | Storage | Every ID lookup scans all notes | Slow large vaults | Persistent index (Phase 26/32) |
| L-04 | Storage | One malformed note blocks strict operations | Backup/export unavailable | Health diagnostics; fix or move the file |
| L-05 | Storage | Health checks cover supported hidden metadata, but not every future managed file | Future hidden formats may be missed | Add diagnostics with each new storage contract |
| L-06 | Storage | Hidden dirs and symlinks unsupported | Some user layouts excluded | Documented limitation |
| L-07 | Storage | Atomic rename does not preserve mode/ACL/xattrs | Metadata loss on replace | Evaluate preserving metadata |
| L-08 | Backup | No encryption or authentication | Backup confidentiality/integrity limits | Phase 31 |
| L-09 | Backup | No transactional restore | Partial restore possible | Journal/rollback design |
| L-10 | Backup | Backup/export not point-in-time coherent | Mixed revisions possible | Acquire a broader snapshot or document bound |
| L-11 | Backup | Export has no completeness manifest | Interrupted export can be a valid subset | Export manifest in a later format |
| L-12 | Search | In-memory TTL index | External edits delayed | Persistent index (Phase 26) |
| L-13 | Search | Literal substring matching only | Limited recall/ranking | Phase 26 |
| L-14 | Database | No property/option deletion or type migration in UI | Schema evolution limited | Phase 15 |
| L-15 | Database | No database deletion UI | Orphan definitions remain | Phase 15 |
| L-16 | Database | Row reads scan all notes | ~4.5 s at 5,000 notes historical | Phase 9 review / 31 |
| L-17 | Database | View filter/validator mismatch for rollup/formula empty filters | Some valid-looking UI filters cannot be saved | Align `filterOperators` and `diagnoseDatabaseView` |
| L-18 | Relations | No persistent relation index | Whole-vault projection cost | Phase 9/32 |
| L-19 | Relations | Candidate search truncated at 50, no pagination | Large target sets hard to browse | Add pagination in Phase 15/33 |
| L-20 | Formulas | Direct relation/select/multi-select inputs unsupported | Formula expressiveness limited | Document; design in Phase 15 |
| L-21 | Formulas | Docs omit `related*` functions | Agents may duplicate or avoid them | Update `docs/database-formulas.md` |
| L-22 | Views | Gallery has no image preview | Feature appears incomplete | Phase 10 follow-up |
| L-23 | Views | Kanban/Calendar/Gallery not virtualized | Large-view performance risk | Phase 32 |
| L-24 | Views | Calendar create is two writes | Note may be created without date | Atomic flow in Phase 18 |
| L-25 | Editor | Mixed line endings not preserved | Byte-level surprise | Document; avoid rewriting unchanged lines |
| L-26 | Editor | No block editor/slash menu | Authoring UX gap | Phase 24 |
| L-27 | Navigation | No drag-and-drop, breadcrumb not clickable | Slower organization | Phase 4 follow-up or Phase 30 |
| L-28 | Graph | 200-node limit, derived only | Large graphs truncated | Phase 22 |
| L-29 | Sync | Experimental and unwired | No multi-device support | Phase 28/29 |
| L-30 | Sync | No production credential storage or encryption | Not release-safe | Phase 28/32 |
| L-31 | Testing | No CI pipeline | Regressions found late | Phase 33 |
| L-32 | Testing | No automated accessibility audit | Accessibility regressions possible | Add axe/AT checks |
| L-33 | Docs | Multiple docs stale (attachments, relations, gallery, formula functions, watcher) | Agents may misread current state | Update docs when implementation changes |
| L-34 | Working tree | Uncommitted typography/landing/editor changes and untracked local files remain | Separate work may overlap future edits | Preserve and confirm scope before editing |
| L-35 | Fonts | Working-tree Google Fonts update loads from the network | Offline font fallback; privacy/network consideration until committed | Self-host if offline fidelity is required |
| L-36 | Performance | No CI budgets; measurements historical | Optimization claims unproven | Phase 32 |
| L-37 | Testing | Parallel full-suite runs timed out storage/API tests at 5 s on the current machine (Node 24.18.1); the same tests pass in a serial full-suite run | Verification can look red for environmental reasons | Keep the 5-second assertions; use a serial full-suite run as authoritative on this host |
| L-38 | Automations | Execution history is append-only and has no retention limit | Long-lived vaults can accumulate a large history file and slower claim checks | Design bounded retention without weakening duplicate-event protection |
| L-39 | Templates | Prepared template journals require an explicit apply to recover; automatic background repair is intentionally absent | A vault can remain blocked from backup/export until the user retries an apply or manually inspects an invalid journal | Follow health guidance; never delete journals or unverified targets automatically |
| L-40 | Testing | Parallel full-suite runs are sensitive to fixed 5-second test timeouts under load | Unrelated integration tests can time out when many workers run together | Use `pnpm exec vitest run --no-cache --maxWorkers=1` on this host; review timeout policy separately |
| L-41 | Links | Repair suggestions are lexical only | Topically related but differently worded notes are not suggested | Treat suggestions as a shortcut, not a replacement for search; semantic ranking remains future work |
| L-42 | Links | Path links still break when a note moves | `[[folder/old-path]]` references become unresolved | Use ID-pinned links; repair explicitly from Discovery |
| L-43 | Links | Rename alias preservation depends on a successful whole-vault link scan | A malformed unrelated note can skip preservation while the save still succeeds | Health diagnostics identify malformed notes; the save is never blocked |
| L-44 | Links | Repair is one occurrence per request | Large broken-link sets need repeated actions | A bounded repair-all workflow is future work; no silent bulk rewrite exists |

---

## 10. Development Session Log

Append a new entry after every significant task. Do not rewrite history; correct it with a dated note.

### Entry template

```markdown
### YYYY-MM-DD — Phase N — Task summary

- **Status:** COMPLETE / PARTIAL / BLOCKED / NEEDS REVIEW
- **Summary:**
- **Files changed:**
- **Tests executed:**
- **Commit:**
- **Remaining work:**
- **Notes / decisions:**
```

### 2026-11-02 — Documentation — Establish master development roadmap

- **Status:** COMPLETE (documentation only)
- **Summary:** Inspected the repository, source tree, storage/database/UI architecture, tests, scripts, benchmarks, documentation, Git history, and working-tree state. Created `docs/ROADMAP.md` as the single source of truth for completed milestones, current status, proposed Phases 12–32, feature inventory, architecture decisions, risks, and future-agent workflow.
- **Files changed:** `docs/ROADMAP.md` (new). No product source was modified.
- **Tests executed:** `pnpm typecheck` passed. `pnpm test` under the default parallel runner: 81/89 files passed, 1,045 tests passed, 17 tests timed out at the 5-second limit across 8 files (relations, sync client, storage backup/order/properties/views, UI relations, and uncommitted automation API tests). A targeted rerun of those 8 files with `--maxWorkers=1` passed: 8 files / 82 tests. `git diff --check -- docs/ROADMAP.md` passed.
- **Commit:** `docs: establish master development roadmap` (this commit; use `git log -1` for the hash).
- **Remaining work:** Phase 9 still needs review; Phase 12 automation work remains uncommitted; documentation drift is listed in L-33; the default full-suite timeout behavior should be rechecked on Node 24 with a dedicated run.
- **Notes / decisions:** Verified `HEAD` as `02e62151ee23b648453ff24a168e40671af4490c`. The working tree contained unrelated changes and an uncommitted Phase 12 implementation; those were preserved and were not part of the roadmap commit. Historical Phase 4–6 and 10 labels are reconstructed from commit chronology because the repository has no phase tags. Test timeouts were environment/load-sensitive: the same files passed sequentially, so they are not recorded as product regressions without further evidence.

### 2026-11-02 — Phase 12 — Database Automations

- **Status:** COMPLETE WITH LIMITATIONS
- **Summary:** Delivered local database automations with stable UUID references, four triggers, typed conditions, ordered property actions, event claims, execution history, management UI, and backup/export/import/restore support. Backup manifest v6 remains compatible with v1–v5. See `docs/database-automations.md` for execution and failure semantics.
- **Files changed:** `src/database/automations.ts`, storage contracts/vault/backup/portable layers, local API and DTO, `ui/src/DatabaseAutomations.tsx`, database view integration, automation tests, browser smoke coverage, and documentation.
- **Tests executed:** Focused automation model/API tests (9 passed); `pnpm exec vitest run --no-cache --maxWorkers=2` (89 files / 1,062 tests passed); `pnpm typecheck`; `pnpm build`; `pnpm test:database-views`; `pnpm test:browser`; `pnpm test:vault-onboarding`; `pnpm bench:databases`; `git diff --check` — all passed. The build emitted the existing 500 kB chunk-size advisory.
- **Commit:** `a1466ae` — `feat: add database automations`, pushed to `origin/main`.
- **Remaining work:** Phase 9 remains NEEDS REVIEW. Automation limitations are listed in L-05 and L-38 and in the Phase 12 section above.
- **Notes / decisions:** Deletion events are observable as failures because deleted records cannot receive row-local actions. Ordered actions are individually atomic and validated but not a multi-action transaction. A `running` claim is intentionally not retried after a crash. The browser smoke exercises create, edit, disable/enable, execution history, and confirmed delete. The vault-onboarding smoke’s macOS preference path was corrected so its requested verification could run on this host. Unrelated uncommitted typography/editor changes and untracked files were preserved.

### 2026-11-02 — Phase 13 — Templates and Database Templates

- **Status:** COMPLETE WITH LIMITATIONS
- **Summary:** Added a versioned local template catalog; note/database template creation, editing, preview, and safe apply; note-variable validation; database schema/view/starter-row capture; and export/import/backup/restore support. Backup manifest is now v7 and older versions remain supported.
- **Files changed:** `src/database/templates.ts`; storage contracts, filesystem, portable import/export, and backup; local API; `ui/src/TemplatesView.tsx`, sidebar/app/client/types; browser smoke; template and backup compatibility tests; `docs/templates.md`; roadmap.
- **Tests executed:** Focused template and automation tests (4 files / 14 tests); `pnpm test --maxWorkers=1` (91 files / 1,067 tests); `pnpm typecheck`; `pnpm build`; `pnpm test:database-views`; `pnpm test:browser`; `pnpm test:vault-onboarding`; `pnpm bench:databases`; `git diff --check` — passed. Build emits the App chunk advisory above 500 kB.
- **Commit:** `18539bb` — `feat: add note and database templates` (implementation); roadmap follow-up records final verification and synchronization.
- **Remaining work:** Database template application uses the existing per-file atomic import path, not a multi-file transaction; hidden template files are not yet covered by `checkHealth`.
- **Notes / decisions:** Reused `applyImport`, existing note path allocation, schema/view/property validation, vault-root locking, and shadcn primitives. Templates contain data only and execute no user code. Template catalogs are optional; invalid catalogs fail reads/portability without rewriting source bytes. Backup v7 is backward compatible with v1–v6. Browser smoke had one transient database-view fixture 404, then passed on rerun; this is reported rather than hidden. The implementation and roadmap commits are pushed to `origin/main`.

### 2026-11-02 — Phase 15P — Productivity and Command Experience

- **Status:** COMPLETE WITH LIMITATIONS
- **Summary:** Added categorized/keyword-searchable command palette commands with shortcut labels and inline execution errors; centralized the application shortcut registry with conflict and editor-collision audits; added recent-note persistence and quick switching; added database and folder destinations; added the shortcut reference dialog; and documented focus/accessibility behavior.
- **Files changed:** `ui/src/commands.ts`, `ui/src/shortcuts.ts`, `ui/src/recentNavigation.ts`, `ui/src/CommandPalette.tsx`, `ui/src/RecentNotesDialog.tsx`, `ui/src/ShortcutReferenceDialog.tsx`, `ui/src/App.tsx`, `ui/src/Sidebar.tsx`, `ui/src/format.ts`, `test/ui-command-palette.test.ts`, `scripts/browser-smoke.mjs`, `docs/shortcuts.md`, `docs/global-search.md`, `docs/editor.md`, `README.md`, and this roadmap.
- **Tests executed:** `pnpm test --maxWorkers=1` — 92 files / 1,089 tests passed; focused command/editor shortcut tests — 102 passed; `pnpm typecheck`; `pnpm build`; `pnpm test:browser`; `git diff --check` — passed. Build retains the existing App chunk advisory above 500 kB.
- **Commit:** `feat: improve productivity and command experience` (this delivery; use `git log -1` for the hash). Pushed to `origin/feat/phase-15-productivity`.
- **Remaining work:** Recent history is local per browser/vault; folder commands use note search rather than tree selection state; command items are not virtualized.
- **Notes / decisions:** This delivery is recorded as 15P because the roadmap reserves Phase 15 for Database Protection and Safeguards. Existing Meta/Ctrl tolerance was preserved for compatibility while display labels remain platform-specific. No new dependency or persistence system was introduced; recent notes reuse the existing localStorage preference pattern.

### 2026-11-02 — Phase 14 — Template Reliability and Vault Health Integration

- **Status:** COMPLETE WITH LIMITATIONS
- **Summary:** Added read-only health diagnostics for the optional template catalog and interrupted application journals; fixed strict parsing of captured internal saved views; staged database-template writes after complete validation; promoted files exclusively with the database definition last; added inode-and-content-checked rollback and safe retry recovery. Backup/export snapshots stop while an uncommitted or invalid transaction journal prevents a consistent snapshot. Documented the cooperative-lock and non-filesystem-transaction guarantees.
- **Files changed:** `src/database/templates.ts`, domain/storage errors and contracts, `src/storage/fs/atomic.ts`, `src/storage/fs/layout.ts`, `src/storage/fs/vault.ts`, `src/ui-server/api.ts`, `ui/src/SettingsView.tsx`, `ui/src/TemplatesView.tsx`, template/health/API/UI tests, `docs/templates.md`, and `docs/ROADMAP.md`.
- **Tests executed:** Focused template/health/rollback/UI suite: 4 files / 22 tests passed; focused loopback template/health API tests: 2 files / 4 tests passed. Final `pnpm test --maxWorkers=2`: 94 files / 1,087 tests passed. `pnpm typecheck`, `pnpm build`, `pnpm test:database-views`, `pnpm test:browser`, `pnpm test:vault-onboarding`, `pnpm bench:databases`, and `git diff --check` passed. A malformed full-suite invocation (`pnpm test -- --maxWorkers=1`) spawned 94 workers and had 12 five-second timeout failures; the corrected two-worker invocation passed. Build emits the App chunk advisory at 517.94 kB.
- **Commit:** `feat: improve template reliability and vault health` (this change set).
- **Remaining work:** None within Phase 14. Generic import and restore remain without multi-file transactionality; see L-02.
- **Notes / decisions:** Staging is recoverable and protects unrelated or unverified files; it is not a filesystem-wide transaction. The cooperating Nodus root lock does not serialize external writers, and external readers may observe the publication sequence. Rollback verifies both inode identity and staged content hash, preserving an in-place edit and its journal for inspection. Missing optional template storage remains healthy. User typography/editor/landing-page and local-file changes were preserved outside the Phase 14 scope.


### 2026-11-02 — Phase 17G — Knowledge Graph and Relationship Exploration

- **Status:** COMPLETE WITH LIMITATIONS
- **Summary:** Extended the existing wiki-link graph with path resolution, outgoing links, unresolved-target virtual nodes, two-way isolated-note discovery, folder/search/isolation/unresolved filters, neighbor edge highlighting, and cached graph projection. Reused the existing Markdown scanner, resolver, snapshot cache, SVG graph, backlinks panel, Discovery view, and shadcn primitives; no new dependency or storage format.
- **Files changed:** `src/links/wikilink.ts`, `src/links/link-index.ts`, `src/links/backlinks.ts`, `src/links/graph.ts`, `src/ui-server/dto.ts`, `src/ui-server/api.ts`, `ui/src/graph-model.ts`, `ui/src/GraphView.tsx`, `ui/src/BacklinksPanel.tsx`, `ui/src/DiscoveryView.tsx`, `docs/knowledge-graph.md`, `docs/wiki-links.md`, `README.md`, `package.json`, `vitest.graph-benchmark.config.ts`, `benchmark/graph.benchmark.ts`, graph/backlink/discovery tests, `scripts/graph-smoke.mjs`, `scripts/discovery-smoke.mjs`, and this roadmap.
- **Tests executed:** Focused relationship/link/graph suite: 10 files / 87 tests; combined full serial suite: 98 files / 1,137 tests; `pnpm typecheck`; `pnpm build`; `pnpm test:browser`; `pnpm test:vault-onboarding`; `pnpm test:database-views`; graph and discovery browser smokes; `pnpm bench:graph`; `git diff --check` — all passed.
- **Performance:** 1,000 notes / 3,000 occurrences: 16.27 ms total; 5,000 / 15,000: 78.45 ms total (local Node 24.18.1 median). No thresholds are enforced.
- **Commit:** `df89954` — `feat: add knowledge graph exploration`; pushed to `origin/feat/phase-17-knowledge-graph`.
- **Remaining work:** Radial layout and 200-node display bound remain; no persisted positions, heading/block targets, automatic link rewriting, or persistent relationship index.
- **Integration:** PR #5 merged to `main` as squash commit `a9dc1a4` under the active linear-history ruleset. The original implementation commit remains on the retained feature branch, not in `main` ancestry.
- **Notes / decisions:** This delivery is recorded as 17G because the roadmap reserves Phase 17 for Tasks and Project Management. Path resolution is a fallback after title/alias/ID; external URL schemes are ignored. `orphans` remains for API compatibility while the UI uses the stricter two-way `isolated` definition. Graph projection is cached with the shared knowledge snapshot; UI filters never refetch.

### 2026-11-02 — Phase 16 — Markdown Editor Enhancements

- **Status:** COMPLETE WITH LIMITATIONS
- **Summary:** Added a shared Lezer-backed outline for editor and preview, unique heading anchors and nested navigation, active-heading tracking, a debounced incremental-tree outline refresh, an empty-body placeholder, rectangular TSV-to-Markdown-table paste, and table-cell Tab navigation/row creation. Existing CodeMirror, Markdown parser, autosave, conflict handling, preview renderer, and shadcn components are reused.
- **Files changed:** `ui/src/editor/documentOutline.ts`, `ui/src/editor/markdownClipboard.ts`, `ui/src/editor/CodeMirrorEditor.tsx`, `ui/src/editor/markdownCommands.ts`, `ui/src/editor/MarkdownPreview.tsx`, `ui/src/Editor.tsx`, focused tests, `scripts/editor-markdown-smoke.mjs`, `docs/editor.md`, and `docs/ROADMAP.md`.
- **Tests executed:** Focused editor/productivity suite: 6 files / 168 tests passed. Full combined serial suite after Phase 17: 98 files / 1,137 tests passed. Typecheck, build, browser, database-view, vault-onboarding, editor Markdown/shortcut smokes, graph/discovery smokes, graph benchmark, and `git diff --check` passed.
- **Performance:** A 378,891-character / 5,000-heading synthetic document had 61.33 ms median and 76.32 ms p95 outline extraction from a complete cached syntax tree. The prior 342,785-character / 5,000-heading fresh parse plus simpler scan was 106.70 ms median and 158.10 ms p95; source size and parser-cache conditions differ, so this is observational rather than a controlled comparison. The outline walk remains a full tree walk after a 120 ms debounce; parse completion uses 25 ms slices.
- **Commit:** `4f1ed22` — `feat: enhance markdown editing experience` (implementation; roadmap follow-up records final status).
- **Integration:** PR #4 merged to `main` as squash commit `d2e7287`; GitHub linear-history rules rejected a merge commit and could not rebase the branch containing the required main merge, so squash was the allowed method. The original implementation commit remains on its retained feature branch.
- **Notes / decisions:** The default parallel test runs exceeded fixed 5-second timeouts on unrelated storage/API tests (19 failures in the standard run, 13 with two workers); the serial full-suite run passed without changing timeouts. Initial sandbox-only browser/benchmark attempts could not bind loopback; escalated retries passed. Production build emits the advisory at 796.92 kB after all three changes; Phase 16 standalone build emitted 778.45 kB. No dependencies were added. Unrelated Phase 15/main-worktree changes remain untouched.

### 2026-11-02 — Phase 18L — Link Integrity and Repair

- **Status:** COMPLETE WITH LIMITATIONS
- **Summary:** Added deterministic local repair suggestions for unresolved links, candidate selection for ambiguous links, a revision-checked single-occurrence link rewrite API, Discovery controls with keyboard labels and status/error handling, and rename-safe title links via automatic previous-title aliases. No new dependency, persistent index, or storage format; Markdown remains authoritative.
- **Files changed:** `src/links/link-repair.ts`, `src/links/link-edit.ts`, `src/links/wikilink.ts`, `src/ui-server/api.ts`, `src/ui-server/dto.ts`, `ui/src/DiscoveryView.tsx`, `ui/src/api.ts`, `ui/src/App.tsx`, `test/link-repair.test.ts`, `test/link-repair-api.test.ts`, `test/ui-backlinks.test.ts`, `test/ui-search.test.ts`, `benchmark/graph.benchmark.ts`, `scripts/discovery-smoke.mjs`, `docs/wiki-links.md`, `docs/knowledge-graph.md`, `README.md`, and this roadmap.
- **Tests executed:** Focused relationship/repair suite: 5 files / 33 tests passed. Full serial suite: `pnpm test --maxWorkers=1` — 100 files / 1,155 tests passed. `pnpm typecheck`; `pnpm build` (App chunk 799.91 kB); `pnpm test:browser`; `pnpm test:database-views`; `pnpm test:vault-onboarding`; discovery and graph browser smokes; `pnpm bench:graph`; `git diff --check` — all passed.
- **Performance:** 5,000 notes / 15,000 links graph projection: 81.33 ms median. Repair suggestions: 500 unique targets at 5,000 notes: 975.98 ms total (1.952 ms per target); 250 unique targets at 1,000 notes: 80.81 ms total. Local Node 24.18.1; no enforced thresholds.
- **Commit:** `3952db3` — `feat: add link integrity and repair`.
- **Delivery:** A direct push to `origin/main` was rejected by the repository rule requiring a pull request. The commit was pushed to `origin/feat/phase-18-link-integrity` as the only available remote path. No pull request was opened.
- **Remaining work:** Suggestions are lexical only; path links still break on move; repair is one occurrence per request; alias preservation depends on a successful whole-vault scan. See L-41–L-44.
- **Notes / decisions:** The previous title is retained as an alias only when confirmed incoming title links exist, avoiding metadata churn for ordinary title edits. Repairs use the stable UUID by default and add a readable display when the original link had none. The discovery API caches ranked suggestions per missing target and applies the source exclusion afterward. The whole-vault scan for rename preservation is best-effort; a malformed unrelated note cannot block the save.

---

## 11. Roadmap Maintenance Rules

1. **One roadmap.** Update `docs/ROADMAP.md`; do not create additional competing roadmap files. Historical plans and reports may remain as evidence but must link back here.
2. **Update, don’t duplicate.** If a milestone already has a section, amend it. Do not add a second entry for the same phase.
3. **Keep evidence honest.** Link implementation paths and tests. Do not mark a milestone complete without a verified run.
4. **Distinguish proposal from delivery.** Future phases stay in the proposed section until implementation and verification are complete.
5. **Record working-tree-only work.** If code exists only locally, say so and give no commit hash.
6. **Update the feature inventory.** Any new capability, format, or storage location must be added there.
7. **Update the risk register.** New limitations must be recorded rather than hidden.
8. **Append the session log.** Include date, phase/task, summary, files, tests, commit, and remaining work.
9. **Resolve contradictions.** If documentation and code disagree, follow code and correct the docs.
10. **Do not silently change formats.** Any format change requires a version, compatibility plan, tests, and a roadmap update.

---

**End of roadmap.**
