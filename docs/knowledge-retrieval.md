# Knowledge retrieval

Phase 24 extends note search and the existing **Related notes** section with local, explainable text
retrieval. Open any saved note to see recommendations; activate one with pointer, Enter, or Space to
open its stable note ID. Refresh retries errors and reloads external changes. No new search mode,
chat interface, service, model download, or preference is required.

## Architecture decision

The first implementation uses a bounded term-frequency projection inside the existing search index,
built by the same root-locked Markdown snapshot used for search, links, graph and insights.

| Strategy | Value and cost | Decision |
| --- | --- | --- |
| Existing substring/title ranking | Predictable, inexpensive, but ignores body context for recommendations | Preserve eligibility and title/alias ranking tiers |
| BM25-style lexical retrieval | Length normalization and term frequency improve ordering; CPU and memory scale with tokens | Use within existing search tiers |
| TF-IDF text similarity | Finds shared body topics despite different titles or absent links; limited by vocabulary | Use for contextual recommendations |
| Graph-assisted retrieval | Explainable shared links complement text; popularity can dominate if uncapped | Reuse existing engine, cap graph influence |
| Local embeddings | Could bridge different vocabulary, but requires model selection, downloads, hardware budgets, model lifecycle, quality evaluation and dependencies | Defer; current evidence does not justify the costs |
| Lexical/semantic hybrid or vector database | Requires semantic model infrastructure and recovery policy | Not implemented; no semantic index exists |

This is lexical and graph-assisted retrieval, not semantic understanding. It cannot reliably connect
notes with wholly different words and no shared tags or graph context. Recommendations explain the
evidence actually observed, using labels such as “Similar text: soil, ecology”, “Shared tags: nature”,
“Related headings”, or existing shared-link counts. A suggested connection never edits Markdown.

## Index and lifecycle

`src/search/retrieval.ts` holds only an in-memory derived projection: per-note term frequencies,
normalized tag identities, heading terms, inverted term postings, document norms and corpus lengths.
It receives saved Markdown/title/aliases/tags and validated registered property text from
`buildSearchIndex`; it never reads the filesystem itself, indexes unknown YAML, or queries database
row projections, formulas or rollups. A Markdown note that also represents a database record remains
an ordinary note, as in existing note search; structured row objects are not added as extra results.

Each field is bounded to 200,000 characters and 8,192 accepted tokens; a document retains at most
1,024 distinct terms. Body text after the character limit does not contribute to this projection,
but existing exact substring search still examines the complete saved body. Tokens are NFC,
case-normalized Unicode words of 2–64 UTF-16 code units containing letters. Pure numbers and a small
English stop-word set are omitted. No stemming, translation or language-specific segmentation is
claimed. Fenced code and HTTP URLs are omitted from recommendation prose; existing exact search
continues to match code and URLs. No arbitrary HTML is rendered.

A SHA-256 fingerprint of bounded source fields lets unchanged documents reuse token projections.
The reuse cache belongs to one vault's shared snapshot. All corpus postings/norms are recomputed
because adding/deleting notes changes document frequencies; this is **projection reuse**, not a
persistent or fully incremental inverted-index system. No cache is authoritative. No index files or
attachment bytes are written, so backup/restore and portable formats do not change.

The existing mutation generation counter, shared concurrent rebuild, five-second expiry and explicit
refresh apply to retrieval. Note/title/path/tag/property/catalog changes invalidate the same snapshot.
Renames retain stable IDs; deletions disappear from the next snapshot. Old generations cannot
replace the current published snapshot. A previous projection can be reused only if its fingerprint
matches the current source. Failed filesystem snapshots are not published. If optional text
projection construction fails, ordinary substring search and legacy link/title recommendations remain
available; the related API returns a `retrievalIssue` and the panel offers refresh/retry. Rebuilding
retries construction. Vault switching clears snapshot caches; panel remounting by vault/note and
request cancellation prevent old responses appearing under a new note. Unsaved drafts are never
sent to retrieval; recommendations reflect saved content.

## Ranking

Search preserves Phase 23 eligibility, operators, filters, quoted phrases and match tiers: exact title,
exact/partial alias, title prefix/partial title, path, content, tag, registered property. Within a tier,
BM25 uses `k1=1.2`, `b=0.75`, inverse document frequency and weighted term frequency. Title weight is
4, alias/heading/tag weight 3, registered property text weight 2, prose weight 1. Scores then tie-break
by title, path and stable ID. Numeric/punctuation-only searches use the existing lexical ordering.
No recent-activity boost is added. Result snippets and escaped-text highlighting remain unchanged.

Recommendations select at most 24 source terms by TF-IDF weight. For vaults of five notes or more,
terms present in more than 60% of notes are excluded as boilerplate. Cosine weights use
`(1 + log(tf)) * min(3, 1 + log((N+1)/(df+1)))`; the floor/cap stop rare title words from overwhelming
shared body evidence. At least two informative shared terms and cosine similarity of 0.08 are required
for a text explanation. Shared normalized tags can qualify a result independently. Completely
duplicated boilerplate across a vault may produce no text recommendations rather than a false claim
of relevance.

The existing related engine combines qualifying text similarity (up to 8 points), shared tags (up to
2), and existing graph/title/folder evidence capped at 2. Folder proximity alone cannot qualify a
recommendation. Heading overlap is explained and contributes via heading weights. Only confirmed
wiki links contribute graph evidence. Text candidates are bounded to 100, final results to 20 (six in
the panel), self-results are excluded and results are unique by stable ID. Scores are internal evidence
weights, not confidence percentages or proof of semantic relevance.

## API and user experience

`GET /api/notes/:id/related?limit=6&refresh=true` retains its existing response structure and adds
optional `terms` to reason entries, new reason codes `similar-content`, `shared-tags`,
`related-headings`, and optional top-level `retrievalIssue`. Missing/deleted notes return 404. The
existing `/api/search` request contract and saved-search/history definitions remain compatible.

The existing Related notes panel handles loading, empty results, error/retry, accessible reason
labels and stable-ID opening. This keeps recommendations in the current writing/navigation flow.
Technical scoring options remain internal; users do not need to choose an algorithm.

## Measurements and verification

Run `pnpm bench:retrieval` for deterministic 1k/5k/10k-note projection/query/recommendation measurements,
and `pnpm bench:search` for end-to-end localhost HTTP plus filesystem snapshot/search costs. Fixtures
are synthetic; initial projection timing excludes disk scanning, Markdown parsing and graph building.
First query means first query in the retained process, not an OS-cold measurement. Warm results are
medians of five iterations. Heap deltas/RSS include other allocations and garbage collection.
Encoded projection bytes approximate serialized term/posting size; no such file is persisted and
this excludes JavaScript object overhead. Host load, OS cache and model-specific quality are not
controlled. Observed on 2026-11-03 with Node v24.18.1, macOS x64 and an Intel i5-8257U (8 reported CPUs):

| Notes | Search + retrieval build | One-edit rebuild | Warm query median | Recommendation median | Encoded term/posting payload |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 57.6 ms | 14.1 ms | 1.6 ms | 7.5 ms | 0.59 MiB |
| 5,000 | 241.8 ms | 62.7 ms | 6.2 ms | 36.8 ms | 2.97 MiB |
| 10,000 | 380.1 ms | 190.3 ms | 10.5 ms | 50.1 ms | 5.94 MiB |

The one-edit rebuild reused 999 / 4,999 / 9,999 term projections. First in-memory query times were
14.8 / 7.5 / 9.3 ms; later sizes share a warmed process/JIT. Approximate heap deltas were
16.1 / 74.5 / 74.6 MiB (garbage collection makes these non-monotonic); process RSS after the largest
case was 315 MiB, including fixture notes, old/new indexes, graph and test overhead. Payload size
excludes norms, headings, tags and JavaScript object overhead. The synthetic corpus has ten topics;
long, diverse real documents can require substantially more memory, up to the documented token caps.

The separate end-to-end filesystem benchmark measured first HTTP queries at 606 / 2,570 / 3,050 ms
and warm common-term medians at 9.3 / 18.8 / 32.0 ms for the same note counts. These are different
fixtures and include HTTP plus the full knowledge snapshot; they are not comparable to pure
in-memory timings or controlled cold-cache runs.

Focused tests cover ranking tiers, evidence labels, weak-overlap suppression, Unicode/long content,
limits, stable ordering, projection reuse, catalog exclusions/changes, edits/renames/deletions,
interrupted snapshots and lexical fallback/retry. `node scripts/retrieval-smoke.mjs` exercises unlinked
cross-folder discovery, keyboard opening, response ownership, empty states and narrow layout.

Remaining work includes evaluated synonym/semantic retrieval, language-specific tokenization,
relevance datasets judged by users, broader real-vault memory measurements and fully incremental
posting maintenance if profiling warrants it. Phase 24D semantic hybrid retrieval is deferred.

The instrumented HTTP lifecycle run at 10k notes measured an explicit snapshot rebuild at 1.17 s and a query following note creation at 1.21 s. The latter read 10,001 files but parsed only the new file; the warm query read/parsed none. This confirms existing snapshot/parse reuse, not elimination of vault scans after invalidation. File-read/check timers overlap and cannot be summed as wall time.
