# Nodus Note Format (version 1)

A Nodus note is a Markdown file with a YAML frontmatter block. The body is the source of truth for content. Nodus-owned metadata lives under the `nodus` key.

## Example

This is the canonical form of `test/fixtures/valid-note.md`. The tests parse it, and write it back byte-for-byte.

```markdown
---
title: Nodus roadmap
tags:
  - planning
  - phase-1
aliases:
  - Roadmap
nodus:
  version: 1
  id: 6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c
  createdAt: 2026-10-25T09:00:00Z
  updatedAt: 2026-10-25T10:30:00Z
---
# Nodus roadmap

Phase 1 covers the [[Data format]] and the [[a0d3c1f2-8e4b-4f6a-9c2d-7b1e5f3a9d88|pinned data-format note]].

```md
Inline example: [[Not a link inside a code fence]]
```

Inline code `[[Also not a link]]` stays literal.

Unicode stays as written: café, 日本語, 🙂.
```

## Frontmatter fields

| Field | Required | Type | Rule |
|---|---|---|---|
| `title` | yes | string | Non-empty, no leading or trailing whitespace, single line, not UUID-shaped. |
| `tags` | no | string array | Each entry non-empty and trimmed. Omitted when empty. |
| `aliases` | no | string array | Each entry non-empty and trimmed. Omitted when empty. |
| `nodus.version` | yes | integer | Must be `1`. |
| `nodus.id` | yes | string | Lowercase UUID v4. Never changes. |
| `nodus.createdAt` | yes | string | UTC timestamp, `YYYY-MM-DDTHH:MM:SSZ`, a real date. |
| `nodus.updatedAt` | yes | string | Same format as `createdAt`. |

Notes:
- The note path is **not** stored in frontmatter. It comes from the file location, so it cannot go stale when a file is moved.
- Timestamps are stored as data. Nodus does not read filesystem modification times.
- Timestamps have whole-second precision. Fractional seconds are rejected.

## Unknown fields

- Unknown top-level keys are kept in `extraFrontmatter`. They are written back after the Nodus-owned keys, in their original order.
- Unknown keys under `nodus` are an error (`INVALID_FRONTMATTER`). That namespace is versioned and owned by Nodus.
- User data is never silently dropped.

## Serialization

`serializeNote` produces canonical output:

1. `---` followed by a line feed.
2. Keys in this order: `title`, `tags` (if non-empty), `aliases` (if non-empty), `nodus` (`version`, `id`, `createdAt`, `updatedAt`), then `extraFrontmatter` keys.
3. YAML with LF line endings, no line folding.
4. `---` followed by a line feed.
5. The body, verbatim.

Canonical input round-trips byte-for-byte. Non-canonical input (for example, a different key order or `tags: []`) parses to the same values and is rewritten in canonical form.

## Parsing

- A UTF-8 byte order mark is removed on read and never written.
- The frontmatter opens with `---` on the first line and closes at the next line that is exactly `---`. CRLF is accepted for the delimiters.
- Frontmatter is parsed with the `yaml` package in the `core` schema. Duplicate keys, YAML aliases, anchors, and multi-document input are rejected.
- The body is kept byte-for-byte, including CRLF line endings, code fences, Unicode, and wiki links. The body is never parsed as Markdown.

## Errors

| Code | When |
|---|---|
| `INVALID_FRONTMATTER` | Missing or unclosed frontmatter, malformed or unsafe YAML, frontmatter that is not a mapping, unknown key under `nodus`. |
| `INVALID_FIELD` | Missing required field, wrong type, invalid UUID, invalid or non-UTC timestamp, invalid `nodus.version`. |
| `UNSUPPORTED_VERSION` | `nodus.version` is greater than `1`. Nothing is parsed further or rewritten. |
| `UNSAFE_PATH` | The note path fails the rules under "Stable IDs and paths" below. |
| `MIGRATION_FAILED` | A migration step threw a non-Nodus error. See "Migration contract" below. |

## Stable IDs and paths

- **ID:** Supplied once by the caller and passed to `createNote`. Nodus validates it but does not generate it. Titles and paths are never used as identity. An ID must be unique within a vault; that check belongs to the vault/storage layer, because a single note cannot see its siblings.
- **Path:** Workspace-relative, `/`-separated, ends in `.md`. Rejected when:
  - it is empty, absolute, or starts with `/`;
  - it contains a backslash, a colon (drive letters and alternate streams), or a control character;
  - any segment is empty, `.`, or `..`, or ends in a space or dot;
  - any segment's base name is a reserved Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`), with or without an extension;
  - the file name is only `.md`, or does not end in `.md`;
  - it is longer than 260 characters.

## ID generation boundary

Nodus validates note IDs but does not create them. `createNote` takes a caller-supplied `id`. Generating IDs (for example with `crypto.randomUUID()`) belongs to a higher-level layer, such as the future storage or editor layer. The domain and format packages contain no crypto globals and no ID-generation dependency.

## Versioning

- `nodus.version` is an integer. Version `1` is the only version defined.
- Missing, non-integer, or lower values are `INVALID_FIELD`.
- Higher values are `UNSUPPORTED_VERSION`.

## Migration contract

No migrations exist, because version 1 is the only version. The contract is implemented by `applyMigration`; no migration engine, chain, or file access is included.

```ts
interface Migration<TFrom, TTo> {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(data: TFrom): TTo;
}
```

Rules enforced by `applyMigration`:

- `fromVersion` and `toVersion` are positive integers, and `toVersion` must be exactly `fromVersion + 1`. A skipped or backwards step is `INVALID_FIELD`.
- `migrate` must be a function.
- A step that throws a `NodusError` keeps its code.
- A step that throws anything else becomes `MIGRATION_FAILED`, with the original error available as `cause`.
- Nothing is returned when a step fails, so partial output cannot be used.

Rules for migration authors:

- A migration is a pure function from the parsed data of version N to the data of version N+1. It must not modify its input.
- It does not read or write files. It does not decide which step to run; the caller selects it.
- No field is dropped. Fields the new version does not define are kept in `extraFrontmatter` or reported as an error.
- Migration code is added only when a real older file must be read.

## Limitations

- Plain Markdown files without frontmatter are rejected, not imported. They have no ID.
- Frontmatter is rewritten in canonical form on save, so comments and formatting inside the frontmatter block are not preserved. Only the values are.
- JavaScript object key order is used for `extraFrontmatter`, so integer-like keys (for example `2024:`) may move ahead of other keys on write.
- Empty `tags` and `aliases` are omitted on write.
- Tags and aliases keep their order and are not de-duplicated.
