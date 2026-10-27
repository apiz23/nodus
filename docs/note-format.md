# Nodus Note Format (version 1)

A Markdown file is a note whether or not it has YAML frontmatter. When Nodus frontmatter is present, its body is the source of truth for content and Nodus-owned metadata lives under the `nodus` key. Plain files remain plain during ordinary body edits.

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

- Nodus frontmatter opens with `---` on the first line, closes at the next line that is exactly `---`, and contains a `nodus` mapping. CRLF is accepted for delimiters.
- A delimiter-led block without valid Nodus metadata is treated as ordinary Markdown and retained as body. Malformed YAML that declares `nodus` is reported as an error; no metadata is silently removed.
- Nodus frontmatter is parsed with the `yaml` package in the `core` schema. Duplicate keys, YAML aliases, anchors, and multi-document input are rejected.
- The body is kept verbatim, including CRLF line endings, code fences, Unicode, and wiki links. The body is never parsed as Markdown. A plain file is saved as its body without Nodus metadata while it keeps its filename-derived title; explicitly changing the title or metadata, or moving the file, writes Nodus frontmatter.
- For a plain file, the title comes from its filename and its stable synthetic UUID-shaped ID is derived from its vault-relative path. Editing content does not change the ID; moving the file through Nodus writes frontmatter to preserve it. Manually moving a plain file changes its path-derived ID. Internal timestamps use the date in a `YYYY-MM-DD.md` filename when valid, otherwise a fixed placeholder; they are not written into plain files.

## Errors

| Code | When |
|---|---|
| `INVALID_FRONTMATTER` | Malformed Nodus YAML, unknown key under `nodus`, or an unclosed block that declares Nodus metadata. |
| `INVALID_FIELD` | Missing required field, wrong type, invalid UUID, invalid or non-UTC timestamp, invalid `nodus.version`. |
| `UNSUPPORTED_VERSION` | `nodus.version` is greater than `1`. Nothing is parsed further or rewritten. |
| `UNSAFE_PATH` | The note path fails the rules under "Stable IDs and paths" below. |
| `MIGRATION_FAILED` | A migration step threw a non-Nodus error. See "Migration contract" below. |

## Stable IDs and paths

- **ID:** For Nodus-format notes, supplied once by the caller and stored in frontmatter. For plain Markdown, deterministically derived from the vault-relative path because there is no stored identity. An ID must be unique within a vault; that check belongs to the vault/storage layer, because a single note cannot see its siblings.
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

- Frontmatter is rewritten in canonical form on save, so comments and formatting inside the frontmatter block are not preserved. Only the values are.
- Plain Markdown body saves do not add frontmatter. A title/metadata edit or a Nodus-managed move does add it so those changes and the note ID can be persisted.
- JavaScript object key order is used for `extraFrontmatter`, so integer-like keys (for example `2024:`) may move ahead of other keys on write.
- Empty `tags` and `aliases` are omitted on write.
- Tags and aliases keep their order and are not de-duplicated.
