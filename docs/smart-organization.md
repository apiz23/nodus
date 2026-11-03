# Smart organization

Smart organization surfaces reviewable suggestions from a vault's current Markdown and existing derived knowledge snapshot. It does not use a hosted AI service, write suggestions in the background, or treat notes as duplicates that should be merged.

## Analysis

`src/organization/analysis.ts` analyzes the saved note snapshot already used by search, retrieval, and graph features. It uses stable note IDs and emits deterministic suggestion IDs, affected note summaries, evidence, a heuristic confidence score, and an action kind. Confidence is a review-priority hint, not a calibrated probability.

- **Existing tags:** similar notes can contribute votes for tags already present in the vault. The analyzer suppresses generic tags and tags used by more than 35% of notes, and requires at least two similar supporters. Suggestions never invent a new tag.
- **Inconsistent tag spelling:** NFC/case-equivalent legacy variants are reported, but existing Markdown is not normalized automatically.
- **Duplicates:** exact duplicate bodies are identified by SHA-256. Near-duplicate candidates are generated from bounded retrieval postings, require at least four shared content terms and a token-set Jaccard score of 0.55, and are labeled as possible overlap rather than duplicates.
- **Folder ideas:** an existing folder is suggested only when at least two distinct resolved-link or content-similar peers are there. Title similarity by itself does not create a recommendation.
- **Metadata review:** only registered catalog properties are considered. A property must have valid values on at least three notes and at least 60% of the vault before missing-value suggestions appear. Invalid registered values are surfaced; arbitrary/unregistered YAML fields are not interpreted.

Candidate-pair generation is bounded to 25,000 pairs, at most 32 neighbors per note, and 500 returned suggestions. Code bodies and common terms are excluded by the existing retrieval projection. Rebuilding the organization analysis itself is a full in-memory pass; the retrieval document terms for unchanged notes are reused. Results remain derived and can be discarded and rebuilt from Markdown and the property catalog.

## Actions and state

Applying a tag recommendation requires a preview and explicit confirmation. The API refreshes the current snapshot, verifies the suggestion is still present, reads the note's current raw content hash, and uses the existing conditional tag write. A competing edit fails safely. No arbitrary frontmatter object is accepted.

Dismissed and reviewed states are versioned, browser-local, and scoped to the canonical vault path. They contain only deterministic suggestion IDs and status values, not note titles, paths, excerpts, or content. Malformed state is ignored with a visible notice. Entries no longer present in the current bounded suggestion set are pruned. This state is not backed up or portable.

Folder proposals have a read-only move preview that shows current and proposed paths and up to 100 exact incoming path-based wiki-link occurrences, with source note, line, and snippet. Title/alias and stable-ID links are excluded. The preview reports path-link counts and destination collisions. **The dashboard does not execute moves.** The legacy Phase 19 move-safe maintenance is still pending integration, and a multi-note link check plus a move is not a filesystem-wide transaction. Review the preview and use the existing move workflow only when its current behavior is acceptable; path links may otherwise break.

Dismiss, mark reviewed, open affected notes, and tag application are available from the Smart organization item in the sidebar. Refresh from disk reruns the analysis. Empty, loading, API error/retry, local-state error, and stale-action states are shown without editing notes.

## Measurements

Run `pnpm bench:organization` for the deterministic synthetic 1k/5k/10k workload. On Node 24.18.1 in the Phase 25 development environment, one observed run measured:

| Notes | Initial retrieval index | Initial organization analysis | Candidate generation | Duplicate analysis | Tag analysis | Folder analysis | One-edit retrieval rebuild | Reused docs | Full analysis after one edit | Heap delta* | RSS* |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 61.16 ms | 222.34 ms | 6.74 ms | 151.19 ms | 26.23 ms | 19.85 ms | 15.86 ms | 999 | 183.29 ms | 26.43 MiB | 157.06 MiB |
| 5,000 | 204.72 ms | 333.92 ms | 46.57 ms | 211.19 ms | 40.48 ms | 32.21 ms | 54.95 ms | 4,999 | 292.28 ms | 4.38 MiB | 281.10 MiB |
| 10,000 | 274.84 ms | 347.18 ms | 46.59 ms | 212.93 ms | 51.67 ms | 28.89 ms | 112.77 ms | 9,999 | 295.02 ms | 80.46 MiB | 355.00 MiB |

These are single in-process timings over a four-topic synthetic corpus, not service guarantees. Heap delta and RSS include fixtures and indexes, and garbage collection was uncontrolled. The 500-result output bound was reached in the 5k/10k runs. The benchmark currently measures the one-edit analysis as a full analysis pass; only the unchanged retrieval document projections are reused. Real vault content, long-document distribution, runtime load, and filesystem snapshot cost differ.

## Limitations

- Recommendations are lexical, tag, and confirmed-link based. There is no semantic model, cloud transfer, vector store, auto-merge, or automatic move.
- Tag spelling groups catch case/NFC variants, not every possible synonym or punctuation convention.
- Similarity is a token-set heuristic and may miss conceptually overlapping notes with different vocabulary.
- Metadata suggestions do not infer or apply property values.
- Folder destination previews report path links from a snapshot; they are advisory and do not lock out external editors while viewed.
- Browser-local review state does not travel with backup/export and may be cleared by the browser.
- Phase 19 move-safe link maintenance remains unintegrated.
