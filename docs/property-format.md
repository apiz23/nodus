# Nodus Note Property Catalog (version 1)

The general note property catalog is a vault-wide, independently versioned definition of typed YAML fields. Its canonical location is `properties/catalog.json`. Nodus reads it directly from the active vault and creates it only when the first definition is saved. A missing catalog is an empty catalog and is not written by reads. Catalog format versioning is independent of note-format version 1.

The catalog is separate from database schemas. Database rows continue to use their existing `nodus_data` namespace and format.

## Example

```json
{
  "format": "nodus-property-catalog",
  "version": 1,
  "properties": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "key": "status",
      "name": "Status",
      "type": "select",
      "options": [
        {
          "id": "22222222-2222-4222-8222-222222222222",
          "label": "In progress"
        }
      ]
    }
  ]
}
```

The stable property `id` is used by future Nodus views. `key` is the stable top-level YAML key and remains unchanged when `name` changes. Property keys are lowercase ASCII identifiers containing letters, digits, hyphens, and underscores, starting with a letter, and are limited to 64 characters. Nodus-owned keys (`title`, `tags`, `aliases`, `nodus`, `nodus_data`, and `icon`), YAML null/boolean scalars, and prototype-sensitive names are reserved.

Property IDs and option IDs are lowercase UUID v4 values and must be unique in the catalog. YAML keys and display names must also be unique (display names compare after Unicode NFC normalization and case folding). Only `select` and `multi-select` definitions have an `options` array; an empty options array is allowed while a property is being configured. Unknown fields are rejected in version 1. A future version is rejected with `UNSUPPORTED_VERSION`; readers must not guess or rewrite an unsupported catalog.

## Types and note values

Values are ordinary top-level YAML fields in a Nodus-formatted Markdown note. For example:

```yaml
status: In progress
estimate: 3
reviewed: false
due: 2026-10-30
topics:
  - research
  - design
homepage: https://example.com
```

| Type | YAML value | Rules |
|---|---|---|
| `text` | String | Empty string is valid and distinct from a missing key. |
| `number` | Number | Must be finite; strings are not converted. |
| `checkbox` | Boolean | `false` is a valid, explicit value. |
| `date` | String | Must be a real calendar date in `YYYY-MM-DD` form. |
| `select` | String | Must match a current or retained option label. |
| `multi-select` | Array of strings | Every value must match an option; duplicate labels are invalid. An empty array is valid and distinct from a missing key. |
| `url` | String | Must be an absolute HTTP or HTTPS URL. Other protocols are rejected. |

An absent key means **unset**. `null` is not a valid property value. No values are coerced between YAML types. Invalid values stay in note frontmatter and produce a validation diagnostic; validation never removes or rewrites them. An unregistered custom key remains unknown frontmatter and is reported separately from invalid registered properties.

Select values are stored as readable option labels rather than UUIDs. Each option still has a stable ID in the catalog. When a label changes, the previous label is retained in that option's `aliases`, so existing YAML values remain valid and unchanged. The note editor shows the current label while preserving an older stored label until the user explicitly edits that note. Search and filters resolve a retained alias to the same option as the current label. Labels and aliases must remain unique within each property's option list.

## Compatibility

The catalog does not change note-format version 1. It does not cause existing custom frontmatter to be adopted automatically. A catalog property may reference an existing YAML key; validation projects its value without modifying the note, its body, or its identity.

Nodus continues to parse metadata only from its existing valid frontmatter structure. YAML-looking Markdown without a valid Nodus `nodus` block remains ordinary Markdown body text. Unknown custom frontmatter—including nested mappings and arrays—and the existing `tags`, `aliases`, `nodus` identity/timestamps, `icon`, and `nodus_data` values remain governed by the current note-format contract.

Top-level `tags` and `aliases` remain separate note-format fields; neither is a property-catalog entry. Tag normalization and legacy-tag handling are documented in [the note format](note-format.md#unknown-fields).

Catalog serialization is canonical JSON with properties ordered by YAML key and options by stable ID. It has a trailing newline. Nodus validates the complete catalog before persisting a definition change. Malformed and unsupported catalogs are read errors and are never replaced implicitly. A catalog update uses the SHA-256 hash returned by the read API as `baseHash`; stale updates return a conflict with the current hash when one exists. Missing-file creation uses `baseHash: null`. Updates are serialized under the vault write lock and use atomic file replacement. The catalog path and its parent are checked for symlinks and conflicting file types. Existing non-empty `properties/` folders are not claimed for catalog creation.

Definition changes are explicit operations. Renaming a display name does not change its stable ID or YAML key. Renaming an option keeps its old label as an alias. Removing an option requires `confirmUnregisterValues: true`; existing YAML values are preserved and may then be diagnosed as invalid. Deleting a property also requires this confirmation and leaves its YAML values untouched as unregistered custom frontmatter. Nodus does not scan the whole vault to decide whether a key is in use.

An API note-property write targets one registered property by stable property ID and one note by stable note ID. It requires the note's current raw-content hash as `baseHash`, validates the value against the current catalog, and updates only that top-level YAML key plus the note's `updatedAt`. Other frontmatter and the Markdown body are preserved by the existing note parser/serializer. `unset: true` removes the key; setting a value is a separate request, so `false`, `""`, and `[]` remain explicit values. Stale note writes return `STALE_WRITE` and do not change the file. Invalid values return a validation error without writing.

The note editor includes a collapsible Properties section. It displays registered values, lets a user add an unset definition to the note, and supports explicit unset independently from setting `false`, an empty string, or an empty list. Unregistered frontmatter is never listed as an editable property. Text, number, date, and URL values are staged and saved explicitly; checkbox, select, and multi-select changes use their typed controls. URLs are linked only when they parse as absolute HTTP or HTTPS URLs.

Property definitions are managed in a focused dialog. Creating a definition assigns a new stable property ID and YAML key; later display-name changes do not change either. Select and multi-select options have stable IDs. Option-label renames keep the previous label as an alias, while option removal requires explicit confirmation and leaves existing note values untouched (they may become invalid). Deleting a definition also requires confirmation and leaves its YAML values in place as unregistered frontmatter. A stale catalog revision is not retried automatically: reload the catalog before applying the change again.

Property writes are disabled while the active note has an unsaved title/body draft, an in-progress save, an unresolved conflict, or a detected external change. If typing starts while a property write is already pending, Nodus retains the draft and advances its base hash only from the successful response for the same note. A stale response after navigation is ignored. Failed edits retain their input so they can be corrected or retried.

Backup/restore and portable export/import include the catalog and preserve its exact bytes, stable property and option IDs, YAML keys, option labels and aliases, format version, and unknown note frontmatter. Backups record the catalog hash and byte length in the manifest. Restore validates the catalog before writing and writes it before note content; an interrupted restore can leave a reported `PARTIAL_WRITE`, which must be inspected before retrying. A legacy source without a catalog is restored with an empty/default catalog and does not clear an existing destination catalog. Malformed catalogs are rejected; a newer catalog version returns `UNSUPPORTED_VERSION` rather than being guessed or omitted. Search and filtering are rebuilt from the restored Markdown and catalog, so stale derived metadata is not retained. Invalid registered values and unregistered custom fields remain in note frontmatter and are diagnosed, never deleted.
