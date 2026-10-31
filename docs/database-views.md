# Saved database views (version 3; legacy versions 1 and 2 supported)

Saved views are portable JSON files separate from database schema v1 and note frontmatter. They are query/presentation preferences only; Markdown notes remain the source of property values.

Files live at `database-views/<database-id>/<view-id>.json`:

```json
{
  "format": "nodus-database-view",
  "version": 3,
  "id": "665f1175-2b7a-4a21-9b2d-657bb79fa9a1",
  "databaseId": "9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73",
  "name": "Ready to read",
  "type": "table",
  "settings": {},
  "sort": { "propertyId": "title", "direction": "asc" },
  "sorts": [{ "propertyId": "title", "direction": "asc" }],
  "filters": [],
  "visiblePropertyIds": []
}
```

The title column is fixed and cannot be hidden. In v3, `sorts` is a non-empty ordered list of `{ propertyId, direction }` conditions; earlier entries have priority. Each uses `title` or a stable property UUID. The legacy `sort` field remains as the first sort for readers of v1/v2; v3 readers apply `sorts`. Ties finish by stable note ID and missing values sort last regardless of direction. Select sorting resolves through option IDs, so renaming an option preserves its order identity.

Filters use property UUIDs and stable select-option UUIDs, never labels, and combine with AND. Supported operators match property types: text `contains`/`equals`; number `equals`/`greater`/`less`; checkbox `is`; date `equals`/`before`/`after`; select `is`; multi-select `includes`. V3 adds `is-empty` and `is-not-empty` for text, number, date, checkbox, select, and multi-select; these operators have no `value` field. Missing and null values are empty; empty strings and arrays are empty; `false` and `0` remain present. Dates must be real `YYYY-MM-DD` calendar dates. The parser rejects unknown fields, duplicate filter/sort/property IDs, invalid values, malformed JSON, and unsupported future versions.

`type` is `table`, `list`, `kanban`, or `calendar`. List is a v3 presentation with empty settings, like table; v1/v2 readers continue to interpret legacy views as table and never encounter the new type. The shared `visiblePropertyIds` list controls table columns and the properties shown for each List item, Kanban card, and Calendar item. List keeps the record title and path as its primary content and reuses the same value formatters, edit actions, and filtered/sorted rows as Table. Kanban settings are `{ "groupPropertyId": "<select-property-uuid>" }`; Calendar settings are `{ "datePropertyId": "<date-property-uuid>" }`. Other setting fields are rejected. New views default to title ascending, no filters, all properties visible, and the first compatible grouping/date property. Creation of a Kanban/Calendar view requires a compatible property.

Version 1 has neither `type` nor `settings` and is interpreted as a table. Version 2 adds view type/settings. Version 3 adds `sorts` and valueless empty filters. Reads of v1/v2 deterministically expose their single `sort` as the effective sort; files are not rewritten during reads, backup, export, import, or restore. An explicit save that uses the new configuration writes v3. Older readers reject v3 rather than silently dropping configuration; database schema and note formats are unchanged. Backup and portable vault operations preserve the saved-view JSON bytes and use the shared parser to reject unsupported versions.

The storage/API layer reports missing database, property, or option references as diagnostics without rewriting or deleting the file. Explicit create/update operations require currently valid references and use raw-byte SHA-256 base hashes; an update also verifies the schema revision while holding the vault root lock. Deletion is explicit and conditional. Removing a database does not cascade-delete its saved-view files.

`GET /api/databases/:databaseId/views` returns `{ databaseId, schemaHash?, views }`, each with `view`, `path`, `contentHash`, and `diagnostics`. `POST` to that path accepts `{ view }`; `PUT /api/databases/:databaseId/views/:viewId` accepts `{ view, baseHash }`; `DELETE` at that item path accepts `{ baseHash }`. Unsupported/malformed view payloads are rejected. Stale writes return HTTP 409 `STALE_WRITE`; invalid schema references return 422 `INVALID_VIEW_REFERENCES`.

`GET` at the item path reads one view. `POST /api/databases/:databaseId/views/:viewId/duplicate` accepts `{ id, name, baseHash }`; it verifies the source revision and creates a distinct ID while holding the root lock. Duplication copies saved settings rather than unsaved UI drafts.

Portable vault export/import copies these files in their reserved tree. Backup writers emit manifest v2, including saved-view entries and counts. The reader continues to accept legacy v1 backups, which contain no saved views, and explicitly rejects future manifest versions. Older Nodus versions reject v2 backups rather than restoring only a subset.

Current manifests declare `formats.databaseView: 3`; earlier v2 view files remain readable in v3-aware Nodus builds. V1 backups containing a saved-view directory and v2 backups with unlisted saved-view files are rejected before restore so view data is not silently omitted.

Saved-view files participate in filesystem scanning and strict snapshots. Malformed, unsupported, misplaced, hidden, or symlinked view paths cause validation to fail; they are not silently skipped. Normalized path collisions and duplicate view IDs are rejected. No saved-view synchronization is implemented.

## UI and note mutations

The database browser can create, switch, rename, duplicate, save, reload, reset, and delete views. Table and List share the same sort conditions, AND filters, and visible-property configuration; these persist only after explicit Save view. The selected view ID is a best-effort local preference scoped to the vault and database. Switching dirty configurations requires confirmation. Stale writes retain settings and require an explicit reload; reloading discards the current settings draft after confirmation. Broken references are shown and block applying the view until explicitly repaired or reset; saved files are not automatically rewritten.

Kanban groups by Select option IDs plus Unassigned. Move card opens a keyboard-accessible property editor; moves are not optimistic and complete only after the typed-property API confirms them. Calendar uses date-only strings, a month grid, month navigation, Today, and an Undated section. Invalid projected dates remain undated with diagnostics; source metadata is never rewritten to make a calendar entry valid.

The existing `PUT /api/notes/:id/properties` also accepts `{ databaseId, propertyId, baseHash, remove: true }` to explicitly clear one property without deleting membership or unrelated metadata. Sending both `value` and `remove` is rejected. Existing malformed/unsupported namespaces still block mutation. Normal property writes retain their existing semantics and raw-hash protection.

Calendar creation is two explicit API operations: create a note, then assign its date with membership confirmation. This sequence is not atomic. A failed assignment keeps the note, reports the failure, and retains its ID/hash so retry cannot create a duplicate or blindly overwrite a changed note. Open the retained note to inspect a stale conflict. There is no automatic rollback or crash-recovery journal.

## Focused verification

`pnpm test:database-views` runs actual browser interaction tests against a dedicated strict loopback Vite process and temporary vault. It checks table persistence, board moves, value clearing, duplicate/rename/delete, dated creation, and stale-view draft handling. It requires Node 24+ and the installed Playwright Chromium browser. It has no screenshot or pixel assertions and cleans up its own process/browser/temporary vault.

## Relations and rollups

Relation filters use stable note IDs: `is` for a single relation and `includes` for multiple/reverse relations. Relation sorting uses current record titles, then stable row IDs for ties. Missing references remain filterable by their stored IDs. Rollups support numeric `equals`, `greater`, and `less` filters and numeric sorting; null/unavailable values sort last in either direction and do not match numeric filters.

Table, Kanban, and Calendar consume the same derived rows and filters. Cards display related-record links and rollups, with relation editing controls on forward fields. Kanban grouping remains Select-based and Calendar placement remains Date-based. Reverse relations and rollups cannot be used as writable grouping/date fields.
