# Structured-data performance and bundle baseline

Measured on 2026-10-28 against the current Milestone 3.1 working tree, based on
`2921a7f`. These are local observations, not latency guarantees or CI thresholds.
No dependencies, production search/index/storage changes, or chunking changes
were required.

## Database row endpoint

```sh
pnpm bench:databases
# Optional independent experiment:
NODUS_ROWS_BENCH_SIZES=1000,10000 NODUS_ROWS_BENCH_ITERATIONS=5 NODUS_ROWS_BENCH_WARMUPS=1 pnpm bench:databases
```

Node v24.18.1, pnpm 11.9.0, macOS/Darwin 24.6.0, x64, Intel Core i5-8257U
1.40 GHz, eight logical CPUs. The benchmark uses the real local HTTP middleware
and filesystem vault, binding a dedicated ephemeral loopback port per size.
It closes its own server and removes only its own `mkdtemp` vault in `finally`,
including on failure. It never uses `NODUS_VAULT` or an existing server.

The deterministic workload has 20 folders, two database definitions, and bodies
with 1–6 paragraphs, Unicode, and wiki links. Thirty percent of notes belong to
the requested database, 20% to another database, and 50% have no `nodus_data`
(30% of all notes are plain Markdown). Member notes have text and finite-number
properties. The generated Markdown totals 601,047 bytes at 1,000 notes and
6,061,347 bytes at 10,000. This is a small-note workload, not a large-body or
diagnostic-heavy stress test.

All returned note IDs, text values, hash formats, and the empty diagnostic list are
checked. HTTP latency includes the complete response and JSON decoding;
assertions run outside that interval. Each size has a separate first request,
one warmup, five uninstrumented measured requests, then one instrumented request.
The Node process is retained; file generation already touched the data and OS
cache and system load are uncontrolled. None of these measurements is called cold-cache latency.

| Notes | Rows | First request ms | Median ms | p95 ms | Min–max ms |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 300 | 585.95 | 454.10 | 783.77 | 439.94–783.77 |
| 10,000 | 3,000 | 4,460.21 | 5,163.75 | 6,174.15 | 4,634.65–6,174.15 |

The p95 uses nearest rank; with five samples it is the maximum. The script prints
all samples and environment metadata as JSON as well as a summary table. Sizes,
warmups, and repetitions are configurable; no machine-dependent timing assertions
are used.

The separately instrumented request wraps the actual `snapshot`, `parseNote`,
and `projectNoteProperties` functions without replacing their behavior:

| Notes | Snapshot inclusive ms | Parsing inside snapshot ms | Second route parse ms | Projection ms | Snapshot / route parse calls |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 545.96 | 173.65 | 162.03 | 3.61 | 1,000 / 1,000 |
| 10,000 | 3,234.91 | 1,271.06 | 1,119.31 | 16.56 | 10,000 / 10,000 |

Snapshot time includes its parsing, filesystem walks/reads/path validation,
buffer copying, and lock acquisition/release. Do not add the snapshot parsing
column to snapshot time. Instrumentation adds timer/spy overhead and this is a
single separate request; do not subtract these figures from the normal latency
samples or claim a guaranteed speedup.

The count assertions verify that the endpoint parses each note twice: first in
`FileSystemVault.snapshot()` and again when constructing row projections. Median
latency grew about 11.4× for 10× as many small notes. Projection is much smaller
than parsing and the snapshot work in this experiment. The snapshot is wrapped
by the root lock; this benchmark does not simulate competing writers or measure
their contention behavior.

**Recommended next investigation:** reuse parsed notes from a coherent snapshot
without weakening its raw-byte hash or locking contract, then compare the same
workload. Inspect traversal/path-validation cost afterward. These measurements
do not justify a persistent index, cache, pagination policy, or lock redesign by
themselves. No such optimization is included here.

## Frontend bundle

```sh
pnpm analyze:bundle
```

This runs the existing Vite production configuration with hidden source maps and
an explicitly checked, unique output directory outside the repository. It keeps
the build and `report.json` in that temporary directory for inspection, and prints
the exact location. A failed run removes only its own temporary directory.
`dist/` is never an output target. The JSON contains all module/package entries
and static/dynamic chunk relationships.

The measured build contains one initial JS chunk: **1,013,827 bytes raw**, and
**327,210 bytes gzip** using Node zlib level 6. Vite's own reporter estimates
330.42 kB gzip using its compressor; those estimates are not mixed with the
script's measurements. CSS is 71.73 kB raw / 12.69 kB in the Vite report. Hidden
maps add separate analysis files without adding a source-map URL to the JS.

The analyzer assigns generated UTF-8 byte spans between source-map segments to
their mapped source modules, keeping unmapped spans explicit and checking that
the complete chunk is accounted for. This measures minified emitted spans;
attribution is approximate at module boundaries and is not an exact measure of
the bytes that removing a module would save. Module gzip sizes would not be
additive, so only complete chunks are compressed.

| Contributor | Attributed JS bytes | Share of initial JS |
|---|---:|---:|
| CodeMirror + Lezer packages | 488,523 | 48.2% |
| React DOM | 207,420 | 20.5% |
| Application modules | 131,282 | 12.9% |
| Radix packages | 82,517 | 8.1% |
| `cn` | 26,044 | 2.6% |
| Lucide | 10,843 | 1.1% |
| React | 8,132 | 0.8% |

Largest individual mapped sources:

| Source | Attributed bytes |
|---|---:|
| React DOM client production | 203,449 |
| `@codemirror/view` | 151,077 |
| `@lezer/javascript` | 77,770 |
| `@codemirror/state` | 46,842 |
| `@lezer/markdown` | 36,285 |

`DatabasesView.tsx` accounts for 18,942 attributed bytes; `SettingsView.tsx` and
`BackupRestoreSection.tsx` together account for 20,115. Their dependencies overlap
other UI, so lazily loading only these secondary screens would provide a modest
reduction compared with the editor packages. React DOM remains required for the
app shell. No YAML package is present in the measured client chunk.

`App.tsx` imports every view eagerly and renders `Editor` on the default Notes
section, even before a note is active. Deferring the CodeMirror component until
there is an active note could materially reduce the shell's initial transfer;
the approximately 48% attribution above is a candidate budget, not a measured
lazy-build delta. A user immediately opening a note would still need those bytes.
Any follow-up must measure its actual split output and preserve editor state,
focus, autosave, and loading behavior. No lazy loading or manual chunking was
implemented for this baseline.

## Accessibility check

Add note now uses a label containing only its search input, followed by an
ordinary named list of shadcn buttons. Buttons expose the selected candidate with
`aria-pressed` and use native Tab/Enter/Space operation rather than claiming a
listbox keyboard model. The existing Chromium smoke suite checks input → candidate
→ property-chooser Tab order, Enter selection, focus retention, and the absence
of a label ancestor on the candidate button. Screen-reader testing has not been
performed.
