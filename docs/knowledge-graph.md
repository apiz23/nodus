# Knowledge graph and relationship exploration

Nodus derives a directed note graph from saved Markdown. Markdown remains the source of truth; the graph is a rebuildable projection with no new database, index file, or relationship format.

## Relationship pipeline

```text
Markdown body
  -> parseWikiLinks (existing scanner; excludes inline/fenced code)
  -> createLinkResolver (stable ID, title, alias, path)
  -> buildLinkIndex (notes, occurrences, backlinks, isolated notes)
  -> graphFromLinkIndex (nodes, resolved edges, unresolved links, isolated IDs)
  -> /api/graph and /api/notes/:id/backlinks
  -> UI graph model and panels
```

Implementation:

- `src/links/wikilink.ts` — parsing and link resolution.
- `src/links/link-index.ts` — vault-wide derived snapshot.
- `src/links/backlinks.ts` — incoming and outgoing projections.
- `src/links/graph.ts` — graph projection.
- `ui/src/graph-model.ts` — presentation filters and deterministic positions.
- `ui/src/GraphView.tsx` — interactive graph.
- `ui/src/BacklinksPanel.tsx` — incoming and outgoing note relationships.
- `src/ui-server/api.ts` — `/api/graph`, `/api/notes/:id/backlinks`, `/api/discovery`.

No new dependency is used for graph layout or rendering. The existing SVG view is retained.

## Link resolution

Resolution order:

1. Lowercase UUID v4 → stable note ID.
2. Title or alias after Unicode NFC, trim, and lowercase.
3. Workspace-relative path, with or without a trailing `.md` and with `\` normalized to `/`.

Title and alias take precedence over path. One match resolves; multiple title/alias matches are ambiguous and never auto-selected. Missing targets are unresolved. External URL schemes (`https:`, `mailto:`, and protocol-relative `//`) are ignored as internal relationships. Code spans and fenced code blocks are excluded by the existing scanner.

| Link | Behavior |
|---|---|
| `[[Stable ID]]` | Survives rename and move. |
| `[[Title]]` / `[[Alias]]` | Breaks if the target is renamed; ambiguity is reported. |
| `[[folder/note]]` | Resolves by path; breaks if the note moves. |
| `[[folder/note.md]]` | Same path resolution with an explicit extension. |
| `[[https://…]]` | Ignored; not a note relationship. |
| `[[Missing]]` | Unresolved; preserved in Markdown. |

## Graph projection

`graphFromLinkIndex` produces:

- `nodes` — stable note ID, title, and current path.
- `edges` — one directed edge per source/target pair with `linkCount` and up to three snippets.
- `unresolvedLinks` — source ID, literal target, occurrence count, and snippets.
- `unresolvedCount` — unresolved occurrences.
- `ambiguousCount` — ambiguous occurrences (excluded from edges).
- `isolatedNodeIds` — notes with no confirmed incoming or outgoing links. Self-links do not count as connections.

Duplicate links are aggregated into one edge with an occurrence count. Self-links remain as self-edges for inspection but do not make a note non-isolated. Deleted targets disappear from nodes; links to them become unresolved. Renamed and moved notes keep their stable IDs and current title/path in projections.

## Interactive graph

- Directed SVG graph with node labels, arrowheads, and occurrence-weighted edge widths.
- Mouse/trackpad wheel zoom, zoom buttons, pointer pan, reset viewport.
- Click/focus selects a node; connected nodes and edges are highlighted and unrelated elements are dimmed.
- Enter/Space selects; double-click opens a resolved note; **Open note** does the same.
- **Explore neighbors** restricts the view to a one-hop neighborhood; **Show full graph** restores it.
- Search filters by title or path.
- Folder filter uses workspace-relative parent folders.
- Isolated-note and unresolved-link visibility toggles.
- Unresolved targets appear as dashed virtual nodes with dashed edges; selecting one shows the referencing notes. They cannot be opened as notes.
- Reset filters restores the complete graph and resets the viewport.
- Loading, empty-vault, no-match, error, retry, truncation, and selected-node states are explicit.
- Graph nodes are keyboard-focusable buttons with accessible names, `aria-pressed`, and visible focus treatment.

## Orphans and isolated notes

The legacy API `orphans` list means “no confirmed incoming link.” The graph/discovery UI uses the stricter **isolated** definition from the task: no confirmed incoming **and** no confirmed outgoing internal link. Self-links, unresolved links, and ambiguous mentions do not connect a note.

Isolated notes are never modified, moved, or deleted automatically. Discovery lists them for inspection and opening.

## API

### `GET /api/graph`

Returns the projected graph. Optional `?refresh=true` bypasses the cached snapshot.

### `GET /api/notes/:id/backlinks`

Returns both directions:

```json
{
  "backlinks": [{ "sourceId": "...", "sourceTitle": "...", "snippet": "...", "count": 2, "ambiguous": false }],
  "outgoing": [{
    "raw": "[[Target]]",
    "target": "Target",
    "start": 0,
    "end": 10,
    "line": 1,
    "snippet": "See [[Target]]",
    "resolution": { "status": "resolved", "noteId": "..." },
    "targetId": "...",
    "targetTitle": "Target",
    "targetPath": "notes/target.md",
    "selfReference": false
  }]
}
```

Ambiguous outgoing entries include `candidateIds`; unresolved entries have no target metadata. `?refresh=true` rebuilds from disk.

### `GET /api/discovery`

Adds `isolated` alongside the existing `unresolved`, `ambiguous`, and `orphans` collections.

## Performance and caching

- Relationship work is `O(N + L)` in notes plus wiki-link occurrences.
- The local API shares one derived snapshot per vault (five-second TTL), coalesces concurrent rebuilds, and invalidates on Nodus mutations and explicit refresh.
- Graph projection is computed once when the shared knowledge index is built and reused by `/api/graph`.
- UI filtering, focus, and selection never request a new snapshot; only the initial load and explicit refresh do.
- The graph view bounds displayed nodes to 200 per render after filtering. Truncation is visible; focus is applied before the limit.
- Local benchmark (`pnpm bench:graph`, Node 24.18.1, five-run median after warm-up) measured 1,000 notes / 3,000 occurrences at 16.27 ms total (12.52 ms index, 3.72 ms graph) and 5,000 notes / 15,000 occurrences at 78.45 ms (55.88 ms index, 21.11 ms graph). These are local development observations, not service-level guarantees.
- Virtual unresolved targets are added only for sources still visible after filtering.

No persistent relationship index exists. Restarting Nodus rebuilds everything from Markdown. External edits appear after the snapshot TTL, explicit refresh, or a mutation. A note with a malformed Markdown file follows the existing storage error behavior.

## Known limitations

- The graph uses a deterministic radial layout; there is no force simulation or persisted node position.
- The 200-node display bound requires filtering or focusing for larger vaults.
- Unresolved targets are literal text, not notes; they cannot be opened or edited from the graph.
- Path links intentionally break when the target moves; use ID-pinned links for stable references.
- No link extraction from frontmatter, heading/block targets, or automatic link rewriting.
- Graph and backlink data are derived in memory; there is no cross-process invalidation beyond the existing snapshot TTL/refresh behavior.
- Ambiguous targets are counted and omitted from confirmed edges; the source Markdown must be edited to choose a candidate.
