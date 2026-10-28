# ADR: Portable note properties for structured databases

- **Status:** Accepted; Milestones 1 and 2 (format, storage/API projection, and explicit property update) are implemented. The database browser displays and edits supported typed properties, explicitly adds note membership, and supports schema creation plus additive/rename edits with stable IDs. Saved Table, Kanban, and Calendar views use a separate portable format. Property/option deletion, relations, and graph UI remain unimplemented.
- **Date:** 2026-10-28

## Context

Nodus database files currently define schemas only (`nodus-database` version 1). Notes are the content source of truth. Their optional YAML frontmatter preserves unknown top-level keys as `extraFrontmatter`; Nodus-owned `nodus` keys remain strict and versioned. Backup, restore, import, and export already carry Markdown note files. Database definitions reject unknown keys and unsupported future versions.

The implementation must add typed values without changing existing note-format v1 parsing, losing data when an older Nodus reads a note, or making a derived index authoritative.

## Decision

Store database membership and property values in one namespaced top-level YAML extension on the note. The proposed key and payload are:

```yaml
nodus_data:
  format: nodus-note-properties
  version: 1
  databases:
    <database-uuid>:
      <property-uuid>: <typed-value>
```

- UUID keys refer to the stable database and property IDs; select values refer to stable option IDs, never display names.
- `format` must equal `nodus-note-properties`; `version` must be a positive integer. Version 1 recognizes only `format`, `version`, and `databases`. A newer integer version is reported as `UNSUPPORTED_NAMESPACE_VERSION` and is not interpreted. A missing/invalid version, wrong format, malformed UUID key, unknown version-1 key, or invalid container shape is reported as `INVALID_NAMESPACE`.
- Presence of a database entry means the note is a row in that database. The entry may be empty. A note may belong to more than one database. An absent property key means no value; `null` is not a value.
- Supported values: `text` is a string; `number` is a finite number; `checkbox` is a boolean; `date` is a valid `YYYY-MM-DD` calendar date; `select` is one option UUID; `multi-select` is an array of distinct option UUIDs. Non-option values are rejected by schema-aware validation.
- The payload uses JSON-compatible YAML values only: strings, finite numbers, booleans, arrays, and string-keyed mappings. YAML aliases, custom tags, and non-finite numbers are not part of this extension.
- The payload is an opaque note-format v1 top-level extension, not a change to the existing `nodus` namespace or its version. Existing notes without `nodus_data` remain unchanged. An explicit action that adds values to a plain Markdown note may add Nodus frontmatter to persist its identity and values; it must preserve the Markdown body and stable path-derived ID as the stored `nodus.id`.
- No database row value is copied into a cache or index as an authoritative record. Any query projection is derived from note files and can be rebuilt.

## Compatibility and preservation

Existing note-format v1 semantics stay intact: `nodus.version` remains 1, current frontmatter validation is unchanged, and unknown top-level keys continue to be preserved by parse/serialize. Older Nodus versions do not understand `nodus_data`; they parse it as `extraFrontmatter`, do not schema-validate it, and should preserve its YAML value on ordinary saves. The guarantee is semantic YAML-value preservation, not byte-for-byte preservation of frontmatter formatting: `serializeNote` canonicalizes frontmatter while keeping the body verbatim. The implementation must test legacy-reader round trips and document that older versions do not validate or display the extension. This is not a promise about third-party editors that remove unknown frontmatter.

The compatibility-policy exception is accepted: opaque, independently versioned top-level namespaces may be preserved but ignored by older Nodus readers when their payload stays within the existing core-YAML subset. This is documented in the README and note-format guide. It does not change note-format v1 parsing or `nodus.version`; unknown keys under `nodus` and unknown database-definition keys remain errors.

Because the extension is inside Markdown, existing byte-preserving backup/import/restore and export carry it with the note without a new storage path or backup manifest kind. Tests must verify the payload survives those paths and a Nodus-managed note move. Normal body-only saves must retain the extension and unknown frontmatter. No automatic migration or rewrite of existing notes is performed.

Database definitions remain version 1 for properties. The subsequent saved-view decision keeps view configuration outside schema files, in independently versioned `database-views/<database-id>/<view-id>.json` files; see [Saved database views](database-views.md). Schema v1 therefore remains unchanged. A future extension inside database definitions still requires a new schema version, rejected by older readers with `UNSUPPORTED_VERSION`.

## Invalid and orphaned data

Structured-data validation is a projection separate from `parseNote` and `StorageHealth`: it must not make an otherwise readable Markdown body disappear or be rewritten. The projection returns issues with note ID/path, database ID when available, property ID when available, a stable code, and a readable message. Use these stable codes: `INVALID_NAMESPACE`, `UNSUPPORTED_NAMESPACE_VERSION`, `MISSING_DATABASE`, `MISSING_PROPERTY`, `TYPE_MISMATCH`, `INVALID_VALUE`, and `MISSING_OPTION`. An invalid namespace or future namespace version is a note-level diagnostic; a missing database/property/option or invalid typed value is associated with its row/cell. A vault-wide structured-data diagnostics list must surface missing-schema values that have no database view in which to appear.

A future namespace version is opaque: do not validate its members, edit structured values, or replace it with a version-1 empty payload. Existing note parse/serialize may canonicalize YAML formatting but must retain its parsed subtree semantically. Schema-aware projection separately reports values whose database or property no longer exists, whose type no longer matches, or whose select option was removed.

Missing/deleted schemas, properties, and options never cause automatic value deletion. The original YAML value remains in the note and is shown as unresolved/read-only until the user explicitly repairs or removes it. Type mismatch, invalid date, non-finite/incorrect scalar, duplicate or unknown select option IDs, and invalid multi-select values are diagnosed and kept unchanged; property editing is blocked for the affected value rather than replacing it with an empty value. Schema deletion therefore does not cascade to notes. Ordinary body/title/icon saves may proceed only if they preserve the complete `nodus_data` subtree; structured-data edits are blocked while its namespace version is unsupported or its values are invalid.

An explicit **Add to database** or property-edit action is the only operation allowed to add `nodus_data` to a note. The normal editor save and icon picker do not add database membership. For plain Markdown, this explicit action may add Nodus frontmatter and persist the current path-derived ID as `nodus.id`; the body must remain verbatim. Canceling the action writes nothing.

## Storage/API integration (Milestone 2)

The local API exposes `GET /api/notes/:id/properties` as a read-only projection. It returns the note ID, vault-relative path, raw-content hash, schema-valid database rows, and structured-data diagnostics. Projection diagnostics do not make the Markdown note unreadable and do not mutate its frontmatter.

`PUT /api/notes/:id/properties` accepts one `databaseId`, one `propertyId`, a JSON-compatible `value`, and the note's current `baseHash`. It updates only that property and uses the vault's conditional atomic note replacement; a stale hash returns HTTP 409 without writing. Validation issues return HTTP 422 with `structuredDataIssues`. Missing schemas/properties/options, invalid existing values, malformed namespaces, and unsupported namespace versions block the mutation and remain unchanged. The API does not accept a replacement `nodus_data` object and does not provide value deletion in this milestone.

Creating `nodus_data` or adding database membership requires `confirmCreate: true`. Without it, the operation returns HTTP 409 `CONFIRMATION_REQUIRED` and writes nothing. This explicit confirmation also applies when adding a new database membership to a note that already has structured metadata. Ordinary note title/body/icon saves do not create membership or change the semantic value of `nodus_data`; canonical serialization may rewrite frontmatter formatting as already documented.

The note write is guarded by the current raw-byte hash and serialized by the existing per-root vault lock. This protects Nodus-cooperating writers from in-process and coordinated cross-process stale writes; external editors that do not use the lock are outside that guarantee. Schema files are read for projection before the note write and are not locked as one atomic snapshot with the note. If a schema changes concurrently, the stored stable IDs and values remain in Markdown and a later projection reports any resulting orphan; no schema deletion cascades to note values.

## Scope boundaries

This decision covers the portable value envelope and preservation contract. It does not define relations, formulas, rollups, automations, data migrations, saved-search persistence, synchronization changes, or automatic cleanup. Saved searches require a separate decision about browser-local versus portable per-vault storage.

## Consequences and required proof

- Markdown remains the source of truth; JSON definitions remain portable schema files.
- One note can be a row in multiple databases, avoiding a second row identity and keeping row identity equal to note identity.
- Old Nodus versions may display no structured values, but should preserve them as unknown frontmatter. This limitation must be visible in docs and covered by compatibility tests.
- Current source evidence: `parseNote` places unknown top-level YAML keys in `extraFrontmatter` (`src/format/note-format.ts`); `serializeNote` writes them back, while canonicalizing frontmatter. `projectNoteProperties` in `src/database/note-properties.ts` is a pure projection against parsed schema definitions and returns structured diagnostics without modifying note metadata. The local save path spreads the current note and its extras before applying an optional icon (`src/ui-server/api.ts`); `applyPageIcon` shallow-copies extras (`src/ui-server/page-icon.ts`). A Nodus-format move writes original note text (`src/storage/fs/vault.ts`). Snapshots retain raw bytes/text; export writes snapshot text; import plans retain source text and apply it; backup/restore retain and validate raw file bytes (`src/storage/fs/vault.ts`, `src/storage/portable/export.ts`, `src/storage/portable/import.ts`, `src/storage/backup/backup.ts`).
- Existing generic tests prove unknown-frontmatter serialization (`test/note-format.test.ts`), UI save/icon preservation (`test/ui-api.test.ts`), exact-byte moves (`test/storage-vault.test.ts`), and note preservation through export/import and backup/restore (`test/storage-portable.test.ts`, `test/storage-backup.test.ts`). `test/note-properties.test.ts` adds namespace-specific pure projection, valid round-trip, legacy/plain-note, invalid-value, missing-schema, missing-property, missing-option, and unsupported-version coverage.
- Storage/API-specific tests now exercise projected rows/diagnostics, ordinary body/title/icon saves, targeted conditional updates, explicit metadata creation, validation failures, stale hashes, and injected write failures (`test/ui-api.test.ts`). Existing storage tests cover exact-byte moves and import/export/backup/restore; those paths transport Markdown bytes and do not interpret `nodus_data`.
- Invalid values must remain readable and unchanged until explicit repair. Unsupported namespace versions must produce a diagnostic, remain opaque, and block structured edits. No test should expect a frontmatter-formatting byte identity after an ordinary serializer write; byte identity is required for the existing raw-copy paths.
