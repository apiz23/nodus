# Unified knowledge graph — future architecture and feasibility

**Status:** Future planning and architecture assessment. This document is not an implementation claim, a format specification, a roadmap phase, or authorization to start work.

**Scope:** Assess whether Nodus can expose one coherent knowledge graph over notes, tasks, projects, database records, bookmarks, attachments, calendar events, documents, and canvas objects. The audit below is based on the repository at the time of writing. Source paths and symbols are evidence of current behavior; they do not imply that a future capability exists.

**Authority:** The [master roadmap](../ROADMAP.md) remains the only authoritative project roadmap, and the [product vision](../product-vision.md) remains the authoritative long-term product direction. This document does not add, renumber, complete, or reorder roadmap phases.

**Documentation-only boundary:** This assessment changes no source code, schema, migration, dependency, runtime behavior, backup format, roadmap status, or Git history.

---

## 1. Executive assessment

A unified knowledge graph is **feasible as a read-only composition layer** for the object types that already exist as source-derived data:

- notes;
- database definitions and database records;
- typed database relations;
- Markdown tasks;
- calendar events projected from database records and tasks;
- managed attachments and their Markdown references.

Those objects already share important foundations: local-first files, note UUIDs, deterministic projections, a shared root-locked note snapshot, and a rebuildable in-memory index model.

A unified graph is **not currently possible for every requested object type** because several do not exist as first-class objects:

- **Projects:** no project entity, project store, or project identity. The roadmap still lists Tasks and Project Management as **PLANNED** (`docs/ROADMAP.md:1577`). Projects can be approximated with folders or database rows today, but that is a user composition, not a domain object.
- **Bookmarks:** no bookmark domain type, storage format, index, or UI. A repository-wide search found only editor-local cursor bookmarks in `ui/src/editor/CodeMirrorEditor.tsx`, which are unrelated.
- **Canvas objects:** no persisted canvas document, node, edge, group, or annotation format. The existing “graph canvas” is interactive rendering of the note graph (`ui/src/GraphView.tsx`, `ui/src/graph-viewport.ts`), not a general canvas object model. A whiteboard proposal exists as a **superseded historical proposal** (`docs/ROADMAP.md:1828`).
- **Documents as a distinct object:** notes already serve as documents. There is no separate document entity, document import pipeline, or document-specific identity.
- **Cross-workspace graph:** one vault is active at a time. There is no multi-vault registry, cross-vault identity, or combined index.

The recommended direction is therefore:

1. **Do not create a new authoritative graph database first.** Compose a read-only entity/edge projection from existing sources.
2. **Define a stable identity and provenance contract before adding object kinds.**
3. **Treat missing object types as separate product decisions and separate versioned formats**, not as inferred graph nodes.
4. **Keep the graph vault-scoped by default**, with explicit privacy and cache isolation.
5. **Prove performance and invalidation behavior before introducing a persistent index.**

---

## 2. Product vision

### 2.1 Desired outcome

A user should be able to ask relationship questions across their workspace without knowing which feature owns the data:

- Which tasks belong to this project or record?
- Which attachment is used by which notes?
- Which database records are related to this note, and through which property?
- Which calendar events originate from this task or record?
- Which notes, tasks, and records are connected to this topic?
- What is the shortest explainable path between two objects?
- Which objects are isolated, unresolved, or orphaned?

The graph should be **explainable**: every edge should say whether it is declared, structural, or inferred, and which source produced it.

### 2.2 Product principles

- **Local-first:** the graph is computed on the local device and does not require an account, cloud service, or remote API.
- **Markdown and user files remain authoritative:** the graph is a projection, not a second source of truth.
- **Stable identity:** renames and moves must not break relationships.
- **Provenance over guessing:** explicit links and typed relations are distinct from lexical or similarity-based recommendations.
- **Vault-scoped by default:** no implicit sharing of graph data across workspaces.
- **Progressive disclosure:** a unified graph should be reachable from existing graph, backlinks, discovery, and record-detail surfaces rather than becoming an isolated destination.
- **No silent mutation:** graph exploration never rewrites notes, relation values, tasks, attachments, or event data.
- **Bounded work:** node counts, edge counts, traversal depth, query time, and render counts must have explicit limits.

### 2.3 Non-goals for the first unified graph

- A general graph database or a new authoritative query language.
- Semantic embeddings or AI-generated relationships as confirmed edges.
- Real-time multi-user collaboration.
- Cross-device synchronization.
- Automatic indexing of operating-system bookmarks, calendars, or files outside the active vault.
- Automatic creation of projects, bookmarks, canvases, or documents from inferred graph structure.

---

## 3. Method and status vocabulary

Capabilities below use the requested classifications:

| Status | Meaning in this audit |
|---|---|
| **IMPLEMENTED** | Present in source and exercised by existing code paths or tests. Limitations may still exist. |
| **PARTIALLY IMPLEMENTED** | A meaningful subset exists, but the full capability described is not delivered. |
| **PLANNED** | Explicitly proposed in the roadmap or product direction, with no implementation claim. |
| **EXPERIMENTAL** | Code or contract exists but is not a supported product capability. |
| **NOT FOUND** | No implementation or domain object was located. Absence is evidence only for the searched repository state. |
| **NEEDS FURTHER INVESTIGATION** | The implementation may exist under a different concept, or the product semantics are unresolved. |

Evidence uses repository-relative paths and symbols. Line numbers describe the audited revision and may drift.

---

## 4. Existing capability audit

### 4.1 Object models

| Capability | Status | Evidence | Consequence for a unified graph |
|---|---|---|---|
| Notes | **IMPLEMENTED** | `src/domain/note.ts:8` `Note`; `:40` `validateNote`; `src/domain/ids.ts` UUID v4 validation; `docs/note-format.md:94` stable IDs and paths | Notes are the strongest graph entity: stable UUID, title, path, body, aliases, tags, timestamps, and preserved extra frontmatter. |
| Database definitions | **IMPLEMENTED** | `src/database/schema.ts:8` `DATABASE_FORMAT_VERSION = 3`; `:32` `DatabaseDefinition`; `:10` property types | Database schemas have their own UUIDs and versioned JSON files, but they are configuration nodes, not note-like knowledge nodes. |
| Database records / rows | **IMPLEMENTED** | `src/database/note-properties.ts:92` `projectNoteProperties`; `src/database/relations.ts:85` `projectRelations`; `docs/database-relations.md` identity section | A record is a note with `nodus_data` membership. It has **no separate record ID**; the note UUID is the identity. This is a major simplification for a unified graph. |
| Database relations | **IMPLEMENTED** | `src/database/relation-contract.ts:9` `RelationPropertyConfiguration`; `:16` `RelationValue`; `src/database/relations.ts:85` `projectRelations`; `:274` `projectIncomingRelations` | Typed, directed note-to-note edges exist, but they are projected separately from the wiki-link graph and are scoped by database/property configuration. |
| Rollups and formulas | **IMPLEMENTED** | `src/database/schema.ts:29` `isDerivedProperty`; `src/database/relations.ts`; `src/database/formula-engine.ts` | These are computed values, not stored edges. They should not become graph nodes or relation edges by default. |
| Tags | **IMPLEMENTED** | `src/domain/note.ts:8` `tags`; `src/domain/tags.ts`; `docs/task-management.md` | Tags are note metadata and can support derived grouping or filtering; they are not currently first-class tag entities. |
| General properties | **IMPLEMENTED** | `src/properties/catalog.ts`; `docs/property-format.md` | A property catalog exists, but general property values are not a cross-object relationship model. |
| Tasks | **IMPLEMENTED** | `src/tasks/extract.ts:10` `ExtractedTask`; `:65` `extractTasksFromBody`; `:145` `buildTaskProjection`; `docs/task-management.md` | Tasks are derived from Markdown checklist items. Their IDs are **projection-local** and change when line/text changes. They can be ephemeral graph nodes but not durable link targets without a format decision. |
| Calendar events | **IMPLEMENTED** | `src/calendar/events.ts:22` `CalendarEventSource`; `:26` `CalendarEvent`; `:58` `projectCalendarEvents`; `docs/temporal-contract.md:25` | Events are pure projections of database rows and Markdown tasks. Event IDs are derived from source configuration. No event table or sidecar exists. |
| Attachments | **PARTIALLY IMPLEMENTED** | `src/storage/fs/attachments.ts:6` `ATTACHMENT_MAX_BYTES`; `:11` `AttachmentInfo`; `src/storage/contracts.ts:41` `VaultAttachment`; `src/storage/fs/attachments.ts:39` `createAttachmentPath`; `src/storage/fs/vault.ts:352` `listAttachmentsUnlocked` | Managed binary files exist with UUID-prefixed paths, but there is no attachment entity document, persisted reference index, attachment-specific backlink surface, or attachment description metadata. References are recomputed by scanning note bodies for `GET /api/attachments`. |
| Projects | **NOT FOUND** (first-class) | No `Project` domain type or store in `src/`; roadmap lists Tasks and Project Management as **PLANNED** at `docs/ROADMAP.md:1577` | Projects cannot be unified as objects yet without a product model. Folders/database rows are generic substitutes, not project identity. |
| Project definition and scope | **NEEDS FURTHER INVESTIGATION** | Product direction names project organization at `docs/product-vision.md:30`; roadmap proposes tasks/projects on databases at `docs/ROADMAP.md:1577`; no source model exists | Decide whether a project is a folder convention, a note-backed object, a database record, or a new persistent type before graph inclusion. |
| Project organization via generic primitives | **PARTIALLY IMPLEMENTED** | Folders: `src/storage/fs/folders.ts`; database rows and views: `src/database/`; product direction: `docs/product-vision.md:30` | A user can model project-like work with folders and databases, but there is no project lifecycle, membership, or project node. |
| Bookmarks | **NOT FOUND** | No bookmark domain/storage/UI symbol; repository search found only editor cursor bookmarks in `ui/src/editor/CodeMirrorEditor.tsx` | No bookmark object can be included without a new product decision and format. External browser bookmarks must not be indexed implicitly. |
| Documents as notes | **IMPLEMENTED** | `src/domain/note.ts:8`; `src/format/note-format.ts`; editor `ui/src/Editor.tsx` | Long-form documents are notes. A unified graph can treat notes as documents today. |
| Documents as a distinct imported object | **NOT FOUND** | No document-import pipeline or document entity beyond notes; product direction mentions “Notes and documents” generically at `docs/product-vision.md:30` | DOCX/PDF-style documents are not first-class knowledge objects. Attachments can store PDF bytes, but no extracted document model exists. |
| Canvas objects | **NOT FOUND** | Graph canvas only: `ui/src/GraphView.tsx:39`; `ui/src/graph-viewport.ts`; historical whiteboard proposal `docs/ROADMAP.md:1828` | No persisted canvas node, edge, group, annotation, or board file format. A unified graph cannot include canvas objects without a separate format and feature. |
| Saved database views | **IMPLEMENTED** | `src/database/database-view.ts`; `src/database/database-view-order.ts`; `docs/database-views.md` | Views are configuration resources, not graph content. Do not turn every view into a node. |
| Saved graph views | **PARTIALLY IMPLEMENTED** | `ui/src/graph-saved-views.ts:3` storage version; `:69` `graphViewsStorageKey`; `docs/knowledge-graph.md` saved views | Browser-local, vault-scoped UI preferences. Portable JSON export exists, but it is not vault backup or a graph data format. |
| Workspace / vault | **IMPLEMENTED** (single active vault) | `src/ui-server/api.ts:145` `activeVaultPath`; `:318` `activateVault`; `:354` active path assignment; `:357` index clearing; `docs/storage.md:229` | A workspace is one active vault. There is no multi-vault graph or workspace entity beyond the vault root. |
| Workspace customization | **IMPLEMENTED** (browser-local) | `ui/src/workspacePreferences.ts:139` load; `:195` save; `docs/workspace-customization.md:25` | Layout preferences are browser-profile-scoped and are not knowledge graph data. |

#### Object-model conclusion

The current canonical object is the **note**. Database records are notes. Tasks and calendar events are derived projections over notes and schemas. Attachments are file resources with only a partial entity shape. Projects, bookmarks, distinct documents, and canvas objects have no current domain model.

A unified graph should therefore distinguish:

- **persistent entities** with durable identity: notes/records, database definitions, saved views, attachments (subject to an identity decision), and future versioned object formats;
- **derived entities** with source-scoped identity: tasks and calendar events;
- **configuration entities**: database schemas, views, catalogs, templates, automations;
- **unresolved targets**: literal wiki-link text or dangling relation IDs.

### 4.2 Relationships and graph functionality

| Capability | Status | Evidence | Consequence |
|---|---|---|---|
| Wiki-link parsing and resolution | **IMPLEMENTED** | `src/links/wikilink.ts:28` `parseWikiLinks`; `:55` `createLinkResolver`; `:106` `isExternalTarget`; `docs/knowledge-graph.md` resolution order | Directed note-to-note edges with stable-ID, title/alias, and path fallback. External schemes are excluded. |
| Link index | **IMPLEMENTED** | `src/links/link-index.ts:14` `LinkIndex`; `:24` `buildLinkIndex` | Whole-vault derived snapshot; unresolved, ambiguous, orphan, and isolated sets. |
| Backlinks and outgoing links | **IMPLEMENTED** | `src/links/backlinks.ts`; `ui/src/BacklinksPanel.tsx`; `docs/knowledge-graph.md` | Note-scoped relationship display exists. |
| Graph projection | **IMPLEMENTED** | `src/links/graph.ts:3` `GraphNode`; `:9` `GraphEdge`; `:25` `NoteGraph`; `:36` `graphFromLinkIndex` | Nodes are notes only; edges aggregate repeated wiki links. |
| Unresolved / ambiguous discovery | **IMPLEMENTED** | `src/links/graph.ts:25` `NoteGraph`; `src/ui-server/api.ts:559` `/api/discovery`; `docs/knowledge-graph.md` | Unresolved targets are preserved and repairable; ambiguous links are excluded from confirmed edges. |
| Link repair | **IMPLEMENTED** | `src/links/link-repair.ts`; `src/ui-server/api.ts` repair route; `docs/knowledge-graph.md` link repair | Single-occurrence, explicit, hash-checked repair. No bulk rewrite. |
| Graph analytics and clusters | **IMPLEMENTED** | `src/links/graph-analytics.ts:23` `GraphAnalytics`; `:52` `analyzeGraph`; `docs/knowledge-graph.md` | Connectivity metrics only; clusters are weakly connected components, not semantic topics. |
| Related-note recommendations | **IMPLEMENTED** | `src/links/related-notes.ts:37` `relatedNotes`; `src/search/retrieval.ts` text recommendations; `docs/knowledge-retrieval.md` | Lexical/link-based recommendations, not confirmed edges. Provenance labels matter. |
| Shortest paths | **IMPLEMENTED** | `src/links/graph-paths.ts:33` `shortestGraphPath`; `src/ui-server/api.ts:605` `/api/graph/path` | Bounded BFS over confirmed note edges. Does not include database relation or task edges. |
| Cluster insight | **IMPLEMENTED** | `src/links/graph-cluster-insights.ts:23` `graphClusterInsights`; `src/ui-server/api.ts:592` `/api/graph/clusters` | Measurement over the note graph only. |
| Interactive graph UI | **IMPLEMENTED** | `ui/src/GraphView.tsx:39` `GraphView`; `ui/src/graph-model.ts:64` `visibleGraph`; `:165` `positionGraph`; `ui/src/graph-viewport.ts` | Rich note-graph exploration with render limits and deterministic layout. |
| Database relation backlinks | **PARTIALLY IMPLEMENTED** | `src/database/relations.ts:274` `projectIncomingRelations`; `src/ui-server/api.ts` relation-backlinks route; `docs/database-relations.md` | Typed relations are queryable per note, but they are a separate projection and API from the wiki-link graph. |
| Unified typed relation projection across all databases | **PARTIALLY IMPLEMENTED** | `src/database/relations.ts:85` `projectRelations` | Whole-vault relation projection exists, but it is not exposed as a general graph and does not merge with wiki links. |
| Attachment reference edges | **PARTIALLY IMPLEMENTED** | `src/storage/fs/attachments.ts` `markdownReferencesAttachment`; `src/storage/fs/vault.ts:352` | References are derived per attachment by scanning notes. No general backlink index or graph edge type. |
| Task ownership / source links | **PARTIALLY IMPLEMENTED** | `src/tasks/extract.ts:10` `ExtractedTask.noteId`; `:145` `buildTaskProjection`; `docs/task-management.md` | A task belongs to a note and carries navigation metadata, but there is no graph projection or durable task node. |
| Calendar event source links | **PARTIALLY IMPLEMENTED** | `src/calendar/events.ts:22` `CalendarEventSource`; `:26` `CalendarEvent.navigation` | Events navigate to their source note, but no event-edge graph or persisted event identity exists. |
| Unified graph across notes, records, tasks, events, attachments | **NOT FOUND** | No unified entity/edge contract; separate `src/links/`, `src/database/relations.ts`, `src/tasks/`, `src/calendar/` | This is the target capability, not current behavior. |
| Cross-workspace / multi-vault graph | **NOT FOUND** | Single `activeVaultPath`; caches cleared on switch at `src/ui-server/api.ts:357`; `docs/storage.md:229` | Would require a workspace registry, cross-vault identity policy, and privacy review. |
| Persistent graph database | **NOT FOUND** | `docs/knowledge-graph.md:246` explicitly says no persistent relationship index; `src/indexing/snapshot-cache.ts` is in-memory | No graph database, index file, or durable relationship store exists. |
| Plugin-provided graph object types | **EXPERIMENTAL** | `src/plugins/index.ts`; `src/plugins/types.ts`; `docs/plugin-architecture.md:3` states metadata-only P1 and no runtime | Extension points cannot be assumed until plugin execution and permissions exist. |

#### Relationship conclusion

Nodus already has **two mature but separate relationship systems**:

1. wiki-link relationships between notes;
2. typed database relations between note-backed records.

It also has **implicit structural relationships**:

- task → owning note;
- calendar event → source note / database record;
- attachment → referencing notes;
- database record → database membership;
- note → project-like folder (path, not identity).

A unified graph is primarily a **normalization and composition problem**, not a new relationship-discovery problem. The main missing piece is a shared edge contract with provenance, not more link parsing.

### 4.3 Storage, indexing, search, and isolation

| Capability | Status | Evidence | Consequence |
|---|---|---|---|
| Local-first filesystem vault | **IMPLEMENTED** | `src/storage/contracts.ts:455` `VaultStorage`; `src/storage/fs/vault.ts`; `docs/storage.md` | Files remain authoritative. No network or database engine is required. |
| Stable note identity | **IMPLEMENTED** | `src/domain/note.ts:8`; `docs/note-format.md:94`; roadmap ADR-003 `docs/ROADMAP.md:2378` | Notes and records can be durable graph entities. Plain Markdown without frontmatter has a path-derived synthetic ID until a managed move writes metadata. |
| Stable database identity | **IMPLEMENTED** | `src/database/schema.ts:32`; `src/storage/fs/layout.ts` `databasePath` | Database definitions can be durable graph entities if schemas are included. |
| Stable attachment identity | **PARTIALLY IMPLEMENTED** | `src/storage/contracts.ts:41` `VaultAttachment.id`; `src/storage/fs/attachments.ts:39` `createAttachmentPath`; `:34` `attachmentPathId` | The UUID is encoded in the managed filename but is not stored in a sidecar. Identity survives ordinary reads but has no explicit rename/move contract. |
| Stable task identity | **NOT FOUND** for durable identity | `src/tasks/extract.ts:10` comment “Projection-local identity”; task ID uses note ID, line, and text at `:97` | Task IDs change with edits/reordering. Do not store links to them or treat them as permanent graph identities. |
| Stable calendar-event identity | **PARTIALLY IMPLEMENTED** (derived only) | `src/calendar/events.ts:26` comment “Stable projection identity”; `:130` `databaseEventId` includes database, record, start and optional end property | Stable only under the same source configuration. It is not a durable user-created event identity. |
| Derived snapshot cache | **IMPLEMENTED** | `src/indexing/snapshot-cache.ts` `createSnapshotCache`; `src/ui-server/api.ts:188` per-vault cache map; `docs/knowledge-graph.md:235` | One in-memory snapshot per vault with five-second TTL, coalesced rebuilds, and mutation invalidation. |
| Full snapshot rescan on invalidation | **IMPLEMENTED** (current behavior) | `src/storage/fs/vault.ts:384` `snapshotNotesWithHashes`; `:388` `walkVault`; comments at `:399-407` | Rebuild walks and hashes notes; parsed notes are reused only when the hash matches. This is parse reuse, not a persistent or fully incremental index. |
| Incremental search projection reuse | **PARTIALLY IMPLEMENTED** | `src/search/retrieval.ts:70` fingerprint; `:71-73` previous document reuse; `docs/knowledge-retrieval.md:44` | Per-document token projections are reused when fingerprints match. Corpus postings and norms are rebuilt. |
| Search | **IMPLEMENTED** | `src/search/search-index.ts` `buildSearchIndex`; `src/search/query.ts`; `src/ui-server/api.ts:965` `/api/search`; `docs/global-search.md` | In-memory derived search over title, aliases, path, content, tags, properties, and filters, with BM25-style ranking assistance. |
| Persistent search index | **NOT FOUND** | `docs/global-search.md:84`; roadmap risk L-12 `docs/ROADMAP.md:2621` | Restart rebuilds from Markdown. No durable search database. |
| Persistent relation/graph index | **NOT FOUND** | `docs/knowledge-graph.md:246`; `docs/database-relations.md` storage decision | No on-disk relation or graph index. |
| Workspace isolation | **IMPLEMENTED** (single active vault) | `src/ui-server/api.ts:145`, `:318-357`; `docs/storage.md:229` | Switching vault disposes the previous vault and clears knowledge/relation indexes. No combined workspace view. |
| Vault-scoped browser preferences | **IMPLEMENTED** | `ui/src/graph-saved-views.ts:69`; `ui/src/searchPersistence.ts:36`; `docs/workspace-customization.md:25` | Saved views, search history, and workspace layout are keyed per vault/profile. They are not vault resources or graph data. |
| Cooperative concurrency control | **IMPLEMENTED with documented limits** | `src/storage/fs/root-lock.ts`; `src/storage/fs/atomic.ts`; `docs/storage.md` conditional-write section | Root lock and `expectedHash` protect cooperating Nodus writers. External editors can still race. |
| Privacy / local boundary | **IMPLEMENTED** | `docs/storage.md` privacy and network boundary; `package.json` dependencies; no network calls in graph/task/calendar projections | No telemetry, accounts, AI calls, or third-party transfers. The localhost API is origin-checked and loopback-oriented. |
| Plugin extensibility | **EXPERIMENTAL** | `src/plugins/index.ts`; `src/plugins/types.ts`; `docs/plugin-architecture.md:3` | Discovery and manifest validation exist; no executable plugin runtime. |
| Performance budgets enforced in CI | **NOT FOUND** | Roadmap risk L-36 `docs/ROADMAP.md:2645`; `docs/knowledge-graph.md` performance section says observations are not thresholds | Benchmarks are local observations. A unified graph needs explicit budgets before claiming scalability. |
| Migration/version policy for a new graph format | **NOT FOUND** | No unified graph format exists; roadmap compatibility rules `docs/ROADMAP.md:2533` | Any durable graph format would require a version decision, tests, export/import, and backup policy. |

#### Storage conclusion

The existing storage model is a strong fit for a **derived** graph and a poor fit for an **authoritative** graph:

- Markdown and versioned JSON already contain the source facts.
- The graph can be discarded and rebuilt.
- Derived values are deliberately not persisted.
- The main missing infrastructure is dependency-aware invalidation and a shared normalized projection, not a new storage engine.

### 4.4 Documentation audit

| Area | Status | Evidence |
|---|---|---|
| Knowledge graph behavior documented | **IMPLEMENTED** | `docs/knowledge-graph.md` |
| Wiki-link semantics documented | **IMPLEMENTED** | `docs/wiki-links.md` |
| Search/index behavior documented | **IMPLEMENTED** | `docs/global-search.md`, `docs/knowledge-retrieval.md` |
| Relations/rollups documented | **IMPLEMENTED** | `docs/database-relations.md` |
| Tasks documented | **IMPLEMENTED** | `docs/task-management.md` |
| Calendar/temporal contract documented | **IMPLEMENTED** | `docs/temporal-contract.md` |
| Workspace isolation documented | **IMPLEMENTED** | `docs/storage.md`, `docs/workspace-customization.md` |
| Unified graph future direction documented | **NOT FOUND** before this document | No `docs/future/` directory or unified-graph document existed at audit time |
| Projects/bookmarks/canvas object docs | **NOT FOUND** | Only roadmap proposals or generic product language exist |

Documentation is generally strong for delivered features. The gap is a single architecture narrative connecting the separate relationship systems. This document fills that gap without changing their authoritative guides.

---

## 5. Architecture assessment

### 5.1 Data model

#### Current model

The current model is intentionally heterogeneous:

```text
Note (UUID, title, path, body, tags, aliases, extraFrontmatter)
  ├── nodus_data.databases[databaseId] -> row values
  │     ├── relation values -> note UUIDs
  │     └── rollup/formula values -> derived
  ├── Markdown wiki links -> note UUIDs/titles/paths
  ├── Markdown checklist items -> derived tasks
  └── Markdown attachment links -> attachment paths
DatabaseDefinition (UUID, name, properties)
DatabaseView (UUID, type, filters/sorts/settings)
VaultAttachment (UUID in path, name, content type, size, derived references)
CalendarEvent (derived ID, source, date range, navigation)
```

There is no common entity envelope, no common edge envelope, and no registry of entity kinds.

#### Feasibility by object

| Object | Current source | Unified entity feasibility | Identity recommendation |
|---|---|---|---|
| Note | Markdown + frontmatter | High | Reuse `Note.id` UUID v4. |
| Database record | Note + `nodus_data` membership | High | Reuse owning note ID; do **not** mint a second record ID. |
| Database definition | `databases/<uuid>.json` | High, if schemas are useful nodes | Reuse database UUID. |
| Database view | `database-views/<db>/<view>.json` | Low value as graph node | Treat as configuration, not knowledge. |
| Task | Markdown checklist | Medium as ephemeral node | Source-scoped derived ID; never a durable edge target unless a new stable-ID format is approved. |
| Calendar event | DB row/task projection | Medium as ephemeral node | Prefer connecting the source record/task to a date node or calendar view; do not persist event IDs. |
| Attachment | Managed binary file | Medium | Reuse extracted filename UUID only after defining a rename/move contract; otherwise identity is path-bound. |
| Project | None | Undefined | Requires a product decision and a new persistent model or a note-backed convention. |
| Bookmark | None | Undefined | Requires a product decision, storage format, and privacy rules. |
| Distinct document | None beyond notes | Undefined | Prefer note-backed documents first; imported document formats are separate features. |
| Canvas object | None | Undefined | Requires a versioned canvas format before graph inclusion. |

#### Recommended conceptual entity envelope

The following is **illustrative only**. It is not a committed TypeScript API or file format.

```ts
type EntityKind =
  | 'note'
  | 'database'
  | 'database-record'
  | 'task'
  | 'attachment'
  | 'calendar-event'
  | 'project'
  | 'bookmark'
  | 'document'
  | 'canvas';

interface EntityRef {
  kind: EntityKind;
  /** Workspace-scoped stable identity. Never a title or path. */
  id: string;
  /** Canonical vault identity; avoids cross-workspace collisions. */
  workspaceId: string;
}

interface GraphEntity {
  ref: EntityRef;
  title: string;
  /** Display-only location; never identity. */
  path?: string;
  /** Whether this entity is persisted or derived from another source. */
  persistence: 'persistent' | 'derived';
  /** Source that produced this entity. */
  source: SourceRef;
  /** Optional kind-specific summary. Avoid copying entire documents into the graph. */
  metadata?: Record<string, string | number | boolean | null>;
}
```

Key rules:

- `kind + id` is the identity tuple. A note and its database record share the same underlying ID but may be distinct graph projections; either collapse them or label the record projection explicitly to avoid duplicate nodes.
- Derived entities carry a `source` reference so they can be rebuilt and explained.
- `workspaceId` must be stable but should not expose an absolute path in portable output. Use a locally stored workspace identity or a hash, with the path kept outside portable graph exports.
- Entity summaries must not duplicate full note bodies or attachment bytes into an index.

### 5.2 Stable identity

Stable identity is the hardest prerequisite. The current system has three identity classes.

#### Class A — durable persisted identity

- Notes: `Note.id`, UUID v4 (`src/domain/note.ts:8`, `src/domain/ids.ts`).
- Database definitions: UUID (`src/database/schema.ts:32`).
- Saved views: UUID (`src/database/database-view.ts`).
- Attachments: UUID encoded in the managed path (`src/storage/fs/attachments.ts:39`).

These can be graph identities, subject to attachment move/rename policy.

#### Class B — derived identity

- Tasks: `sha256(noteId + line + text)` (`src/tasks/extract.ts:97`), explicitly projection-local.
- Calendar events: database + record + start/end property (`src/calendar/events.ts:130`), stable only while configuration is unchanged.

These are suitable for **ephemeral graph nodes** and view state, but not for:

- persisted links;
- cross-session bookmarks to a task;
- audit history;
- stable “relates to task” edges stored in Markdown.

If durable task identity becomes a requirement, it needs an explicit format decision: for example, an optional task ID token in Markdown, a sidecar, or a block-reference convention. That is a separate feature with migration, portability, and authoring costs.

#### Class C — path-based identity

- Plain Markdown without frontmatter gets a deterministic path-derived synthetic ID (`docs/note-format.md:82`).
- Attachment references are currently path-based in Markdown.
- Folder/project-like organization is path-based.

Path identity is acceptable for display and filesystem location but not for durable graph relationships across moves.

#### Recommended identity policy

1. **Never use title, path, or display label as a graph key.**
2. **Reuse source UUIDs** for notes, records, databases, and views.
3. **Use a namespaced tuple** such as `note:<uuid>` or `attachment:<uuid>` to prevent collisions across kinds.
4. **Mark derived nodes** with a source revision and treat them as disposable.
5. **Require a new versioned format** before any new object kind becomes persistently linkable.
6. **Keep `workspaceId` out of portable graph exports** unless the export is explicitly workspace-scoped.

### 5.3 Relationship schema

#### Current relationship semantics

| Relationship | Direction | Source | Current status | Persistence |
|---|---|---|---|---|
| Wiki link | source note → target note | Markdown body | Confirmed, unresolved, or ambiguous | Markdown |
| Database relation | source record → target record | `nodus_data` property | Resolved, missing, or incompatible | Note frontmatter |
| Reverse relation | derived target → source | Schema config | Read-only projection | None |
| Rollup | derived value | Relation config | Computed | None |
| Task ownership | task → note | Checklist location | Derived | None |
| Calendar placement | event → source record/task | Saved view config + dates | Derived | None |
| Attachment reference | note → attachment | Markdown destination | Derived by scan | Markdown path |
| Database membership | record → database | `nodus_data` membership | Derived from frontmatter | Note frontmatter |
| Folder containment | note → folder | Filesystem path | Derived | Filesystem |
| Recommendation | note ↔ note | Lexical/link evidence | Inferred | None |

#### Recommended edge envelope

Illustrative only:

```ts
type EdgeKind =
  | 'links-to'
  | 'relates-to'
  | 'member-of'
  | 'contains-task'
  | 'scheduled-as'
  | 'attached-to'
  | 'belongs-to-project'
  | 'bookmarks'
  | 'canvas-contains';

type EdgeProvenance = 'declared' | 'structural' | 'derived' | 'inferred';

interface GraphEdge {
  kind: EdgeKind;
  source: EntityRef;
  target: EntityRef | UnresolvedTarget;
  provenance: EdgeProvenance;
  /** Property ID for typed database relations; absent for structural edges. */
  propertyId?: string;
  /** Human-readable explanation for UI and debugging. */
  label?: string;
  /** Source revision or hash used to build this edge. */
  sourceRevision?: string;
  /** Occurrence count for aggregated links; default 1. */
  count?: number;
}
```

Rules:

- **Declared** edges come from explicit user-authored facts: wiki links, typed relation values.
- **Structural** edges come from containment or ownership: membership, task location, calendar placement, attachment reference.
- **Derived** edges come from computed projections: reverse relations, rollups, maybe cluster membership.
- **Inferred** edges come from recommendations or similarity and must never be presented as confirmed.
- The UI must visually distinguish provenance.
- The graph API must not silently collapse declared and inferred edges into one unlabeled edge.
- Unresolved and ambiguous targets need explicit statuses, not fake entity nodes with normal identities.

#### Recommended edge taxonomy for the first iteration

Start narrow:

1. `links-to` — wiki links (existing).
2. `relates-to` — database relations (existing).
3. `member-of` — record → database.
4. `contains-task` — note → derived task.
5. `scheduled-as` — task/record → derived calendar event or date.
6. `attached-to` — note → attachment.
7. `belongs-to-project` — only after a project model exists.

Avoid starting with:

- generic similarity edges;
- tag co-occurrence edges;
- embedding edges;
- automatically inferred “related” edges without provenance.

### 5.4 Local-first storage

#### Recommended default: no new authoritative store

The graph should be a **derived read model**:

```text
authoritative files
  -> root-locked snapshot
  -> source extractors
  -> normalized entities
  -> normalized edges
  -> query/projection layer
  -> UI/API consumers
```

This matches the existing architecture and avoids a second source of truth.

#### If a cache is added later

A persistent cache may be justified only after benchmarks show that full rebuilds are the bottleneck. If added:

- it must be **disposable** and rebuildable;
- it must be content-addressed or revision-addressed;
- it must never be included as authoritative knowledge in backup/export;
- it must be invalidated by a schema/index version;
- it must be scoped per vault;
- it must tolerate interrupted writes and corrupted cache files by falling back to a rebuild;
- it must not store more sensitive content than necessary (prefer hashes, IDs, and bounded summaries over full bodies);
- it must be excluded from portable export unless deliberately versioned as a new resource kind.

#### Where to store a cache

Options:

| Option | Advantages | Risks |
|---|---|---|
| Hidden vault directory, e.g. `.nodus-index/` | Same-device locality; easy vault association | Must be skipped by scanners, excluded from backup/export, protected from user edits, and versioned. |
| Per-user application data directory | Keeps vault clean; easier cache lifecycle | Vault identity must be stable; moving a vault may orphan the cache; user may expect portability. |
| In-memory only | Lowest risk; no format change | Rebuild cost on every process start and invalidation. |

**Recommendation:** stay in-memory for the first unified graph. Revisit a persistent cache only with measured evidence and a separate format decision.

### 5.5 Derived graph projections

#### Proposed composition pipeline

```text
FileSystemVault.snapshotNotesWithHashes()
  + database definitions + saved views
  + attachment inventory
        |
        v
Source extractors (pure, deterministic)
  - note/link extractor
  - database relation extractor
  - task extractor
  - calendar event extractor
  - attachment reference extractor
        |
        v
Normalized entity + edge collector
  - deduplicate by (kind,id)
  - attach provenance and source revision
  - preserve unresolved/ambiguous status
        |
        v
Graph projection
  - adjacency indexes
  - degree/cluster caches
  - bounded path search
        |
        v
Read API / UI
```

#### Reuse existing projections

- `buildLinkIndex` and `graphFromLinkIndex` for wiki links.
- `projectRelations` for typed database relations, membership, reverse relations, and diagnostics.
- `buildTaskProjection` for tasks.
- `projectCalendarEvents` for calendar events.
- `listAttachmentsUnlocked` / `markdownReferencesAttachment` for attachment references.
- `buildSearchIndex` and `buildRetrievalIndex` for search and text evidence.

Do not duplicate their semantics. The unified layer should adapt their outputs into a common envelope.

#### Avoid eager composition

A unified graph must not force every request to pay every projection cost. Use lazy domain projections:

- note graph always available;
- relation projection on demand or when a database/record surface is open;
- task projection on demand;
- calendar projection on demand for calendar views;
- attachment inventory on demand;
- unified endpoint composes only requested domains, with explicit caps.

### 5.6 Incremental indexing

#### Current behavior

- The shared snapshot cache (`src/indexing/snapshot-cache.ts`) rebuilds the whole `KnowledgeIndex` when invalidated.
- `snapshotNotesWithHashes` still walks the vault and hashes every note (`src/storage/fs/vault.ts:384-407`).
- Parsing is reused for unchanged hashes.
- Search retrieval reuses per-document token projections by fingerprint (`src/search/retrieval.ts:70-73`).
- There is no persistent inverted index or graph index.

The documentation is explicit that this is **projection reuse**, not a fully incremental index (`docs/knowledge-retrieval.md:44-47`), and that vault scans still occur after invalidation (`docs/knowledge-retrieval.md:134`).

#### What “incremental” must mean for a unified graph

A per-document cache is insufficient because relationships create reverse dependencies:

- A note title/alias change can change resolution for **every** wiki link that targets that title/alias.
- A note deletion changes unresolved status for all inbound links.
- A database schema change can change relation validity, reverse relations, rollups, and all record projections.
- A relation value change affects the source record, the target record’s incoming relations, and rollup results.
- A task edit can change task identity, parent relationships, and calendar placement.
- A calendar view configuration change can change event identity and grouping.
- An attachment rename or deletion changes attachment references.
- A folder move changes paths and any path-based link fallback.

Therefore the invalidation model must include:

1. **source invalidation** — the changed file;
2. **reverse-dependency invalidation** — consumers of that source;
3. **projection version invalidation** — when extractor semantics change;
4. **vault identity invalidation** — when switching vaults;
5. **explicit refresh** — user-requested rebuild.

#### Recommended staged approach

- **Stage A:** full in-memory rebuild of the unified projection, with per-domain lazy caches. Measure.
- **Stage B:** dependency-aware invalidation for the highest-cost domains (links, relations).
- **Stage C:** optional persistent cache with explicit rebuild-on-corruption and version checks.

Do not start with a persistent incremental index. It adds the most complexity and the least product value at current scale.

### 5.7 Performance

#### Existing measured behavior (local observations, not guarantees)

The repository documents local benchmarks, not service-level thresholds:

- Wiki-link indexing/projection: 1,000 notes / 3,000 links at roughly 16–18 ms; 5,000 / 15,000 at roughly 78–135 ms depending on the measured build (`docs/knowledge-graph.md` performance section).
- Graph path BFS: about 0.3 ms per path at 1,000 notes and about 2 ms at 5,000 notes.
- Graph display is bounded to 100/200/400 rendered nodes, default 200 (`docs/knowledge-graph.md` known limitations).
- Search/retrieval: 10,000-note fixture; explicit snapshot rebuild around 1.17 s; query after a note creation around 1.21 s; warm query avoids disk parse (`docs/knowledge-retrieval.md:134`).
- Task projection is bounded at 50,000 tasks (`docs/task-management.md`).
- Calendar expansion is bounded to visible dates and at most 366 dates per call (`src/calendar/layout.ts`).

These numbers should be treated as **starting measurements**, not capacity promises.

#### Unified graph risks

- **Node/edge multiplication:** every note can be a note node, a record projection, a task owner, an attachment referrer, and a calendar source.
- **Repeated projection:** relation projection is whole-vault; tasks and calendar add more scans.
- **Payload growth:** cross-object graph responses can become large.
- **Render cost:** SVG node/label rendering scales poorly without bounds.
- **Memory:** multiple domain indexes can coexist per vault.
- **Invalidation storms:** one title edit can invalidate global link resolution.

#### Recommended guardrails

- Hard caps per response: entity count, edge count, unresolved targets, per-node degree preview.
- Query-specific projections instead of always returning the full graph.
- Bounded traversal depth and visited-node count.
- Lazy domain loading in the UI.
- Render limits by entity kind and viewport.
- Server-side timing instrumentation for snapshot, extract, normalize, and serialize phases.
- Benchmarks for at least: 1k, 5k, 10k notes; 10k relation edges; 5k tasks; 2k attachments; mixed-kind graph queries.
- Explicit failure/degradation states when a domain projection fails, rather than failing the whole graph.

### 5.8 Extensibility

#### Current extension surface

- `src/plugins/` provides manifest validation, package discovery, inventorying, and an in-memory registry.
- `docs/plugin-architecture.md:3` states that plugins are metadata-only and not executable.
- There is no plugin runtime, permission enforcement, or UI contribution system.

#### Recommended internal extension points (core-owned first)

- **Source extractor registry** — each domain contributes entities and edges from a normalized snapshot.
- **Entity kind registry** — kind, label, icon, identity policy, supported operations.
- **Edge kind registry** — kind, provenance constraints, label, traversal semantics.
- **View contribution registry** — filters, grouping, and display options for the unified graph.
- **Query adapter registry** — optional domain-specific query handlers.

These should be **internal, versioned contracts** first. Exposing them to plugins should wait for the plugin runtime and permission model. A plugin must never be able to forge a confirmed edge or mutate source data without explicit consent.

#### Compatibility rules

- New entity/edge kinds are additive.
- Unknown kinds are preserved but not interpreted by older readers if persisted.
- A persisted graph cache format requires a version and a rebuild path.
- Extractor output changes require an index version bump.
- No plugin-specific fields in authoritative Markdown or vault JSON without a format decision.

### 5.9 Privacy and security

#### Strengths

- Storage is local; no telemetry or AI calls in the audited graph/task/calendar/search paths.
- The local API is loopback-oriented and origin-checked.
- Attachment serving uses no-sniff and sandbox headers (`src/ui-server/api.ts` attachment route).
- Vault switching is allow-listed (`docs/storage.md:229`).
- Backup/export hashes detect accidental changes, not authorship.

#### Unified graph-specific risks

- **Concentration:** a unified index reveals relationships that were previously separate. Treat it as sensitive metadata even if bodies are not duplicated.
- **Cross-vault leakage:** a cache keyed only by path could collide after a vault move or copy. Use a canonical vault identity and clear caches on switch.
- **Portable exports:** graph views or caches must not silently include absolute paths or content from other vaults.
- **External bookmark/calendar indexing:** do not read OS-level data without explicit user action and a clear scope.
- **Attachments:** do not index file contents by default; content extraction is a separate privacy-sensitive feature.
- **Recommendations:** inferred edges must not be presented as facts or used to auto-modify data.
- **Logs/diagnostics:** avoid logging note content or full graph payloads; prefer IDs, counts, and timing.

#### Recommended privacy rules

1. The graph is vault-scoped by default.
2. No network transfer of graph data.
3. No OS-wide indexing without explicit consent.
4. No content extraction from attachments without a separate feature decision.
5. No cross-vault graph until a workspace identity and access model exist.
6. Persistent caches, if added, are local-only and excluded from portable export unless deliberately versioned.
7. UI must label provenance and uncertainty.

### 5.10 Prerequisites

A unified graph should not begin implementation until these are resolved:

1. **Object scope decision:** which absent object types are actually in scope, and which are deferred.
2. **Identity contract:** persistent vs derived vs path-based identity for every included kind.
3. **Edge taxonomy and provenance:** declared vs structural vs derived vs inferred.
4. **Record projection rule:** whether a database record is a separate node or an annotation on its note node.
5. **Task/event policy:** ephemeral graph nodes only, or durable identity with a new format.
6. **Project model decision:** folder convention, note-backed project, or new persistent object.
7. **Workspace model:** single active vault only, or a multi-vault registry.
8. **Query/API contract:** filters, pagination, limits, and error semantics.
9. **Performance budgets:** snapshot, projection, query, response size, and render limits.
10. **Persistence decision:** in-memory only vs a disposable cache.
11. **Privacy review:** cross-vault isolation, OS data access, attachment content, and portable output.
12. **Format/version policy:** any new persisted object or cache requires versioning, tests, backup/export behavior, and migration rules.
13. **UX discovery:** where users find the unified graph and how provenance is explained.
14. **Accessibility:** keyboard traversal, focus, labels, and non-visual alternatives.
15. **Documentation:** update the authoritative feature guides and roadmap only after delivery.

---

## 6. Proposed capabilities

These are future capabilities, not commitments.

### 6.1 Core read model

- A read-only unified entity/edge API over the active vault.
- Entity kinds: note, database record, database, task (derived), calendar event (derived), attachment.
- Edge kinds: wiki link, typed relation, database membership, task ownership, calendar source, attachment reference.
- Provenance and unresolved status on every edge.
- Stable pagination and explicit caps.

### 6.2 Unified exploration

- A graph view filterable by entity kind and edge kind.
- Cross-object backlinks on note and record pages.
- “Related objects” panel combining declared and inferred evidence with labels.
- Explainable path search across selected edge kinds.
- Saved unified views, vault-scoped and exportable as preferences.

### 6.3 Discovery and health

- Unified isolated/orphan analysis across kinds.
- Broken attachment references, unresolved wiki links, missing relation targets, and stale derived events in one diagnostic surface.
- Cluster and connectivity metrics that state which edge kinds they include.
- No automatic repair; explicit actions only.

### 6.4 Optional later capabilities

- Project entity and project membership edges.
- Bookmark entity with explicit local capture.
- Canvas document format and canvas containment edges.
- Imported document extraction and document nodes.
- Persistent disposable cache.
- Plugin-contributed entity/edge kinds after a plugin runtime exists.

### 6.5 Explicit non-capabilities

- No automatic semantic edge generation presented as confirmed.
- No automatic note/task/project creation from graph structure.
- No multi-user shared graph.
- No cloud graph service.
- No background indexing of the user's entire filesystem.

---

## 7. Potential data model

This section is conceptual. It is not a proposed file format or a committed API.

### 7.1 Entity kinds

| Kind | Persistence | Identity | Notes |
|---|---|---|---|
| `note` | Persistent | Note UUID v4 | Canonical knowledge object. |
| `database` | Persistent | Database UUID | Schema/configuration node; optional in graph views. |
| `database-record` | Projection of note | Owning note UUID | Prefer collapsing into the note node unless the UI needs a record-specific projection. |
| `task` | Derived | Source-scoped derived ID | Ephemeral; no durable links. |
| `attachment` | Persistent file | Attachment UUID (policy needed) | No sidecar metadata today. |
| `calendar-event` | Derived | Source/config-derived ID | Ephemeral; no persisted event. |
| `project` | Undefined | Undefined | Requires a product model. |
| `bookmark` | Undefined | Undefined | Requires a product model and privacy rules. |
| `document` | Note-backed today | Note UUID if note-backed | Distinct imported document model is absent. |
| `canvas` | Undefined | Undefined | Requires a versioned canvas format. |

### 7.2 Source references

Every entity and edge should carry a source reference:

```ts
interface SourceRef {
  /** Domain that produced the projection. */
  domain: 'notes' | 'databases' | 'tasks' | 'calendar' | 'attachments' | 'projects' | 'bookmarks' | 'documents' | 'canvas';
  /** Stable source identity, e.g. note UUID or database UUID. */
  id: string;
  /** Source revision used for this projection. */
  revision?: string;
  /** Optional field/property/line locator for explainability. */
  locator?: string;
}
```

### 7.3 Edge status

```ts
type EdgeStatus =
  | 'confirmed'
  | 'unresolved'
  | 'ambiguous'
  | 'missing-target'
  | 'incompatible-target'
  | 'derived'
  | 'inferred';
```

Do not use `confirmed` for recommendations. Do not create fake target entities for unresolved text.

### 7.4 Record identity rule

Recommended default:

- A database record is **the same entity as its note** for graph identity purposes.
- The database membership is an edge from the note to the database definition.
- Record-specific properties remain metadata on the note/record projection.
- A record-specific view can label the node as a record without minting a second ID.

This avoids duplicate nodes and preserves the existing design where `Note.id` is the only record identity (`docs/database-relations.md`).

### 7.5 Task and event rule

Recommended default:

- Tasks and calendar events are **derived nodes** with source references.
- They may appear in views and paths, but edges to them are recomputed and not stored.
- If durable task identity is later required, it must be a separate format decision, not an implicit consequence of the graph.

### 7.6 Workspace identity

- Current product scope: one active vault.
- Graph identity tuple: `workspaceId + kind + id`.
- `workspaceId` should be a locally generated stable identifier, not a raw absolute path in portable output.
- Cross-vault edges are out of scope until a workspace registry, access model, and privacy review exist.

---

## 8. Dependencies

### 8.1 Existing implementation dependencies

| Dependency | Why it matters | Evidence |
|---|---|---|
| Root-locked note snapshot | Consistent source for all extractors | `src/storage/fs/vault.ts:384` |
| Stable note UUIDs | Durable entity identity | `src/domain/note.ts:8`; `src/domain/ids.ts` |
| Wiki-link resolver | Existing declared note edges | `src/links/wikilink.ts:55` |
| Relation projection | Existing typed record edges | `src/database/relations.ts:85` |
| Task extraction | Derived task nodes | `src/tasks/extract.ts:145` |
| Calendar projection | Derived event nodes | `src/calendar/events.ts:58` |
| Attachment inventory | Attachment nodes and references | `src/storage/fs/vault.ts:352` |
| Search/retrieval | Text evidence and filtering | `src/search/search-index.ts`; `src/search/retrieval.ts` |
| Snapshot cache | Shared rebuild/lifecycle | `src/indexing/snapshot-cache.ts` |
| UI graph primitives | Reusable viewport/layout/filtering | `ui/src/graph-model.ts`; `ui/src/graph-viewport.ts`; `ui/src/GraphView.tsx` |
| shadcn/ui compositions | Consistent UI controls | `ui/src/components/ui/**`; `AGENTS.md` |

### 8.2 Product and roadmap dependencies

These are **conditional dependencies**, not new roadmap phases:

- **Project model:** if projects are in scope, the product must decide whether a project is a folder convention, a note-backed object, or a new persistent type. The roadmap currently lists Tasks and Project Management as **PLANNED** (`docs/ROADMAP.md:1577`).
- **Calendar evolution:** if events become durable or gain time-of-day/dependencies, the temporal contract must change first (`docs/temporal-contract.md`).
- **Advanced search/queries:** unified graph filters may benefit from the planned query work (`docs/ROADMAP.md:1513`), but the first graph should not depend on it.
- **Performance work:** persistent indexing and capacity claims depend on measured budget work, not a roadmap promise.
- **Plugin runtime:** plugin-contributed graph kinds depend on the plugin workstream and its security model. Current plugin code is metadata-only (`docs/plugin-architecture.md:3`).
- **Synchronization:** cross-device stable identity and conflict handling would need the future sync work; current relay/sync code is experimental and unwired (`docs/ROADMAP.md` current state table).
- **Security review:** cross-vault or external-data indexing requires a privacy/security review before implementation.

### 8.3 Avoided dependencies

- No graph database.
- No force-layout library.
- No embedding model or vector database.
- No new runtime network service.
- No plugin execution dependency.

---

## 9. Risks

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Identity instability for tasks/events/attachments | Broken links, stale saved views, misleading history | High if treated as durable too early | Mark them derived; do not persist links; define a format before durable identity. |
| Duplicate nodes for notes and records | Double-counted metrics, confusing graph | High | Use note UUID as record identity; label record projections without minting a second ID. |
| Declared vs inferred edges conflated | Users trust guesses as facts | High | Provenance is mandatory; recommendations never use `confirmed`. |
| Graph explosion | Slow queries and unusable visuals | Medium | Kind filters, caps, pagination, lazy projections. |
| Invalidation gaps | Stale or contradictory graph | High without design | Dependency-aware invalidation, generation guards, explicit refresh. |
| Full rebuild cost | Slow startup and edits at scale | Medium | Start in-memory; measure; add cache only with evidence. |
| Persistent cache corruption | Wrong graph or blocked startup | Medium | Disposable cache, versioned, rebuild-on-corruption, never authoritative. |
| Cross-vault leakage | Privacy breach and wrong data | Low now, high if multi-vault added | Workspace identity, cache isolation, no combined index by default. |
| Attachment content indexing | Privacy and performance risk | Medium if scope expands | Do not extract bytes by default; separate explicit feature. |
| New object formats proliferate | Compatibility and backup burden | High if projects/bookmarks/canvas are rushed | One versioned format per real object; update compatibility matrix and backup/export. |
| Scope creep into product features | Graph becomes a hidden project manager | High | Graph is read-only; object creation stays in owning features. |
| UI complexity | Users cannot tell what they are seeing | High | Progressive disclosure, legend, provenance labels, filters, empty states. |
| Accessibility regressions | Keyboard/screen-reader users excluded | Medium | Reuse accessible graph primitives; test focus, labels, and non-visual lists. |
| Documentation drift | Agents infer nonexistent support | Medium | This document is explicitly future; authoritative guides remain current behavior. |
| Performance claims without budgets | False scalability claims | Medium | Treat benchmarks as observations; add budgets before capacity claims. |
| Plugin overreach | Untrusted code forges edges or reads data | Low now, high later | Keep core-owned until runtime/permissions exist. |
| Backup/export drift | Graph cache or new object missing from portability | Medium | Decide authoritative vs disposable; update manifests and tests. |

---

## 10. Staged future implementation proposal

This is a **proposal**, not an approved roadmap sequence. It intentionally avoids phase numbers and status changes.

### Stage 0 — Contract and discovery

**Goal:** Decide scope and contracts before code.

Work:

- Resolve open questions in section 12.
- Define the entity/edge/provenance contract.
- Decide whether records are collapsed into notes.
- Decide whether tasks/events are ephemeral only.
- Decide whether projects/bookmarks/canvas are in scope.
- Define performance and response-size budgets.
- Define privacy and workspace isolation rules.
- Add fixture scenarios and expected graph outputs.

**Exit criteria:**

- A reviewed design document with explicit non-goals.
- No source format or roadmap status changed.
- Every included object has an identity classification.
- Every edge has a provenance class.

### Stage 1 — Read-only note and record graph

**Goal:** Prove the composition layer with the strongest existing data.

Work:

- Compose `graphFromLinkIndex` and `projectRelations` into a unified read model.
- Entity kinds: note, database, database-record projection.
- Edge kinds: wiki link, typed relation, membership.
- Preserve unresolved/ambiguous/missing/incompatible statuses.
- Add a read-only API with filters and caps.
- Add provenance labels to the UI.
- Keep existing graph/backlinks APIs working.

**Exit criteria:**

- Existing note graph behavior unchanged.
- Record relation edges appear with property provenance.
- No duplicate note/record nodes in the default view.
- Response limits and error states tested.
- No persistent index added.

### Stage 2 — Derived task, calendar, and attachment nodes

**Goal:** Extend coverage without granting durable identity.

Work:

- Add derived task nodes and `contains-task` edges.
- Add derived calendar-event nodes and `scheduled-as` edges.
- Add attachment nodes and `attached-to` edges from Markdown references.
- Add per-domain lazy loading and failure isolation.
- Add caps and truncation indicators.

**Exit criteria:**

- A failed task/calendar/attachment projection does not break the note graph.
- Derived nodes are visibly marked and cannot be used as durable link targets.
- Attachment references are read-only and path-safe.
- Mixed-kind queries meet agreed budgets.

### Stage 3 — Unified exploration UX

**Goal:** Make the graph understandable and useful.

Work:

- Entity-kind and edge-kind filters.
- Cross-object backlinks on note/record pages.
- Provenance legend and explanation panel.
- Bounded path search across selected edge kinds.
- Unified saved views, vault-scoped.
- Accessible keyboard traversal and non-visual result lists.
- Empty, loading, partial, and error states.

**Exit criteria:**

- Users can answer the core questions in section 2.1 without hidden knowledge.
- Graph never implies inferred edges are confirmed.
- Existing graph saved views remain compatible or migrate explicitly.
- Browser and accessibility checks pass.

### Stage 4 — Incremental invalidation and performance hardening

**Goal:** Reduce rebuild cost and prevent stale projections.

Work:

- Add dependency-aware invalidation for link resolution and relation projections.
- Add generation guards and source revisions.
- Instrument snapshot/extract/normalize/serialize phases.
- Add mixed-kind benchmarks and budgets.
- Degrade gracefully when a domain exceeds its cap.

**Exit criteria:**

- One note edit does not force unnecessary full domain rebuilds where avoidable.
- Stale generations cannot publish over newer ones.
- Budgets are documented and measured.
- No correctness regression in existing projections.

### Stage 5 — Optional disposable cache

**Goal:** Consider persistence only if measurement requires it.

Work:

- Evaluate cache location, versioning, corruption recovery, and privacy.
- Store only the minimum derived data.
- Exclude from authoritative backup/export or version it deliberately.
- Rebuild on mismatch.
- Document the cache lifecycle.

**Exit criteria:**

- Measured improvement justifies the complexity.
- Corrupt cache falls back safely.
- Vault switch and external edits cannot leak stale data.
- Portability behavior is explicit.

### Stage 6 — Optional new object kinds

**Goal:** Add projects, bookmarks, documents, or canvas only as separately approved features.

Work:

- Define a versioned format and stable identity.
- Define backup/export/import behavior.
- Define permissions and privacy.
- Add migration/repair diagnostics.
- Add graph extractors only after the object exists.

**Exit criteria:**

- Each object is useful outside the graph.
- The graph does not justify the object by itself.
- Formats are versioned, tested, and portable.
- No hidden or duplicate source of truth is introduced.

---

## 11. Acceptance considerations

When this proposal is eventually evaluated for implementation, acceptance should cover:

### 11.1 Functional correctness

- Declared edges match their authoritative source exactly.
- Unresolved and ambiguous links remain distinguishable.
- Missing and incompatible relation targets are preserved, not dropped.
- Derived task and calendar nodes can be rebuilt without changing source files.
- Attachment references match Markdown destinations, including relative paths.
- Record nodes do not duplicate note identity in default metrics.

### 11.2 Provenance and explainability

- Every edge reports a kind and provenance.
- Inferred edges are never labeled confirmed.
- Path results include the edge sequence and source locators where available.
- The UI explains why an edge exists.
- No edge silently changes source data.

### 11.3 Workspace isolation and privacy

- Graph data is scoped to the active vault.
- Switching vaults clears caches and does not leak entities.
- No network transfer or telemetry.
- No OS-wide indexing without explicit consent.
- No attachment content extraction by default.
- Portable exports do not include absolute paths or other-vault data.

### 11.4 Performance and scale

- Agreed caps for entities, edges, unresolved targets, traversal, and render counts.
- Benchmarks exist for note-only and mixed-kind workloads.
- One large domain cannot make the entire graph unusable.
- Query latency and payload budgets are measured, not assumed.
- Full rebuild cost is documented.

### 11.5 Compatibility and portability

- Existing graph, backlinks, discovery, relation, task, and calendar behavior remains intact.
- Existing saved graph views either continue to work or migrate explicitly.
- No authoritative Markdown or database format changes without a version decision.
- Any new persistent object or cache has backup/export/import behavior and tests.
- Older readers reject unsupported versions rather than silently dropping data.

### 11.6 UX and accessibility

- Users can discover the unified graph from existing surfaces.
- Empty, loading, partial, error, and truncation states are explicit.
- Keyboard traversal, focus treatment, labels, and non-visual result lists work.
- Provenance and uncertainty are understandable without documentation.
- The feature does not become a hidden project-management workflow.

### 11.7 Documentation

- Authoritative guides describe only delivered behavior.
- This future document remains clearly marked as non-authoritative planning.
- Roadmap status changes only after implementation and verification.
- Compatibility matrix and known limitations are updated with any new format.

---

## 12. Open questions

These require product/architecture decisions before implementation. They are intentionally unresolved.

1. **Project semantics:** Is a project a folder, a note-backed convention, a database record, or a new persistent object?
2. **Project membership:** Can an object belong to multiple projects? Is membership derived from a property, a folder, or explicit edges?
3. **Bookmark semantics:** Are bookmarks internal note references, external URLs, or both? What is captured: title, URL, excerpt, favicon, snapshot?
4. **Bookmark privacy:** Should Nodus ever read browser bookmarks? If so, how is explicit consent obtained and scoped?
5. **Canvas semantics:** Is a canvas a document with durable nodes/edges, or a saved arrangement of existing entities? What is the file format?
6. **Canvas identity:** If a canvas references a note, is the reference by ID, path, or embed block?
7. **Document identity:** Are imported documents separate entities or note-backed attachments? Is content extraction in scope?
8. **Task durability:** Do tasks need stable IDs across edits/reordering? If yes, what format change is acceptable?
9. **Calendar durability:** Do events need durable identity beyond their source record/task and date properties?
10. **Record nodes:** Should database records be collapsed into note nodes by default, or displayed as a distinct “record view” of the same identity?
11. **Edge confidence:** Should inferred edges be included at all in the first unified graph, or only declared/structural edges?
12. **Edge direction:** Are structural edges directed, undirected, or separately labeled for traversal?
13. **Cross-vault scope:** Is a combined multi-vault graph a real product goal, or is “workspace” always one vault?
14. **Workspace identity:** What stable identifier should replace an absolute path for cache and export scoping?
15. **Cache persistence:** Is a persistent cache ever justified, and where should it live?
16. **Cache portability:** Should a graph cache ever be exported, or is it always disposable?
17. **Plugin contributions:** Should plugins be able to add entity/edge kinds, and under what permission model?
18. **Synchronization:** How do stable IDs and graph revisions behave across devices and conflicts?
19. **Attachment identity:** What is the rename/move contract for managed attachments, and is a sidecar metadata file acceptable?
20. **Attachment content:** Should text/PDF/OCR extraction ever be indexed? What are the privacy and performance costs?
21. **Tag entities:** Are tags first-class graph nodes, or only note metadata and filters?
22. **Derived clusters:** Should connectivity clusters be exposed as graph entities, or remain view-level analytics?
23. **Performance target:** What vault size and mixed-kind workload define “acceptable” for release?
24. **Accessibility target:** What keyboard and screen-reader model is required for a multi-kind graph?
25. **Documentation ownership:** Which guide becomes authoritative for the unified graph once implemented?

---

## 13. Source references

### 13.1 Core domain and storage

- `src/domain/note.ts` — `Note` (`:8`), `validateNote` (`:40`), `createNote` (`:52`), note format version (`:6`).
- `src/domain/ids.ts` — UUID v4 validation.
- `src/domain/paths.ts` — workspace-relative path rules.
- `src/storage/contracts.ts` — `VaultEntry` (`:79`), `NoteStore` (`:94`), `DatabaseStore` (`:107`), `PropertyStore` (`:134`), `TagStore` (`:140`), `DatabaseViewStore` (`:151`), `VaultStorage` (`:455`).
- `src/storage/fs/vault.ts` — `snapshotNotesWithHashes` (`:384`), `listAttachmentsUnlocked` (`:352`), `setNoteProperty` (`:429`), `snapshotForPortableExport` (`:1321`).
- `src/storage/fs/layout.ts` — vault layout constants and reserved paths.
- `src/storage/fs/scan.ts` — `walkVault`, hidden/reserved handling, attachment directory detection.
- `src/storage/fs/attachments.ts` — `ATTACHMENT_MAX_BYTES` (`:6`), `AttachmentInfo` (`:11`), `attachmentPathId` (`:34`), `createAttachmentPath` (`:39`), `validateAttachmentBytes` (`:51`), `markdownReferencesAttachment` (`:64`); `VaultAttachment` shape in `src/storage/contracts.ts:41`.
- `src/storage/fs/root-lock.ts` — cooperative process lock.
- `docs/storage.md` — vault layout, allow-lists, health, import/export, backup, privacy.
- `docs/note-format.md` — stable IDs and paths, plain Markdown behavior.

### 13.2 Links and graph

- `src/links/wikilink.ts` — `parseWikiLinks` (`:28`), `resolveLink` (`:50`), `createLinkResolver` (`:55`), `isExternalTarget` (`:106`).
- `src/links/link-index.ts` — `LinkIndex` (`:14`), `buildLinkIndex` (`:24`).
- `src/links/backlinks.ts` — note backlink projection.
- `src/links/graph.ts` — `GraphNode` (`:3`), `GraphEdge` (`:9`), `NoteGraph` (`:25`), `graphFromLinkIndex` (`:36`).
- `src/links/graph-analytics.ts` — `GraphAnalytics` (`:23`), `analyzeGraph` (`:52`).
- `src/links/graph-paths.ts` — `shortestGraphPath` (`:33`).
- `src/links/graph-cluster-insights.ts` — `graphClusterInsights` (`:23`).
- `src/links/related-notes.ts` — `relatedNotes` (`:37`).
- `src/links/link-repair.ts` — explicit link repair.
- `ui/src/graph-model.ts` — `visibleGraph` (`:64`), `positionGraph` (`:165`).
- `ui/src/graph-viewport.ts` — viewport constants and transform helpers.
- `ui/src/graph-saved-views.ts` — `GRAPH_VIEWS_STORAGE_VERSION` (`:3`), `graphViewsStorageKey` (`:69`), load/write (`:208`, `:213`).
- `ui/src/GraphView.tsx` — `GraphView` (`:39`).
- `docs/knowledge-graph.md` — current graph behavior, API, limitations, performance.
- `docs/wiki-links.md` — wiki-link syntax and resolution.

### 13.3 Database and relations

- `src/database/schema.ts` — `DATABASE_FORMAT_VERSION` (`:8`), property types (`:10`), `isDerivedProperty` (`:29`), `DatabaseDefinition` (`:32`).
- `src/database/note-properties.ts` — `projectNoteProperties` (`:92`).
- `src/database/relation-contract.ts` — relation configuration (`:9`), values (`:16`), validation (`:39`).
- `src/database/relations.ts` — `configurationIssues` (`:36`), `projectRelations` (`:85`), `projectIncomingRelations` (`:274`).
- `src/database/database-view.ts` — saved-view definitions.
- `src/database/database-view-order.ts` — saved-view ordering manifest.
- `docs/database-relations.md` — relation identity, storage decision, reverse relations, rollups, lifecycle.
- `docs/database-format.md` — database definition format.
- `docs/database-views.md` — saved views and layouts.
- `docs/structured-data-adr.md` — note-property portability and projection decision.

### 13.4 Tasks and calendar

- `src/tasks/extract.ts` — `ExtractedTask` (`:10`), `extractTasksFromBody` (`:65`), `buildTaskProjection` (`:145`), task ID derivation (`:97`), `setTaskChecked` (`:188`), `setTaskScheduledDate` (`:199`).
- `src/calendar/events.ts` — `CalendarEventSource` (`:22`), `CalendarEvent` (`:26`), `projectCalendarEvents` (`:58`), `databaseEventId` (`:130`).
- `src/calendar/layout.ts` — bounded month/week/day expansion.
- `ui/src/task-view.ts` — task filtering/sorting/grouping.
- `ui/src/DatabaseLayouts.tsx` — Calendar layout uses `projectCalendarEvents` (`:138`).
- `docs/task-management.md` — task syntax, projection, limits.
- `docs/temporal-contract.md` — date semantics, task scheduling, event projection.

### 13.5 Search, indexing, and retrieval

- `src/search/search-index.ts` — `buildSearchIndex`, `SearchIndex`, query execution.
- `src/search/query.ts` — search syntax.
- `src/search/note-filters.ts` — metadata filters.
- `src/search/retrieval.ts` — fingerprint reuse (`:44`), `buildRetrievalIndex`, BM25 scoring (`:69`).
- `src/indexing/snapshot-cache.ts` — `createSnapshotCache`.
- `src/properties/catalog.ts` — `projectPropertyValues`.
- `src/ui-server/api.ts` — shared knowledge index (`:170`), per-vault caches (`:188`), graph routes (`:588`), relation backlinks, search route (`:965`), task route (`:649`).
- `docs/global-search.md` — search behavior, in-memory index, no persistence.
- `docs/knowledge-retrieval.md` — retrieval evidence, projection reuse, limits, measurements.
- `docs/search-benchmark.md` — search benchmark notes.

### 13.6 Workspace, UI, and preferences

- `src/ui-server/api.ts` — `activeVaultPath` (`:145`), `buildKnowledgeIndex` (`:170`), per-vault cache map (`:188`), `activateVault` (`:318`), index clearing (`:357`), vault open route (`:475`), attachment routes.
- `ui/src/workspacePreferences.ts` — load (`:139`), save (`:195`), vault-scoped records.
- `ui/src/searchPersistence.ts` — vault-scoped search preferences (`:36`).
- `ui/src/graph-path-history.ts` — vault-scoped path history (`:16`).
- `docs/workspace-customization.md` — browser-local workspace preferences.
- `docs/storage.md` — vault allow-list and switching rules.

### 13.7 Extensibility and roadmap context

- `src/plugins/index.ts` — plugin exports.
- `src/plugins/types.ts` — manifest and capability types.
- `docs/plugin-architecture.md` — historical proposal; current metadata-only boundary (`:3`).
- `docs/ROADMAP.md` — current state (`:143`), graph phases (`:1258`, `:1375`, `:1403`, `:1432`, `:1461`), Phase 18 projects (`:1577`), whiteboard proposal (`:1828`), feature inventory, compatibility matrix (`:2533`), risks (`:2606`).
- `docs/product-vision.md` — long-term workspace and database direction (`:30`), roadmap relationship (`:167`).

### 13.8 Existing tests relevant to a future implementation

The following tests are evidence of current behavior, not tests for the proposed graph:

- `test/graph.test.ts`, `test/graph-api.test.ts`, `test/graph-exploration.test.ts`
- `test/graph-analytics.test.ts`, `test/graph-paths.test.ts`, `test/graph-cluster-insights.test.ts`
- `test/graph-saved-views.test.ts`, `test/graph-layout.test.ts`, `test/graph-viewport.test.ts`
- `test/link-index.test.ts`, `test/wikilink.test.ts`, `test/backlinks.test.ts`, `test/link-repair.test.ts`
- `test/database-relations.test.ts`, `test/relation-api-lifecycle.test.ts`, `test/relation-contract.test.ts`
- `test/tasks-extract.test.ts`, `test/task-view.test.ts`, `test/ui-tasks-api.test.ts`
- `test/calendar-events.test.ts`, `test/calendar-layout.test.ts`, `test/ui-calendar-integration.test.tsx`
- `test/search-index.test.ts`, `test/knowledge-retrieval.test.ts`, `test/retrieval-api.test.ts`
- `test/storage-attachments.test.ts`, `test/storage-vault.test.ts`, `test/storage-root-lock.test.ts`

---

## 14. Audit method and caveats

Searches covered `src/`, `ui/src/`, `test/`, `scripts/`, and `docs/` for:

- object names: `project`, `bookmark`, `canvas`, `whiteboard`, `document`, `attachment`, `task`, `calendar`, `database`, `workspace`;
- graph concepts: `graph`, `backlink`, `relation`, `edge`, `node`, `cluster`, `path`, `index`;
- identity concepts: `id`, `uuid`, `stable`, `alias`, `path`, `reference`;
- persistence concepts: `snapshot`, `cache`, `incremental`, `persistent`, `index`, `rebuild`.

Caveats:

- Classification is limited to the audited working tree, including uncommitted and untracked documentation and source changes. Untracked plugin work and local drafts were treated as context, not as delivered product behavior.
- A `NOT FOUND` result means no implementation was located in the searched paths. It does not prove that no related concept exists under a different name.
- Benchmarks cited from documentation are local observations, not service-level guarantees.
- This document deliberately avoids assigning roadmap phase numbers or statuses. The roadmap remains authoritative.
