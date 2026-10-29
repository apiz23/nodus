# Search performance benchmark

Run the reproducible benchmark with:

```sh
pnpm bench:search
```

The benchmark invokes the production `/api/search` handler and the real filesystem vault scanner/parser. It creates synthetic Markdown files in an OS temporary directory, validates each result set against deterministic expected IDs, then removes the temporary vaults and closes its loopback servers.

Default datasets contain 100, 1,000, and 10,000 notes. They use deterministic IDs and content, nested directories, Nodus frontmatter with optional tags and aliases, paragraphs of varied counts, wiki links, a common term in every note, a rare term every 997 notes, a multi-word phrase every 13 notes, and a frequent phrase in two out of three notes. Search results remain capped by the production API at 50.

Scenarios measure common-term, rare-term, no-result, multiple-term, many-match, and repeated identical queries. Each scenario has one warm-up query by default and five measured queries. Results include returned and total expected matches plus median, p95, minimum, and maximum latency. The timed interval includes localhost HTTP, in-memory matching and ranking, and JSON response handling. Vault traversal, file reads, and Markdown parsing occur on the first request, after snapshot expiry (five seconds), or after invalidation; warm queries reuse the derived snapshot. A timing that crosses expiry includes a rebuild. Query-result IDs are checked on warm-up and measured requests.

Configure larger or shorter runs with environment variables:

```sh
NODUS_SEARCH_BENCH_SIZES=100,1000,10000 NODUS_SEARCH_BENCH_ITERATIONS=5 NODUS_SEARCH_BENCH_WARMUPS=1 pnpm bench:search
NODUS_SEARCH_BENCH_SIZES=50000 NODUS_SEARCH_BENCH_ITERATIONS=3 pnpm bench:search
NODUS_SEARCH_BENCH_JSON=1 pnpm bench:search
NODUS_SEARCH_BENCH_SIZES=1000,5000,10000 NODUS_SEARCH_BENCH_JSON=1 NODUS_SEARCH_BENCH_PROFILE=1 pnpm bench:search
```

`NODUS_SEARCH_BENCH_TIMEOUT_MS` sets the per-request timeout (default 120,000). JSON mode emits environment metadata, configuration, first-request timings, repeated measurements, and errors. RSS metadata is process-level and approximate; it is not per-search allocation. The separately printed first request is not called cold: fixture generation already touched its files, and OS filesystem cache is uncontrolled. Timings vary with CPU, OS, filesystem, cache state, and system load. Benchmark results are diagnostic, not a CI performance threshold.

Optional profiling uses a separate API instance after the primary timings, so instrumentation
does not affect their latency samples. It measures the first snapshot, a warm query, an explicit
rebuild, note creation itself, and the search after creation invalidates the index. Each phase
checks expected result IDs. Buckets include snapshot wall time, directory scan, guarded reads,
symlink checks, frontmatter parsing, link-index construction, and search normalization/index
construction, with read/parse counts. Async read/check totals are aggregate task durations;
they overlap with concurrent reads and must not be added to wall time. Symlink checks are
included in guarded reads, and scan/read/parse work is included in snapshot time.

For the editor's focused large-document/large-vault diagnostic, run
`NODUS_EDITOR_PROFILE=1 pnpm exec vitest run --no-cache test/editor-wikilinks.test.ts`.
It reports editor-state creation plus collection of 40 visible links in a roughly 920 KB document
with 10,000 note summaries. The regression checks bounded title-lookup work and source fidelity,
not a machine-dependent time limit; it does not claim to measure browser typing latency.
