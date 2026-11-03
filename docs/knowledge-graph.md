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
| `[[Title]]` / `[[Alias]]` | Follows a title change through an automatically retained previous-title alias; ambiguity is reported. |
| `[[folder/note]]` | Resolves by path; breaks if the note moves. |
| `[[folder/note.md]]` | Same path resolution with an explicit extension. |
| `[[https://…]]` | Ignored; not a note relationship. |
| `[[Missing]]` | Unresolved; preserved in Markdown and repairable from Discovery. |

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

## Graph analytics and knowledge health

`src/links/graph-analytics.ts` derives read-only metrics from `NoteGraph`:

- **Total notes** — nodes in the resolved graph.
- **Linked / isolated** — a linked note has at least one confirmed incoming or outgoing link to another note; isolated notes have none. Self-links never make a note linked.
- **In-degree / out-degree** — distinct source notes / distinct target notes. Duplicate wiki-link occurrences count once because `graphFromLinkIndex` already aggregates them into one edge with `linkCount`.
- **Degree** — in-degree + out-degree. Self-links are reported separately and do not add degree.
- **Degree centrality** — degree divided by `total notes - 1`; zero for a one-note or empty vault.
- **Connected components** — weakly connected groups using confirmed non-self edges. Isolated notes are singleton components. Component IDs are the lexicographically smallest stable note ID in the component.
- **Most connected** — degree descending, then incoming, outgoing, title, path, and stable ID for deterministic ties.

`GET /api/insights` returns totals, the top connected notes, up to eight largest clusters with bounded member previews, and six recently modified note summaries. `?refresh=true` bypasses the shared snapshot cache.

## Knowledge clusters

Clusters are the connected components above, not semantic topics. There is no embedding, content similarity, or persisted cluster record. Each cluster reports size, total degree, a representative note (highest degree with deterministic tie-breaking), and members sorted by degree then title/path/ID. The dashboard exposes the first 20 members per returned cluster and can open the representative in the local graph or open individual notes. Connectivity establishes only that notes are reachable through confirmed wiki links.

## Related note recommendations

`src/links/related-notes.ts` returns bounded, read-only recommendations from the same link snapshot:

| Evidence | Score |
|---|---:|
| Shared outgoing target | 3 per distinct target |
| Shared incoming source | 3 per distinct source |
| Common linked neighbour | 2 per distinct neighbour |
| Title token Jaccard similarity | 2 × similarity |
| Alias/title token Jaccard similarity | 1.5 × similarity |
| Same parent folder | 1 |

The current note is excluded, duplicate candidates are collapsed by stable ID, and only resolved graph nodes are eligible. Results sort by score descending, then title, path, and stable ID. Reason codes explain every recommendation. Ambiguous and unresolved wiki links do not contribute; matching is lexical and link-based, not semantic understanding.

`GET /api/notes/:id/related?limit=6` accepts a limit from 1–20. The editor shows the recommendations under Backlinks and opens a recommended note directly.

## Insights dashboard

The **Knowledge health** view in the sidebar and command palette presents overview metrics, largest clusters, most connected notes, and recently modified notes. Metric actions navigate to Discovery, the local graph, or individual notes. It has loading, empty, error, and retry states, is keyboard accessible, and uses a request generation guard so older responses cannot replace a newer vault revision. Vault switching remounts the view by vault key.

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
Unresolved and ambiguous entries include bounded `suggestions` computed from the same derived
snapshot. Suggestions are deterministic and local, with a title, path, score, and reason.

### `POST /api/notes/:id/links/repair`

Rewrites exactly one unresolved or ambiguous wiki-link occurrence. The request supplies the
source note's `baseHash`, the occurrence offsets and literal target, the chosen
`replacementNoteId`, and optional `display` and `pin` values. The server re-verifies the
occurrence, preserves explicit display text, adds a readable display when pinning a bare link,
and writes only the source note. `pin` defaults to `true`; a title target is used only when it
resolves uniquely to the chosen note.

## Link repair

Discovery offers up to three deterministic repair suggestions for each unresolved link, ranked
from normalized titles, aliases, paths, shared words, and a bounded edit-distance comparison.
Ambiguous links list their resolver candidates. Selecting a suggestion pins the link to the
chosen note's stable ID, so future renames and moves keep working.

When a note title changes and confirmed incoming title links exist, the previous title is
retained as an alias on the renamed note. This is a single note metadata change, not a
vault-wide rewrite. Path links are still not rewritten on move; use ID-pinned links for
references that must remain stable.

## Advanced graph exploration

### Saved graph views

Saved views are browser-local UI preferences, scoped by the active vault path. They are not notes, a new vault format, or backed-up knowledge. Each view stores the search query, folder, selected cluster, focus note, selected note, isolated/unresolved toggles, path traversal mode, and viewport. The storage envelope is versioned; malformed entries, duplicate IDs, unsupported envelope versions, and invalid timestamps or configs are dropped rather than trusted. Users can create, select, update in place, rename, and delete views. The storage key includes the vault path, so two vaults never share views.

### Shortest paths

`GET /api/graph/path?from=<id>&to=<id>&mode=directed|undirected&maxDepth=20&maxVisited=5000` runs BFS over confirmed resolved edges. Directed mode follows wiki-link source → target; undirected mode follows either direction. Self-links never advance a path. Ties between equal-length paths are resolved by target title, path, and stable ID. The response contains the actual note and edge sequence, visited count, and the applied bounds. Identical, missing, disconnected, and bound-limited searches have explicit statuses. Unresolved and ambiguous links are excluded because they are not confirmed graph edges.

### Cluster filtering

`GET /api/graph/clusters` returns all deterministic connected components. The graph can filter to one non-singleton cluster or to all isolated notes. Existing text, folder, isolated-note, and unresolved-link filters remain active. Selections are cleared when a saved cluster no longer exists after a refresh.

### Focus history

Neighbor exploration records the previous focus. **Previous focus** restores it without recomputing graph data. Selection and focus are cleared when a note is deleted or no longer present; renamed or moved notes retain their stable ID and current path from the refreshed projection.

## Performance and caching

- Relationship work is `O(N + L)` in notes plus wiki-link occurrences.
- The local API shares one derived snapshot per vault (five-second TTL), coalesces concurrent rebuilds, and invalidates on Nodus mutations and explicit refresh.
- Graph projection, analytics, and cluster components are computed once when the shared knowledge index is built and reused by `/api/graph`, `/api/graph/clusters`, `/api/insights`, and related-note requests.
- Related-note scoring runs only for an opened note request; it is bounded to 20 results and reuses the same index and graph.
- Shortest paths run only on demand with BFS, `maxDepth` 20, and `maxVisited` 5,000 defaults. This keeps a single search bounded without persisting traversal state.
- Phase 21 local benchmark, Node 24.18.1, five-run median: 1,000 notes / 3,000 links: 18.30 ms indexing/projection total (11.52 ms index, 4.41 ms graph, 3.33 ms analytics/clusters); 5,000 / 15,000: 134.80 ms total (69.51 ms index, 24.29 ms graph, 37.84 ms analytics/clusters). Directed shortest-path BFS for 100 sampled pairs: 33 ms total / 0.33 ms per path at 1,000 notes and 220.34 ms / 2.203 ms per path at 5,000 notes. These are local observations, not enforced thresholds.
- UI filtering, focus, and selection never request a new snapshot; only the initial load and explicit refresh do.
- The graph view bounds displayed nodes to 200 per render after filtering. Truncation is visible; focus is applied before the limit.
- Local benchmark (`pnpm bench:graph`, Node 24.18.1, five-run median after warm-up) measured 1,000 notes / 3,000 occurrences at 16.16 ms total (12.37 ms index, 3.76 ms graph) and 5,000 notes / 15,000 occurrences at 81.33 ms (57.68 ms index, 21.90 ms graph). These are local development observations, not service-level guarantees.
- Repair suggestion ranking adds 80.81 ms for 250 unique targets at 1,000 notes (0.323 ms per target) and 975.98 ms for 500 unique targets at 5,000 notes (1.952 ms per target) in the same local benchmark. Fuzzy edit-distance work is bounded per target; prefix, containment, and token checks remain linear in the note count. The API caches ranked suggestions per missing target within one discovery request.
- Virtual unresolved targets are added only for sources still visible after filtering.

No persistent relationship index exists. Restarting Nodus rebuilds everything from Markdown. External edits appear after the snapshot TTL, explicit refresh, or a mutation. A note with a malformed Markdown file follows the existing storage error behavior.

## Known limitations

- The graph uses a deterministic radial layout; there is no force simulation or persisted node position.
- Saved graph views are browser-local preferences, not portable vault data, and do not survive clearing site storage or changing browser profiles.
- Shortest paths are bounded BFS results over confirmed links; very large searches can return `limit` rather than an exhaustive answer.
- Cluster filter options currently list all non-singleton clusters; extremely fragmented vaults use the separate isolated-notes option.
- The path destination picker shows the first 500 note candidates to keep the command list bounded. Search beyond that set should use graph filtering first.
- Saved graph views are browser-local preferences; they are not included in backups or portable exports, and clearing site storage removes them.
- Clusters are graph connectivity, not semantic groups. Recommendations are lexical/link-based and can be noisy in large folders.
- The insights response exposes up to eight clusters with 20 member previews each; very large clusters require graph exploration.
- The 200-node display bound requires filtering or focusing for larger vaults.
- Unresolved targets are literal text, not notes; they cannot be opened or edited from the graph.
- Path links intentionally break when the target moves; use ID-pinned links or repair the link from Discovery.
- Title changes retain the previous title as an alias only when confirmed incoming title links
  exist. Removing that alias later breaks those links again.
- Repair suggestions are lexical and deterministic. They do not use content similarity, semantic
  embeddings, or AI, and they never write without an explicit action.
- Link repair rewrites one occurrence in one source note. There is no vault-wide repair-all
  operation and no automatic link rewriting on move.
- No link extraction from frontmatter, heading/block targets, or automatic link rewriting.
- Graph and backlink data are derived in memory; there is no cross-process invalidation beyond the existing snapshot TTL/refresh behavior.
- Ambiguous targets are counted and omitted from confirmed edges; the source Markdown must be edited or repaired to choose a candidate.
