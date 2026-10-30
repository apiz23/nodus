# Global Search

Use Search notes in the sidebar or open the command palette with Cmd/Ctrl+K. Search covers saved
note titles, aliases, paths, all Markdown body text (including code), tags, and names/values of
registered general properties. Unregistered custom YAML fields are excluded. The query is a literal,
case-insensitive substring with Unicode NFC and whitespace normalization. Invalid registered values
are diagnosed and excluded from search/filter evaluation; their Markdown values remain unchanged.

Ranking is deterministic:

1. Exact title.
2. Exact alias, then partial alias.
3. Title prefix, then partial title.
4. Path.
5. Markdown content.
6. Tag.
7. Registered property name or value.

Ties sort by title, path, then stable ID. Duplicate titles remain distinct notes. Up to 50 results
are returned. Results show their path and matching field with a contextual excerpt and highlight;
Markdown is displayed as escaped text. Each note appears once even if several fields match.

In the sidebar, Enter in the search field opens the first result; ArrowDown focuses the first
result. ArrowUp/ArrowDown and Home/End move among results; Enter opens the focused result.
Escape clears the query and returns to the field. The command palette uses the existing shadcn
Command keyboard selection and opens notes by ID. An empty palette shows workspace commands; an
empty sidebar query shows the note tree unless filters are active. No matches and errors have
separate states. Retry search preserves the query and forces a fresh disk snapshot.

## Derived index and refresh

`GET /api/search?q=...` returns `{ results, metadataIssueCount, catalogIssue? }`. Each result
includes the existing note summary and `snippet`, plus
`match: { field, text, start, end, propertyId?, propertyName? }`. Offsets identify matching text
in the returned excerpt, not in the Markdown file. `field` is `title`, `alias`, `path`, `content`,
`tag`, `property`, or `filter`. `GET /api/search/metadata` returns filter suggestions and current
registered property definitions.

Search and Knowledge Discovery share a root-locked parsed Markdown snapshot. Search fields and
registered property projections are normalized once during rebuild, then queries run in memory.
The catalog supplies property definitions; Markdown frontmatter supplies values. The snapshot is
rebuilt lazily after note creation, save, tag/property edits, catalog changes, move, delete, or
restore. It expires after five seconds, so external edits appear on a subsequent query after expiry
or explicit refresh. No watcher or persistent search database is required; restarting rebuilds
everything from Markdown and `properties/catalog.json`. Restore and portable import invalidate the derived snapshot; the next search or filter rebuild reads the restored notes and catalog from disk.

On each rebuild the scanner reads and hashes notes in bounded batches under the root lock. Identical
bytes reuse a parsed note; changed/new paths are parsed again and removed paths are evicted. The
parsed cache is published only after a successful complete snapshot. Normal storage reads, writes,
backups, and restores continue to validate Markdown directly.

## Metadata filters

The sidebar filter popover supports tag and registered-property filters. Multiple filters combine
with AND by default or OR when selected. Filters use stable property IDs, so display-name changes
do not retarget them. If a property is deleted while a filter is active, the API returns a clear
validation error and the filter remains removable in the popover. Catalog suggestions refresh when
the popover opens.

Operators are type-specific: text and URL support equals/contains/empty; numbers support equals,
greater/less than/empty; checkboxes support checked/unchecked; dates support equals/before/after/empty;
select supports is/is not/empty; multi-select supports contains/does not contain/contains all/empty;
tags support contains/does not contain/contains all. Comparisons are Unicode-normalized and
case-insensitive where appropriate. Missing values count as empty; explicit `false` is present and
matches unchecked; empty text and empty arrays count as empty. Invalid values are not treated as
missing and do not match filters. Tag comparisons use trimmed, case-insensitive NFC identity.

Filter requests use the same debounced, abortable search hook. The API validates each operator and
value against the current catalog before evaluating it. Empty query with no filters returns
immediately without loading the vault snapshot.

Focused checks:

- `pnpm exec vitest run test/search-index.test.ts test/note-filters.test.ts test/ui-search.test.ts`
- `node scripts/search-smoke.mjs` (Node 24+, installed Playwright Chromium).
