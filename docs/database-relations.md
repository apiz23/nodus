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
Absent, null, and (for multiple fields) an empty array mean no relation. Clearing a value keeps
database membership. Titles, aliases and paths are display metadata, never identities.

Targets must be existing note records with explicit membership in the configured target database.
The API checks cardinality, UUIDs, membership, current schemas and source revision while holding
the vault root lock, then makes one conditional atomic source-note write. It does not create a
target, change its membership, or write a second reciprocal property. Self-relations are allowed.

Renames and Nodus moves retain identity. Deleting a record or its database does not cascade-delete
references. Reads preserve dangling UUIDs and diagnose missing/incompatible targets. The picker
shows selected missing IDs with removal controls; an explicit clear or valid replacement repairs
that property. Unknown/future namespaces and unrelated malformed stored values still block writes.
External editors can race filesystem operations as documented in the storage concurrency contract.

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

Focused checks: `pnpm exec vitest run test/database-relations.test.ts` and
`node scripts/relations-smoke.mjs` (installed Chromium required).
