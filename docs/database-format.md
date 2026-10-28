# Nodus Database Definition Format (version 1)

A database definition is a separate, versioned JSON file. It describes a database's properties and select options. It does not contain rows, query logic, or view configuration. Saved views use a separate versioned format; see [Saved database view format](database-views.md). Database schema v1 is unchanged.

## Example

Abbreviated. The full file, covering all six property types, is `test/fixtures/database-valid.json`.

```json
{
  "format": "nodus-database",
  "version": 1,
  "id": "9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73",
  "name": "Reading list",
  "properties": [
    {
      "id": "1f0c7d2a-0b1e-4c3d-9a8f-5e6d7c8b9a01",
      "name": "Title",
      "type": "text"
    },
    {
      "id": "4c3fa05d-3e4b-4f6a-8d1c-8b9a0f1e2d34",
      "name": "Status",
      "type": "select",
      "options": [
        {
          "id": "5d40b16e-4f5c-4a7b-9e2d-9c0a1b2f3e45",
          "name": "To read"
        }
      ]
    }
  ]
}
```

## Top-level fields

| Field | Required | Rule |
|---|---|---|
| `format` | yes | Must be `"nodus-database"`. |
| `version` | yes | Integer. Must be `1`. |
| `id` | yes | Lowercase UUID v4. |
| `name` | yes | Non-empty, no leading or trailing whitespace. |
| `properties` | yes | Array. May be empty. |

No other top-level keys are allowed.

## Properties

| Field | Required | Rule |
|---|---|---|
| `id` | yes | Lowercase UUID v4, unique within the database. |
| `name` | yes | Non-empty, no leading or trailing whitespace. Unique within the database, case-insensitively. |
| `type` | yes | One of `text`, `number`, `checkbox`, `date`, `select`, `multi-select`. |
| `options` | select and multi-select only | Array of options. Required for those two types. Forbidden for all others. |

No other property keys are allowed.

## Select options

| Field | Required | Rule |
|---|---|---|
| `id` | yes | Lowercase UUID v4, unique within its property. |
| `name` | yes | Non-empty, no leading or trailing whitespace. Unique within its property, case-sensitively. |

No other option keys are allowed.

## Errors

| Code | When |
|---|---|
| `INVALID_DATABASE` | Invalid JSON, wrong `format`, wrong types or shapes, invalid IDs, blank names, duplicate IDs or names, unknown or unsupported property type, options on a non-select type, a missing `options` array on a select type, unknown keys (including any view or formula configuration). |
| `INVALID_FIELD` | `version` missing, non-integer, or less than 1. |
| `UNSUPPORTED_VERSION` | `version` is greater than `1`. |

## Serialization

`serializeDatabase` writes fields in the order shown in the example, with two-space indentation and a trailing line feed. It validates the result before returning it, so an invalid definition is never written.

## Not implemented in Phase 1

These are deferred. Their validation rules are not defined yet, so the parser rejects them rather than guessing:

- Relation properties. The `relation` type is rejected as unsupported.
- Table or other view definitions. Unknown keys such as `views` are rejected.
- Filters, sorting, formulas, rollups, and automations.
- Database rows.
- Query execution.

## Export and migration

- The file is plain JSON. It can be read or exported with any JSON tool.
- Versioning follows the compatibility policy in the README. Version 2 is rejected with `UNSUPPORTED_VERSION`.
- No migrations exist. The migration contract in [note-format.md](note-format.md#migration-contract) applies to this format as well.

## Current schema editor

The UI can create a version 1 schema, add properties, rename schemas and properties, add select/multi-select options, and rename existing options. Existing property and option IDs are retained. Property types are selected when a property is created and are read-only afterward; property and option removal are not offered, so existing note values are not orphaned by these UI actions. Schema writes are validated by the same version 1 parser/serializer and use a raw-file SHA-256 precondition. Unsupported or malformed on-disk schema files cannot be edited through the UI or replacement API; they are rejected without rewriting the file. No schema edit rewrites note Markdown or property values.

## Decisions

- `options` may be an empty array for select and multi-select, so a property can be defined before its options are configured. Current note values live in the note's `nodus_data` frontmatter; select and multi-select values refer to these stable option IDs.
- Property names are unique within the database, case-insensitively, after Unicode NFC normalization, as required by the approved plan.
- Option names are unique within their property, also after NFC normalization, but the comparison is **case-sensitive**: `Open` and `open` are distinct. The approved plan requires uniqueness without specifying case, so exact match is used.
- IDs must be unique across a vault, not just within one file. The vault/storage layer owns that check.
