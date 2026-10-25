# Nodus Phase 1: Domain Model and Portable Data Format (Plan Only)

**Status:** Plan only. No code, configuration, or dependencies were created.

**Inspection:** The working directory `C:\Users\Hafizuddin\Desktop\Developer\nodus` was empty and is not a git repo at the time of planning. This plan is repository-independent. No target repository has been approved.

**Naming:** The project is **Nodus** throughout. This covers the npm package (`nodus`), the frontmatter namespace (`nodus:`), the database format id (`nodus-database`), and error codes.

---

## 1. Architecture Proposal

A single small TypeScript library with no UI, framework, or I/O in the domain code. Phase 1 is a pure core plus a thin text-in/text-out format layer.

```
text  <->  format/    <->  domain/    (pure types, validation, IDs, paths)
                      <->  links/     (pure wiki-link scan + resolve)
                      <->  database/  (pure schema parse/serialize/validate)
```

Principles:
- Domain functions take strings and objects and return strings and objects. They never touch the filesystem, browser, or network.
- Errors are thrown as one `NodusError` class with a small set of codes.
- Notes are Markdown files. Nodus reads and writes text. Storage backends come later.
- Only the format is versioned now. There is no migration system.

---

## 2. Illustrative TypeScript Entities

```ts
// domain/note.ts
export type NoteId = string; // lowercase UUID v4, generated with crypto.randomUUID()

export interface Note {
  id: NoteId;
  title: string;                 // required, trimmed, non-empty, not UUID-shaped
  path: string;                  // workspace-relative POSIX path, from file location (NOT stored in frontmatter)
  body: string;                  // Markdown after the frontmatter block, stored verbatim
  createdAt: string;             // RFC 3339 UTC, e.g. "2026-10-25T09:00:00Z"
  updatedAt: string;
  tags: string[];                // optional, default []
  aliases: string[];             // optional, default []
  extraFrontmatter: Record<string, unknown>; // unknown top-level keys, preserved on write
}
```

```ts
// domain/errors.ts
export type NodusErrorCode =
  | 'INVALID_FRONTMATTER'   // missing/unclosed block, YAML syntax error, unknown key under nodus
  | 'INVALID_FIELD'         // missing required field, wrong type, bad timestamp, bad id
  | 'UNSUPPORTED_VERSION'   // version is higher than this Nodus supports
  | 'UNSAFE_PATH'           // absolute, traversal, backslash, reserved name, etc.
  | 'INVALID_DATABASE';     // database definition failed validation

export class NodusError extends Error {
  constructor(public code: NodusErrorCode, message: string) { super(message); }
}
```

```ts
// links/wikilink.ts
export interface WikiLink {
  raw: string;        // exact original text, e.g. "[[Roadmap|plan]]"
  target: string;     // "Roadmap" or a UUID
  display?: string;   // text after "|", if present
  start: number;      // offset in body
  end: number;
}

export type LinkResolution =
  | { status: 'resolved'; noteId: NoteId }
  | { status: 'unresolved' }
  | { status: 'ambiguous'; noteIds: NoteId[] };
```

```ts
// database/schema.ts
export type PropertyType = 'text' | 'number' | 'checkbox' | 'date' | 'select' | 'multi-select';

export interface SelectOption { id: string; name: string }

export interface Property {
  id: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];   // required for select/multi-select, forbidden otherwise
}

export interface DatabaseDefinition {
  id: string;                 // UUID
  name: string;
  properties: Property[];
}
```

---

## 3. Example Note

File: `notes/roadmap.md`

```markdown
---
title: Nodus roadmap
tags:
  - planning
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

Unicode stays as written: café, 日本語, 🙂.
```

`path` is not in the frontmatter. It comes from the file's location. This avoids a second copy that could go stale when a file is moved.

---

## 4. Example Database Schema File

File: `databases/reading-list.json`

```json
{
  "format": "nodus-database",
  "version": 1,
  "id": "9b2e4f10-5a3c-4d7e-8f1b-2c6d9e0a4b73",
  "name": "Reading list",
  "properties": [
    { "id": "1f0c7d2a-0b1e-4c3d-9a8f-5e6d7c8b9a01", "name": "Title", "type": "text" },
    { "id": "2a1d8e3b-1c2f-4d4e-8b9a-6f7e8d9c0b12", "name": "Pages", "type": "number" },
    { "id": "3b2e9f4c-2d3a-4e5f-9c0b-7a8f9e0d1c23", "name": "Read", "type": "checkbox" },
    {
      "id": "4c3fa05d-3e4b-4f6a-8d1c-8b9a0f1e2d34",
      "name": "Status",
      "type": "select",
      "options": [
        { "id": "5d40b16e-4f5c-4a7b-9e2d-9c0a1b2f3e45", "name": "To read" },
        { "id": "6e51c27f-5a6d-4b8c-8f3e-0d1b2c3a4f56", "name": "Reading" },
        { "id": "7f62d380-6b7e-4c9d-9a4f-1e2c3d4b5a67", "name": "Done" }
      ]
    }
  ]
}
```

**Why JSON for databases and YAML for notes:**
- **JSON** is built into JavaScript, needs no parser dependency, is strict, and serializes deterministically. Databases are machine-managed, so the lack of comments is acceptable.
- **YAML** is used for notes because it is the Markdown frontmatter convention, so users can edit it by hand and other tools read it.

---

## 5. Proposed File and Package List

Paths are relative to the Nodus repo root, once approved.

| File | Purpose |
|---|---|
| `package.json` | Name `nodus`, `"license": "Apache-2.0"`, ESM, scripts for `test` and `typecheck`. |
| `tsconfig.json` | Strict TypeScript config. |
| `LICENSE` | Apache-2.0 text. Subject to the project's approved licensing setup. |
| `README.md` | What Nodus is, link to docs, Phase 1 status. |
| `src/domain/note.ts` | `Note` type, `createNote`, `isUuid`, timestamp and title validation. |
| `src/domain/errors.ts` | `NodusError` and its codes. |
| `src/domain/paths.ts` | `validateNotePath(path)` and `normalizeNotePath`. |
| `src/format/note-format.ts` | `parseNote(source, path)` and `serializeNote(note)`. Includes the version check. |
| `src/links/wikilink.ts` | `parseWikiLinks(body)` and `resolveLink(target, notes)`. |
| `src/database/schema.ts` | `DatabaseDefinition` types, `parseDatabase`, `serializeDatabase`, property validation. |
| `src/index.ts` | Public exports. |
| `test/note-format.test.ts` | Note parse/serialize tests. |
| `test/paths.test.ts` | Path safety tests. |
| `test/wikilink.test.ts` | Link scan and resolution tests. |
| `test/database.test.ts` | Database validation tests. |
| `test/fixtures/*` | 7 small representative fixtures (see §10). |
| `docs/note-format.md` | Note format, stable IDs, paths, versioning, limitations. |
| `docs/wiki-links.md` | Link syntax, resolution rules, duplicates, renames. |
| `docs/database-format.md` | Database JSON format and property rules. |

Deliberately absent: UI, Next.js, Tiptap, storage adapters, repository layer, plugin system, event bus, CLI, and any migration code.

---

## 6. Dependencies

| Dependency | Type | Why |
|---|---|---|
| `yaml` (eemeli/yaml) | runtime | Safe YAML 1.2 parse and stringify, with duplicate-key detection. The only runtime dependency. Use `schema: 'core'` so unquoted timestamps stay strings and `yes`/`no` are not coerced. |
| `typescript` | dev | Compiler and type checking. |
| `vitest` | dev | Tests with minimal config. Alternative: built-in `node:test`, zero extra dependencies. Open decision. |

Not used:
- **gray-matter**: evaluates JS in frontmatter by default. Not acceptable for a portable format.
- **zod or another schema library**: a few explicit validation functions are enough for this surface.
- **uuid**: `crypto.randomUUID()` is built in.
- **remark or any Markdown parser**: not needed. Frontmatter is split by its delimiter (see §7), and link scanning uses a small line-based fence tracker. The body is never parsed as a document.

---

## 7. Format Rules

### Notes (B)

**Frontmatter splitting:** The file must start with `---` followed by a line break. The block ends at the next line that is exactly `---`. Everything after that is the body. This is a delimiter split, not a Markdown parser. A UTF-8 BOM is stripped on read and never written. CRLF is accepted on read.

**Required fields:**

| Field | Rule |
|---|---|
| `title` | String. Trimmed, non-empty. Not UUID-shaped. |
| `nodus.version` | Integer. Must equal `1`. |
| `nodus.id` | Lowercase UUID v4. |
| `nodus.createdAt` | RFC 3339 UTC string ending in `Z`. |
| `nodus.updatedAt` | RFC 3339 UTC string ending in `Z`. |

**Optional fields:**
- `tags`: array of non-empty strings. Default `[]`.
- `aliases`: array of non-empty strings. Default `[]`.

**Errors:** A file without frontmatter is `INVALID_FRONTMATTER`. Phase 1 does not import plain Markdown and does not assign IDs to existing files. This is a deliberate deferral.

**Unknown fields:**
- Unknown top-level keys are kept in `extraFrontmatter` and written back in their original order after the known keys.
- Unknown keys under `nodus` are an error. That namespace is owned by Nodus and versioned, so guessing at it is unsafe.

**Serialization (deterministic):**
1. Output `---\n`.
2. Known keys in fixed order: `title`, `tags`, `aliases`, then `nodus` (`version`, `id`, `createdAt`, `updatedAt`), then `extraFrontmatter` keys in original order.
3. YAML stringified with LF line endings and 2-space indentation.
4. Output `---\n`, then the body verbatim.

Empty `tags` and `aliases` are omitted. Tag and alias order is preserved, not sorted.

**Body:** Stored byte-for-byte. Code fences, Unicode, and wiki links are never modified. Round trip holds: `parseNote(serializeNote(n))` yields the same body and fields. For canonical input, `serializeNote(parseNote(x)) === x`.

**Timestamps:** Nodus does not touch the filesystem, so `updatedAt` is stored as data. Filesystem mtime is unreliable when files are copied, synced, or edited outside Nodus.

### Stable IDs and Paths (A, C)

- **ID:** Generated once at creation, never changed. Independent of title and path.
- **Path:** Workspace-relative, POSIX separators (`/`), always ending in `.md`. Rules:
  - Not absolute, and no drive letters such as `C:`.
  - No `..` segments, no empty segments, no leading `/`.
  - No backslashes, no NUL or control characters.
  - No Windows reserved device names as a segment (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`, with or without an extension).
  - Maximum length 260 characters, a conservative cross-platform limit.
- Paths are checked by `validateNotePath`. Violations throw `UNSAFE_PATH`.

### Versioning (E)

- Notes: `nodus.version` must be the integer `1`.
- Databases: top-level `version` must be the integer `1`.
- Missing, non-integer, or less than 1: `INVALID_FIELD`.
- Greater than 1: `UNSUPPORTED_VERSION`, with the message "created by a newer Nodus; upgrade to read it." Nothing is parsed or rewritten.
- No migration code exists until a real version 1 file must be upgraded. At that point, add a single `migrate` function for that step only.

---

## 8. Wiki-Link Rules (C)

**Syntax:**
- `[[Target]]`
- `[[Target|Display text]]`
- `[[<uuid>]]`, the ID-pinned form.
- `[[<uuid>|Display text]]`, the ID-pinned form with display text.

**Constraints:** Target and display text cannot contain `[`, `]`, or line breaks. Only the first `|` separates target from display. Targets are trimmed.

**Scanning:** `parseWikiLinks` skips fenced code blocks and inline code spans. Matches are returned with `raw`, `target`, `display`, and offsets. `raw` is the exact original text and is never rewritten.

**Resolution (`resolveLink`):**
1. If the target is a UUID, match on `id`. A match is `resolved`. No match is `unresolved`.
2. Otherwise, normalize the target (Unicode NFC, trim, case-fold) and match it against note titles and aliases.
   - One note matches: `resolved`.
   - No note matches: `unresolved`.
   - Two or more notes match: `ambiguous`, returning all candidate IDs. Nodus never picks one automatically.
3. A title that matches another note's alias counts as a match for both, so it is `ambiguous` when they differ.

**Duplicate titles:** Allowed in the data model. Title links become `ambiguous` and need a user choice. The ID-pinned form avoids this.

**Renamed notes:** Title-based links break when a note is renamed. ID-pinned links keep working. Phase 1 does not rewrite links, so this is a known limitation.

**Design decision:** Links stay readable and portable by title. Stability comes from the ID-pinned form, which a user or future editor can choose. Nodus does not automatically convert title links to ID links in Phase 1.

**Not implemented in Phase 1:** graph, backlinks index, automatic rewrite on rename, link autocomplete, search.

---

## 9. Database Schema (D)

**Top-level fields:** `format` (must equal `"nodus-database"`), `version` (must equal `1`), `id` (UUID), `name` (trimmed, non-empty), `properties` (array).

**Property types:** `text`, `number`, `checkbox`, `date`, `select`, `multi-select`.

**Property validation (`INVALID_DATABASE`):**
- `id` is a UUID, unique within the database.
- `name` is trimmed and non-empty. Names are unique within the database, case-insensitively.
- `type` is one of the six values. Unknown types are rejected, never dropped.
- `select` and `multi-select` require `options`. Other types must not have `options`.
- Option `id`s are unique within the property. Option `name`s are non-empty and unique within the property.

**Relations:** Deferred. The requirements (target database, one-way or two-way, cardinality, behavior on delete) are not yet defined.

**Table-view configuration:** Deferred. Not needed until a database milestone shows a table.

**Unknown keys inside a property or database:** Rejected with `INVALID_DATABASE`. These files are fully owned by Nodus at this stage, so silent preservation is unnecessary. Revisit if third-party tools start writing them.

---

## 10. Functions and Tests (F)

Public functions:
- `parseNote(source, path): Note`
- `serializeNote(note): string`
- `createNote({ title, path, body, now }): Note`
- `validateNotePath(path): string`
- `parseWikiLinks(body): WikiLink[]`
- `resolveLink(target, notes): LinkResolution`
- `parseDatabase(json): DatabaseDefinition`
- `serializeDatabase(db): string`

**Note tests:**
- Valid minimal note parses to the expected fields.
- Full note round-trips exactly: canonical input gives identical output.
- Body preserved: code fences, Unicode, wiki links, CRLF in body.
- Missing frontmatter: `INVALID_FRONTMATTER`.
- Unclosed frontmatter: `INVALID_FRONTMATTER`.
- Malformed YAML: `INVALID_FRONTMATTER`.
- Duplicate YAML keys: `INVALID_FRONTMATTER`.
- Missing `title`, `nodus.id`, or `nodus.version`: `INVALID_FIELD`.
- Non-UUID `nodus.id`: `INVALID_FIELD`.
- Timestamp without `Z` or with a non-date value: `INVALID_FIELD`.
- Unknown top-level key preserved through parse and serialize.
- Unknown key under `nodus`: `INVALID_FRONTMATTER`.
- `nodus.version: 2`: `UNSUPPORTED_VERSION`.
- Title that looks like a UUID: `INVALID_FIELD`.

**Path tests:**
- Valid `notes/a/b.md` passes.
- Absolute path, `C:` prefix, `..` segment, backslash, empty segment: `UNSAFE_PATH`.
- `CON.md` and `nul/x.md`: `UNSAFE_PATH`.
- Missing `.md` extension: `UNSAFE_PATH`.

**Wiki-link tests:**
- Plain and aliased links parse with exact `raw`.
- Links inside fenced and inline code are ignored.
- A second `|` inside display text is kept as literal display text. Document this rule.
- Empty target `[[]]` and `[[|x]]` are not links.
- Resolution: one title match, alias match, UUID match, unresolved, ambiguous (two titles, and title-vs-alias).
- Unicode normalization: NFC and NFD forms of the same title resolve to one note.

**Database tests:**
- Valid fixture parses and round-trips.
- Unknown property type: `INVALID_DATABASE`.
- `select` without options, or `text` with options: `INVALID_DATABASE`.
- Duplicate property name, case-insensitive: `INVALID_DATABASE`.
- Duplicate option id or name: `INVALID_DATABASE`.
- `version: 2`: `UNSUPPORTED_VERSION`.
- Wrong `format` value: `INVALID_DATABASE`.

**Fixtures (7):** `valid-note.md`, `note-unknown-fields.md`, `note-no-id.md`, `note-future-version.md`, `database-valid.json`, `database-bad-options.json`, `database-future-version.json`.

---

## 11. Ordered Implementation Backlog

Each step has acceptance criteria. Nothing starts before approval.

1. **Scaffold.** `package.json`, `tsconfig.json`, `LICENSE`, empty `src/index.ts`. Acceptance: `typecheck` and `test` run with zero tests and exit 0.
2. **Errors and paths.** `errors.ts`, `paths.ts`, path tests. Acceptance: all path test cases pass, and only the listed rules trigger `UNSAFE_PATH`.
3. **Note model and IDs.** `note.ts` with `createNote`, `isUuid`, timestamp and title validation. Acceptance: generated IDs are lowercase UUID v4, and title and timestamp rules are enforced.
4. **Note format.** `note-format.ts` with `parseNote` and `serializeNote`, plus fixtures. Acceptance: all note tests pass, round trip is exact for canonical fixtures, and no custom YAML code exists.
5. **Wiki links.** `wikilink.ts` with scan and resolve. Acceptance: all link tests pass, and code-fence exclusion is verified.
6. **Database schema.** `schema.ts` with parse, serialize, and validation. Acceptance: all database tests pass, and every invalid fixture reports a specific error.
7. **Docs.** `docs/note-format.md`, `docs/wiki-links.md`, `docs/database-format.md`, `README.md`. Acceptance: each documented rule has a test or is marked as a limitation.
8. **Review pass.** Remove any export or function not used by a test or doc. Acceptance: public API matches §2 and §5 exactly.

---

## 12. Docs Contents

- **note-format.md:** frontmatter layout, required and optional fields, unknown-field policy, serialization order, path rules, version rule, example.
- **wiki-links.md:** syntax, scanning exclusions, resolution table, duplicates, renames, ID-pinned form, limitations.
- **database-format.md:** JSON layout, property types, validation rules, what is deferred.
- **README.md:** purpose (local-first, portable Markdown), status (Phase 1), link to docs, Apache-2.0.

Known limitations to list in docs: no migrations, no import of plain Markdown, no link rewriting, title links break on rename, relations and rows not implemented, BOM and line endings normalized on write.

---

## 13. Risks, Open Decisions, and Deferrals

**Risks**
- YAML edge cases (anchors, aliases, merge keys, multi-document files). Mitigation: reject them explicitly, and confirm `yaml` core-schema behavior in a test.
- Windows path rules differ from POSIX. Mitigation: validate the stricter rule set on all platforms.
- Title-based links are fragile after renames. Mitigation: documented limitation; ID-pinned form available.
- Code-fence detection is line-based and can be fooled by unusual fence syntax (for example, indented fences inside lists). Mitigation: document the limitation and test common cases.

**Open decisions (need your answer)**
1. Target repository location and name.
2. Include `tags` and `aliases` in Phase 1? Recommendation: yes, they cost very little and are standard.
3. Test runner: `vitest` or built-in `node:test`?
4. Minimum Node.js version, and ESM-only output?
5. Should plain Markdown files without frontmatter be importable in Phase 1? Recommendation: no, defer.
6. Is the ID-pinned link form acceptable, or do you prefer a different syntax?
7. Confirm the license file and any copyright header requirements.

**Deferred (not in Phase 1)**
- Database rows, queries, filters, sorting, formulas, rollups, automations.
- Relations.
- Table-view configuration.
- Backlinks index, graph, search.
- Link rewriting on rename.
- Browser storage (IndexedDB), directory-backed files, atomic file writes.
- Tiptap and any UI.
- Sync, server, authentication, Postgres, collaboration.
- AI, telemetry, analytics.
- Plugin system, event bus, migrations framework.

---

## 14. Effort Estimate

Rough, for one senior TypeScript engineer:
- Scaffold, errors, paths: 0.5 day
- Note model and format, with tests: 1 day
- Wiki-link scan and resolve, with tests: 0.5 day
- Database schema, with tests: 0.5 day
- Docs and review: 0.5 day

**Total: about 3 days.** This assumes the open decisions in §13 are answered before work starts.

---

## Confirmation

This file is the only thing created. No code, configuration, dependencies, git state, or remote settings were changed.

**Next step:** Approve the plan, answer the open decisions in §13, and identify the target repository (path, and whether it is new or existing). Implementation starts only after that.
