# Global Search

Use Search notes in the sidebar or open the command palette with Cmd/Ctrl+K.
Search covers saved note titles, aliases, paths, and all Markdown body text, including code.
It uses a literal, case-insensitive substring query with Unicode NFC and whitespace normalization.
Frontmatter values other than title and aliases are not searched.

Ranking is deterministic:

1. Exact title.
2. Exact alias, then partial alias.
3. Title prefix, then partial title.
4. Path.
5. Markdown content.

Ties sort by title, path, then stable ID. Duplicate titles remain distinct notes. Up to 50 results
are returned. Results show their path and matching field with a contextual excerpt and highlight;
Markdown is displayed as escaped text. Each note appears once even if several fields match.

In the sidebar, Enter in the search field opens the first result; ArrowDown focuses the first
result. ArrowUp/ArrowDown and Home/End move among results; Enter opens the focused result.
Escape clears search and returns to the field. The command palette uses the existing shadcn
Command keyboard selection and opens notes by ID. An empty palette shows workspace commands;
an empty sidebar query shows the note tree. No matches and errors have separate states. Retry
search preserves the query and forces a fresh disk snapshot.

## Derived index and refresh

`GET /api/search?q=...` returns `{ results }`. Each result includes the existing note summary and
`snippet`, plus `match: { field, text, start, end }`. Offsets identify the matching text in the
returned excerpt, not in the Markdown file. `field` is `title`, `alias`, `path`, or `content`.
`?refresh=true` forces a rebuild; empty queries return no results without reading the vault.

Search and Knowledge Discovery share a root-locked parsed Markdown snapshot. Search fields are
normalized once during rebuild, then queries run in memory. The snapshot is rebuilt lazily after
note creation, save, property edits, move, delete, or restore. It expires after five seconds, so
external edits appear on a subsequent query after expiry or explicit refresh. No watcher or
persistent search database is required; restarting rebuilds everything from Markdown.

The UI debounces requests by 180 ms and aborts obsolete requests. Query, vault, and revision keys
prevent stale responses or previously selected results from appearing in a different query or
vault. Results refresh after note mutations; unsaved editor drafts are not indexed.

Focused checks:

- `pnpm exec vitest run test/search-index.test.ts test/ui-search.test.ts test/link-index.test.ts`
- `node scripts/search-smoke.mjs` (Node 24+, installed Playwright Chromium).
