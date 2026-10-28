# Saved database views (version 2; legacy version 1 supported)

Saved views are portable JSON files separate from database schema v1 and note frontmatter. They are query/presentation preferences only; Markdown notes remain the source of property values.

Files live at `database-views/<database-id>/<view-id>.json`:

```json
{
  "format": "nodus-database-view",
  "version": 2,
  "id": "665f1175-2b7a-4a21-9b2d-657bb79fa9a1",
  "databaseId": "9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73",
  "name": "Ready to read",
  "type": "table",
  "settings": {},
  "sort": { "propertyId": "title", "direction": "asc" },
  "filters": [],
  "visiblePropertyIds": []
}
```

The title column is fixed and cannot be hidden. Sort uses `title` or a stable property UUID; filters use property UUIDs and stable select-option UUIDs, never labels. Filters are combined with AND. Supported operators match the property type: text `contains`/`equals`; number `equals`/`greater`/`less`; checkbox `is`; date `equals`/`before`/`after`; select `is`; multi-select `includes`. Values are validated against the referenced type, and dates must be real `YYYY-MM-DD` calendar dates. The parser rejects unknown fields, duplicate filter/property IDs, invalid values, malformed JSON, and unsupported future versions.

`type` is `table`, `kanban`, or `calendar`. Table settings are `{}`; the shared `visiblePropertyIds` list supplies its columns in order and the property previews on other views. Kanban settings are `{ "groupPropertyId": "<select-property-uuid>" }`; Calendar settings are `{ "datePropertyId": "<date-property-uuid>" }`. Other setting fields are rejected. New views default to title ascending, no filters, all properties visible, and the first compatible grouping/date property. Creation of a Kanban/Calendar view requires a compatible property.

Version 1 has neither `type` nor `settings` and is interpreted as a table. Existing files are not migrated on reads, backup, export, import, or restore. An explicit UI save writes v2. Older readers must reject v2 view files; database schema v1 and note-format v1 are unchanged.

The storage/API layer reports missing database, property, or option references as diagnostics without rewriting or deleting the file. Explicit create/update operations require currently valid references and use raw-byte SHA-256 base hashes; an update also verifies the schema revision while holding the vault root lock. Deletion is explicit and conditional. Removing a database does not cascade-delete its saved-view files.

`GET /api/databases/:databaseId/views` returns `{ databaseId, schemaHash?, views }`, each with `view`, `path`, `contentHash`, and `diagnostics`. `POST` to that path accepts `{ view }`; `PUT /api/databases/:databaseId/views/:viewId` accepts `{ view, baseHash }`; `DELETE` at that item path accepts `{ baseHash }`. Unsupported/malformed view payloads are rejected. Stale writes return HTTP 409 `STALE_WRITE`; invalid schema references return 422 `INVALID_VIEW_REFERENCES`.

`GET` at the item path reads one view. `POST /api/databases/:databaseId/views/:viewId/duplicate` accepts `{ id, name, baseHash }`; it verifies the source revision and creates a distinct ID while holding the root lock. Duplication copies saved settings rather than unsaved UI drafts.

Portable vault export/import copies these files in their reserved tree. Backup writers emit manifest v2, including saved-view entries and counts. The reader continues to accept legacy v1 backups, which contain no saved views, and explicitly rejects future manifest versions. Older Nodus versions reject v2 backups rather than restoring only a subset.

Current manifests declare `formats.databaseView: 2`; previous v2 manifests declaring view format 1 remain readable. V1 backups containing a saved-view directory and v2 backups with unlisted saved-view files are rejected before restore so view data is not silently omitted.

Saved-view files participate in filesystem scanning and strict snapshots. Malformed, unsupported, misplaced, hidden, or symlinked view paths cause validation to fail; they are not silently skipped. Normalized path collisions and duplicate view IDs are rejected. No saved-view synchronization is implemented.

## UI and note mutations

The database browser can create, switch, rename, duplicate, save, reload, reset, and delete views. Sorting, AND filters, and visible columns persist only after explicit Save view. The selected view ID is a best-effort local preference scoped to the vault and database. Switching dirty configurations requires confirmation. Stale writes retain settings and require an explicit reload; reloading discards the current settings draft after confirmation. Broken references are shown and block applying the view until explicitly repaired or reset; saved files are not automatically rewritten.

Kanban groups by Select option IDs plus Unassigned. Move card opens a keyboard-accessible property editor; moves are not optimistic and complete only after the typed-property API confirms them. Calendar uses date-only strings, a month grid, month navigation, Today, and an Undated section. Invalid projected dates remain undated with diagnostics; source metadata is never rewritten to make a calendar entry valid.

The existing `PUT /api/notes/:id/properties` also accepts `{ databaseId, propertyId, baseHash, remove: true }` to explicitly clear one property without deleting membership or unrelated metadata. Sending both `value` and `remove` is rejected. Existing malformed/unsupported namespaces still block mutation. Normal property writes retain their existing semantics and raw-hash protection.

Calendar creation is two explicit API operations: create a note, then assign its date with membership confirmation. This sequence is not atomic. A failed assignment keeps the note, reports the failure, and retains its ID/hash so retry cannot create a duplicate or blindly overwrite a changed note. Open the retained note to inspect a stale conflict. There is no automatic rollback or crash-recovery journal.

## Focused verification

`pnpm test:database-views` runs actual browser interaction tests against a dedicated strict loopback Vite process and temporary vault. It checks table persistence, board moves, value clearing, duplicate/rename/delete, dated creation, and stale-view draft handling. It requires Node 24+ and the installed Playwright Chromium browser. It has no screenshot or pixel assertions and cleans up its own process/browser/temporary vault.
