# Database relations and rollups

Database format version 2 adds `relation` and `rollup` properties. Schemas with only legacy
properties still serialize as version 1. No note-format, structured-namespace, or saved-view
version changes are needed: forward values use existing YAML scalars/arrays. Older database
readers reject v2 rather than silently dropping configuration. Schema edits never rewrite notes.

## Forward relations

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "name": "Tasks",
  "type": "relation",
  "relation": {
    "databaseId": "22222222-2222-4222-8222-222222222222",
    "cardinality": "many"
  }
}
```

`one` stores a lowercase note UUID scalar; `many` stores a unique array of lowercase note UUIDs.
Absent, null, and (for multiple fields) an empty array mean no relation. An empty array is invalid
for a `one` field. Clearing a value keeps
database membership. Titles, aliases and paths are display metadata, never identities.

Targets must be existing note records with explicit membership in the configured target database.
The storage layer reparses current schemas and notes while holding the vault root lock, checks
cardinality, UUIDs and membership, and then makes one conditional atomic source-note write. A
missing target note reports `MISSING_TARGET`, a present note without valid target membership reports
`INCOMPATIBLE_TARGET`, and a missing configured target database reports `INVALID_CONFIGURATION`.
These are returned as structured property issues; a rejected write leaves the source note unchanged.
Explicitly clearing an empty/dangling value is permitted even if the target database was deleted,
so users can repair the source property. It does not create a relation. The operation does not
create a target, change target membership, or write a second reciprocal property. Self-relations
are allowed.

The in-process queue and exclusive `.nodus-vault-write.lock` serialize cooperating Nodus mutations
to the same real vault root, including target deletion/movement/database deletion and relation
writes. The source note is protected by its expected raw-byte hash. This is not a transaction against
external filesystem editors: they do not honor the lock and can race target validation. No
vault-wide atomicity is claimed.

Renames and Nodus moves retain identity. Deleting a record or its database does not cascade-delete
references. Reads preserve dangling UUIDs and diagnose missing/incompatible targets. The picker
shows selected missing IDs with removal controls; an explicit clear or valid replacement repairs
that property. Moving a note path preserves references. If its database membership changes through
an explicit metadata replacement or import, links to it become `incompatible` until membership is
restored or the source value is repaired. Deleting a target database leaves source values intact
and reports invalid relation configuration. Deleting a source removes its outgoing values with that
source. Unknown/future namespaces and unrelated malformed stored values still block writes.

## Reverse relations

A reverse property uses `type: "relation"`, `cardinality: "many"`, a `databaseId` naming the
source database, and `reversePropertyId` naming its forward relation property. That forward
property must target the current database. Reverse values are the live matching source note IDs,
computed from valid forward edges. They are read-only and never stored in YAML. Reverse-of-reverse
configuration is invalid. Single forward edges can still have multiple incoming source records.

## Rollups

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "name": "Total estimate",
  "type": "rollup",
  "rollup": {
    "relationPropertyId": "11111111-1111-4111-8111-111111111111",
    "operation": "sum",
    "targetPropertyId": "44444444-4444-4444-8444-444444444444"
  }
}
```

The relation may be forward or reverse. Only live, compatible records participate; a preserved
missing/incompatible reference produces a diagnostic and contributes nothing.

| Operation | Configuration | Empty result / missing values |
|---|---|---|
| `count` | Relation only | 0 |
| `conditional-count` | `condition: { propertyId, value }` | 0; exact scalar equality or membership in a multi-select array; absent values do not match |
| `sum` | Numeric or rollup `targetPropertyId` | 0; missing/null numeric values are ignored |
| `completed-task-count` | Checkbox `targetPropertyId` | 0; only explicit `true` is completed |
| `completion-percentage` | Checkbox `targetPropertyId` | null without live related records; otherwise completed / live records × 100 |

Completion refers to related task **records** and their selected Checkbox, not Markdown body
checkboxes. Missing Checkbox values count as incomplete. Percentages are numeric values from 0
to 100, shown to one decimal place in the UI. Numeric sums must remain finite.

Structural configuration errors are rejected by the schema parser. Missing/incompatible
cross-schema references are diagnosed without deleting portable files. Invalid configurations,
malformed relation/target values, circular rollup dependencies, numeric overflow, or excessive evaluation
depth (128) produce unavailable results, displayed as an em dash. Circular configuration is
detected even when there are no records; downstream rollups cannot turn unavailable dependencies
into a misleading zero. Unavailable and null values do not match numeric filters.

Stored rollup/reverse values are ignored and diagnosed as invalid authoritative data; remove
those keys from Markdown to repair the note. The application never writes derived values.

## UI and portability

Use Edit schema to add/configure these types. Record selection uses Command/Popover with
title/path/ID search and keyboard selection; forward fields allow explicit removal/clearing.
Related record links open notes by stable ID. Reverse fields and rollups are read-only.
Table and card layouts expose the same values and diagnostics. After edits, derived rows refresh;
use Refresh for changes made elsewhere. There is no filesystem watcher.

For a database with only derived properties (or no properties), Add note explicitly creates an
empty membership mapping after confirmation. It never writes a reverse or rollup value. The API
uses `POST /api/databases/:id/rows` with `noteId`, `baseHash`, and `confirmCreate: true`.

Export/import and backup/restore preserve the same schema JSON, forward YAML UUIDs, and saved
views. Backup manifests record the highest database format actually present. Validation checks
file integrity, formats and schema shapes; dangling relationships are data diagnostics, not backup
corruption. Restore/import may carry temporarily unresolved cross-database references and never
materialize rollups. Reopening/rebuilding recomputes all reverse values and rollups from Markdown.
Import does not infer ID remappings: if an imported target database has a new ID while a source
schema still names the old one, the old configuration and note references are preserved and
diagnosed until explicitly repaired.

Focused checks: `pnpm exec vitest run test/database-relations.test.ts` and
`node scripts/relations-smoke.mjs` (installed Chromium required).

## Relation model and architecture decisions

### Identity and contracts

A database record is a Markdown note with a `nodus_data.databases[databaseId]` membership mapping; there is no database-local record ID. `Note.id` is a stable UUIDv4. A relation stores this note ID, never its title or path. Database definitions have separate stable UUIDv4 IDs, and a relation property names the target database plus cardinality.

The implementation exposes `RelationPropertyConfiguration`, `RelationCardinality`, `RelationValue`, `RelationTargetReference`, `RelationValueValidationResult`, and `RelationWriteDiagnostic` in `src/database/relation-contract.ts`. A value is one note UUID, an array of unique note UUIDs, or `null`, constrained by cardinality. Shape validation does not establish that a target exists or belongs to the configured database; those are graph/storage integrity checks. Display references carry the persistent `id` and projected title/path metadata with status `resolved`, `missing`, or `incompatible`. Diagnostics reuse `StructuredDataIssue` and include `MISSING_TARGET`, `INCOMPATIBLE_TARGET`, and `INVALID_CONFIGURATION`. They identify a problem without rewriting source Markdown.

The pure value validator enforces the scalar-vs-array distinction and rejects duplicate IDs. In particular, an empty array for a single relation is malformed rather than an implicit clear; `null` is the empty single value. A many relation accepts either `null` or `[]` as empty. Invalid source values are diagnosed and retained for explicit repair.

### Storage decision

Forward relation values remain in the source note's existing frontmatter beside the other database property values. This keeps the relationship with its owning note, permits an atomic conditional write of that one note, and allows Markdown, backup, export, and import to preserve it without a second authoritative file.

A separate relation index could accelerate reverse lookup, but it would be derived state that must be invalidated or rebuilt after edits, note moves, membership changes, schema edits, imports, and restores. A normalized vault-level relation store would separate links from the source note but require coordinated writes across files; current storage only promises atomicity per file, not vault-wide transactions. Neither alternative justifies its consistency and recovery costs at current measured scale. Reverse relations therefore remain derived projections over forward values and are not independently stored.

### Integrity lifecycle and compatibility

Malformed UUID syntax and unsupported cardinality are rejected by value/schema validation. A well-formed but absent target database is a configuration issue. A deleted target note remains as a dangling UUID and projects `missing`; an existing note that no longer belongs to the target database projects `incompatible`. Deleting a source note removes its outgoing values with that note. Deleting a target record or target database does not cascade into other notes. Self-links and cycles among relation edges are allowed and do not recursively traverse; rollup dependency cycles remain a separate diagnosed condition.

The database schema format is already v2 for relation/rollup properties; ordinary schemas continue to read and write v1. Relation values use note-property namespace v1. This milestone introduces no further version bump or migration. Backup and portable vault operations preserve source note and schema bytes. Partial restore/import can leave temporarily unresolved links, which remain stored and become readable diagnostics when projected; restore is not a multi-file transaction.

### Milestone boundary

Relation assignment reparses the current note set and schema set once inside the same root lock used by Nodus writes. It checks the target IDs and target memberships against those current parsed notes before writing the source note with its expected raw-byte hash. Concurrent cooperating Nodus mutations to the same vault are serialized by the in-process queue and exclusive process lock. If two requests have the same source hash, one can write and the other receives `STALE_WRITE`. This does not serialize external filesystem editors; target files can still change outside Nodus's lock. There is no claim of transactionality with external tools.

The existing implementation performs one strict note parse for the relation update and builds one note-ID lookup for validation; it does not run one full vault scan per target. Snapshot parsing remains O(vault notes), as in the existing storage design. No relation index or cache was added.

Milestone 7C.1 formalized the identity, configuration, value, reference, and diagnostic contracts. Milestone 7C.2 hardened write-time issue codes and added concurrency, deletion, target movement, and partial import/restore coverage. Existing API routes and relation controls predate those milestones; 7C.2 did not rebuild them.

## Relation editing and recovery (implemented in Milestone 7C.3)

The existing schema editor configures a relation's name, target database, cardinality, and forward or computed reverse direction. It shows the target database name and explains the one/many behavior. If a configured target or reciprocal forward property is unavailable, the editor names the problem and keeps the current configuration visible so it can be repaired. A reverse relation is computed and read-only.

Changing a relation's target, cardinality, or direction while notes have stored values requires an explicit in-sheet confirmation. The warning names affected properties and notes. Saving preserves all note values; references that no longer fit are diagnosed and can be repaired later. No schema edit silently rewrites relation values.

The existing Command/Popover picker edits the current draft, so its parent Save and Cancel actions commit or discard the selection. It searches already loaded candidates by title, path, aliases, and tags. Candidates are included with the database rows response; opening the picker and typing do not fetch or scan the vault again. Search is synchronous, so there are no out-of-order search responses. The list renders at most 50 matches at once and asks for a narrower query when more match. Selected references are shown 12 at a time with previous/next controls. Keyboard search and selection use the existing Command behavior: arrows move, Enter selects, and Escape closes the picker while leaving the draft available to save or cancel.

Resolved records open by stable note ID. When linked records have the same title, their paths are shown to distinguish them. Missing and incompatible references remain stored and appear with explicit status labels and a short ID suffix; the full UUID is not shown in normal UI text. In the editor, each unresolved reference can be removed, or a valid replacement can be selected. Replacement is an explicit user action; titles and paths are never used to guess a new target. The existing write API revalidates target membership and preserves the draft when a write fails. Stale writes offer the existing reload-and-keep-draft recovery.

The picker does not load note bodies or issue a request per keystroke. Its candidate list is part of the already loaded target-database data, so a very large target database still increases the initial rows response. Search results and selected-reference controls are bounded in the rendered UI; server-side paginated relation search is not implemented. Loading and query failures are handled by the existing database rows loading/error/retry state. These behaviors are implemented; relations remain forward values in note frontmatter, with reverse display derived from those values.

## Incoming relations and backlinks (implemented in Milestone 7C.4)

The editor has two separate incoming-reference sections: **Linked mentions** for wiki links and **Database relations pointing here** for structured relations. The latter is derived from forward relation values; it is available even when the source relation has no configured reciprocal property. When a valid reciprocal property exists on the target database, its name is shown as a helpful cue, but that property remains a read-only projection rather than another stored edge.

Each incoming relation identifies the source record by stable note ID and displays its current title, path, source database, and relation property. The path distinguishes duplicate titles. Activating the row opens the source note by ID, including across databases. The target page remains the current note; normal editor navigation provides the existing route back to the originating context. There is no recursive traversal and no title/path-based identity resolution.

An incoming link to a note that no longer belongs to the configured target database is retained and labeled **Incompatible target**. A relation value whose target note has been deleted cannot appear on a deleted target page; it remains on the source record and the existing relation display/diagnostics identify it as missing. Removing or changing the source relation, deleting the source record, or changing its database membership naturally changes the derived list. Deleting/moving targets never cascades into source Markdown. Backup, restore, portable export, and partial import preserve the forward values; opening/rebuilding the vault derives the incoming list again. Schema changes that remove or invalidate reciprocal configuration do not remove the forward edge; the section simply stops naming the absent reciprocal property.

### Derived lookup and performance

`GET /api/notes/:id/relation-backlinks` returns only the incoming entries for the requested live note. The API uses a short-lived derived snapshot cache over the vault's root-locked note/database snapshot, separate from the wiki-link/search cache so a malformed database schema cannot disable search or wiki backlinks. Note writes, database creation/replacement, restore, and explicit refresh invalidate or rebuild the relation snapshot. External edits are observed after the cache TTL or a manual refresh. No persistent reverse index is introduced, so there is no on-disk index recovery protocol to maintain. Projection is O(notes + valid relation edges) per snapshot build, followed by a target-key lookup. It parses each note's property memberships once for relation projection and sorts only each target's incoming entries for deterministic display. The response is limited to one target's edges; very highly connected targets can still produce a large response and a long scrollable list.

Run `pnpm exec vitest run --config vitest.database-benchmark.config.ts benchmark/relation-backlinks.benchmark.ts` to measure the projection at 100, 500, 1,000, and 5,000 records for a many-incoming and many-unrelated-edges workload. The benchmark reports the median of five in-memory projection runs after one warm-up; it excludes filesystem snapshot loading, HTTP serialization, and browser rendering. Results are environment-specific and should not be interpreted as end-to-end latency. Complexity is O(notes + relation edges + per-target ordering); a target with many incoming links adds O(k log k) sorting for its k displayed sources.

Measured on Node 24.19.0 in the current Windows development environment:

| Records | Workload edges | Incoming to selected target | Projection median | Serialized response estimate |
|---:|---:|---:|---:|---:|
| 100 | 99 concentrated / 50 distributed | 99 / 1 | 1.47 / 0.31 ms | 29.0 KB / 310 B |
| 500 | 499 concentrated / 250 distributed | 499 / 1 | 3.04 / 1.89 ms | 147.0 KB / 310 B |
| 1,000 | 999 concentrated / 500 distributed | 999 / 1 | 4.70 / 2.44 ms | 294.5 KB / 312 B |
| 5,000 | 4,999 concentrated / 2,500 distributed | 4,999 / 1 | 24.25 / 16.65 ms | 1.48 MB / 312 B |

The large concentrated case shows that response size grows with the requested target's actual incoming edge count; the UI virtualizes its scrollable list so it mounts only nearby entries. The HTTP payload still contains all incoming source summaries, and filesystem snapshot loading is not included in these numbers.
