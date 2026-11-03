# Global Search

Use Search notes in the sidebar or open the command palette with Cmd/Ctrl+K. Search covers saved
note titles, aliases, paths, all Markdown body text (including code), tags, and names/values of
registered general properties. Unregistered custom YAML fields are excluded. Plain text remains a
case-insensitive substring search with Unicode NFC and whitespace normalization. Queries can also
use the operators below; values with spaces must be quoted. Quoted phrases are required matches.
Repeated operators combine with AND. Syntax errors are returned as actionable search errors rather
than being interpreted as arbitrary filters.

```text
query       := term (space term)*
term        := phrase | operator:value | plain-text
phrase      := "text with spaces"
operator    := tag | folder | type | before | after | created-before | created-after
             | modified-before | modified-after | title | alias | path
```

Examples: `tag:research folder:"Project Notes"`, `title:"weekly review"`,
`before:2026-01-01 after:2025-01-01`, or `design "decision record" type:note`.
Unquoted adjacent words remain a literal phrase for backward compatibility (`weekly review`);
quoted phrases can be combined with other phrases or operators, and each required phrase must match.
`tag:` matches a complete normalized tag; `folder:` matches notes below a folder path;
`type:` currently accepts `note` because this API searches Markdown notes; `before:` and `after:`
compare the note's `updatedAt` calendar date (strictly before/after); `created-before:` and
`created-after:` compare `createdAt`; `modified-before:` and `modified-after:` are explicit aliases
for updated-date constraints. Date comparisons are strict, so a note on the boundary date does not
match. `title:`, `alias:`, and `path:`
scope substring matching to the named field. Free text and each operator must all match. Existing
tag/property filters in the filter popover combine using their selected AND/OR logic, while query
syntax constraints always compose with those filters using AND. This milestone does not search
structured database rows or formula/rollup projections; database records are a separate search model.

Invalid registered values are diagnosed and excluded from search/filter evaluation; their Markdown
values remain unchanged.

Ranking is deterministic and explainable. Exact title matches remain highest. For a matching text
phrase, the current signal order is:

1. Exact title.
2. Exact alias, then partial alias.
3. Title prefix, then partial title.
4. Path.
5. Markdown content.
6. Tag.
7. Registered property name or value.

For multiple required phrases that do not occur as one contiguous phrase, results must match every
phrase and are ranked by the strongest individual field match after contiguous phrase matches.
`matchedFields` identifies all matched fields and constraints; result snippets highlight one primary
context. This is lexical ranking only, not semantic relevance.

Within each match tier, BM25 term relevance now refines ordering; remaining ties sort by title, path, then stable ID. See [Knowledge retrieval](knowledge-retrieval.md) for weights, bounds and limitations. Duplicate titles remain distinct notes. Up to 50 results
are returned. Results show their path and matching field with a contextual excerpt and highlight;
Markdown is displayed as escaped text. Each note appears once even if several fields match.

In the sidebar, Enter in the search field opens the first result; ArrowDown focuses the first
result. ArrowUp/ArrowDown and Home/End move among results; Enter opens the focused result.
Escape clears the query and returns to the field. The command palette groups commands by
category, searches names and keyword aliases, shows shortcut labels, and lists recent notes,
databases, and folders alongside server-ranked note results. Command and note selection use the
shared shadcn Command keyboard behavior; notes open by stable ID. An empty palette shows commands
and up to five recent notes; an empty sidebar query shows the note tree unless filters are active.
No matches, search errors, and command execution errors have separate states. Retry search
preserves the query and forces a fresh disk snapshot. See [shortcuts](shortcuts.md) for the
shortcut reference and focus rules.

## Derived index and refresh

`GET /api/search?q=...` returns `{ results, metadataIssueCount, catalogIssue? }`. Each result
includes the existing note summary and `snippet`, plus
`match: { field, text, start, end, propertyId?, propertyName? }`. Offsets identify matching text
in the returned excerpt, not in the Markdown file. `field` is `title`, `alias`, `path`, `content`,
`tag`, `property`, `date`, or `filter`; `matchedFields` lists all matching fields and constraints.
`GET /api/search/metadata` returns filter suggestions and current
registered property definitions. Search syntax errors return HTTP 400 with code `INVALID_QUERY`.
Query size is bounded to 500 characters and at most 20 text/operator terms.

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

The Phase 23 baseline (before content-assisted retrieval) Node 24 benchmark on an Intel i5-8257U (8 reported CPUs) measured the instrumented first
snapshot at 1.22 s / 2.20 s / 3.92 s for 1k / 5k / 10k notes; explicit rebuild at 321 ms / 696 ms /
2.44 s; warm query at 4.7 ms / 27 ms / 36 ms; and query after one-note creation invalidation at
230 ms / 853 ms / 1.00 s. These are single-run observations, not performance guarantees. The
benchmark reports first-request and warm timings separately; OS file-cache state and host load are
uncontrolled, and per-operation profile durations aggregate work across files, so they can exceed
wall-clock phase time. Run `pnpm bench:search` for current measurements at 1k, 5k and 10k; see [Knowledge retrieval](knowledge-retrieval.md) for Phase 24 results.

## Metadata filters

The sidebar filter popover supports tag and registered-property filters. Query operators provide
folder and date constraints without requiring a separate vault scan. Active query operators appear
as removable chips; tag and property filters remain individually removable in the filter popover.
Multiple metadata filters combine with AND by default or OR when selected. Filters use stable property IDs, so display-name changes
do not retarget them. If a property is deleted while a filter is active, the API returns a clear
validation error and the filter remains removable in the popover. Catalog suggestions refresh when
the popover opens.

Operators are type-specific: text and URL support equals/contains/empty; numbers support equals,
greater/less than/empty; checkboxes support checked/unchecked; dates support equals/before/after/empty;
select supports is/is not/empty; multi-select supports contains/does not contain/contains all/empty;
tags support contains/does not contain/contains all. A retained select option alias resolves to the
same option as its current label for both search and filtering. Comparisons are Unicode-normalized
and case-insensitive where appropriate. Missing values count as empty; explicit `false` is present and
matches unchecked; empty text and empty arrays count as empty. Invalid values are not treated as
missing and do not match filters. Tag comparisons use trimmed, case-insensitive NFC identity.

Saved searches and completed search history are stored in browser local storage, separated by the
active vault path. A saved definition stores only its name, query and filter descriptors; results
are always executed against the current derived index. History stores up to 20 unique recent query
and filter combinations and can be removed individually or cleared after confirmation. This is
browser-profile-local and is not included in vault backup/export. Queries may contain sensitive text;
users can clear history at any time. Browser storage is best-effort, and quota/unavailable-storage
errors never block search.

Filter requests use the same debounced, abortable search hook. The API validates each operator and
value against the current catalog before evaluating it. Empty query with no filters returns
immediately without loading the vault snapshot.

Focused checks:

- `pnpm exec vitest run test/search-index.test.ts test/note-filters.test.ts test/ui-search.test.ts`
- `node scripts/search-smoke.mjs` (Node 24+, installed Playwright Chromium).
