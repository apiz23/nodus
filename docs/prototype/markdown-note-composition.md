# Markdown note composition — M1–M3 implementation

**Status:** exploratory implementation on `feat/markdown-note-composition-m1-m3`,
based on the verified prototype commit `7b4f0bc`. No storage format, schema,
migration, roadmap or product-vision change. Nothing is merged.

## 1. Question

Can an ordinary Nodus Markdown note behave like a Notion page: prose plus
several embedded database views, each with its own saved configuration?

The answer remains yes without a new file type. A note embeds a saved view
through a standard fenced code block, and the implementation shares data
between embeds, honours the saved layout, virtualises large tables, bounds
board/gallery/calendar previews and refuses insertion inside literal Markdown.

## 2. Syntax

````markdown
```nodus-view
database: 33333333-3333-4333-8333-333333333333
view: cccccccc-cccc-4ccc-8ccc-ccccccccccc1
height: 320
```
````

- `database` and `view` are required lowercase UUID v4 identifiers.
- `height` is optional, integer pixels, 160–1200, default 320.
- Unknown keys, duplicate keys, malformed values, missing keys and bodies over
  2048 characters are rejected with an inline error card.
- The directive is plain text. Other Markdown readers show a code block, and
  an older Nodus build renders it through the unchanged `FencedCode` path.

Why a fence instead of `:::nodus-view`:

- Lezer's Markdown parser already produces `FencedCode` with a `CodeInfo`
  language token; `:::` is not GFM and would need custom block parsing in both
  the preview and the editor.
- Fences degrade safely, survive copy/paste, and need no format version.
- A new note block or dashboard resource would touch note serialization, strict
  vault snapshots, backup manifests and import/export.

## 3. M1 — shared view data service

`ui/src/embeds/viewDataService.ts` is a small read-through cache in front of the
existing API. It does not add a storage layer.

| Property | Behaviour |
|---|---|
| Key | `(vault identity, resource kind, database id)`; the database list is keyed per vault |
| Deduplication | Concurrent callers receive the same in-flight promise |
| Cache | Successful values live for 30 s; a second embed inside that window performs no request |
| Failure | A rejected load is removed immediately, so Retry can succeed |
| Invalidation | A non-GET response carries the cache scope it affects (`rows`, `views`, `database` or `all`) |
| Coalescing | Notifications raised in one task are merged, so a burst of writes reloads an embed once |
| Expiry | Every read sweeps expired entries; the cache is also bounded to 32 resources, oldest first |
| Stale fills | An invalidation bumps a generation counter; a response that started before it cannot repopulate the cache |
| Vault isolation | Changing the vault identity clears the cache and changes every key |
| Scope | One database list, one view list and one row list per database, shared by all embeds |

`ui/src/embeds/viewDataInvalidation.ts` maps each successful mutation to its
scope. A note save invalidates row payloads only, so open saved views keep their
cached definitions; a database schema write invalidates that database's views and
rows; view writes invalidate only that database's view list; tag, preference,
attachment, backup, task and catalog writes invalidate nothing. Unknown
mutations stay conservative and clear everything. `ui/src/api.ts` dispatches
`nodus:data-changed` with that scope, and a same-origin event without a
recognised detail also clears everything.

Cross-tab and external freshness policy: the cache is not event-driven for
filesystem edits or another browser tab. Those changes are bounded by the 30 s
TTL (and by the 32-entry bound); Nodus does not add a broadcast channel, file
watcher or polling contract here. Rows are shared per database while each saved
view keeps its own filters, ordered sorts and visible properties. No HTML or
arbitrary URL is accepted from a directive; only UUIDs reach the API.

## 4. M2 — saved layout fidelity

`ui/src/embeds/embedLayout.ts` maps a `DatabaseView` to a renderer:

| Saved type | Result |
|---|---|
| `table` | Read-only table; virtualised above 50 rows |
| `list` | `ListView` with the saved group property when it exists (already windowed) |
| `kanban` | `KanbanView` only when `groupPropertyId` names a select property; **bounded preview** |
| `calendar` | `CalendarView` with the saved start date and optional end date; undated events capped |
| `gallery` | `GalleryView`; **bounded preview** |
| Unknown type or missing required setting | Explicit fallback card naming the requested layout and the reason; never a silent table |

All layouts are the existing `ui/src/DatabaseLayouts.tsx` components. Embedded
rendering passes `disabled: true` and a no-op edit handler, so a reader cannot
mutate a record from inside a note yet. Row click opens the record note through
the normal `onOpenNote` path.

Board and gallery are **experimental previews**, not full parity. They render at
most 60 cards (`ui/src/embeds/embedLimits.ts`); a board also draws at most 12
columns and shares its 60-card budget across them. The preview states the exact
subset and says to open the database for the full view. The database browser
itself keeps its unbounded rendering; the caps only apply to embeds. A calendar
preview caps undated events at 50. This is a deliberate cap, not a virtualiser:
these three layouts do not yet have a scroll window.

Filters, ordered sorts and visible properties are applied by the existing
`selectDatabaseRows` helper before rendering, so an embed shows the same rows as
the corresponding saved view. Board grouping remains Select-only; other group
properties produce the explicit unsupported card rather than a misleading board.

## 5. M3 — large datasets

The table path was already bounded; board, gallery and calendar embeds were not.
The audit measured 20 board embeds over 1,000 rows at 20,000 cards and 140,500
DOM nodes, with the browser unresponsive. The fix is an explicit, test-covered
rendering cap, not a partial virtualiser.

- **Fetch once.** Twenty embeds request one database list, one view list and one
  row payload per unique database during the cache window.
- **Virtualise tables.** `EmbeddedViewTable` uses `@tanstack/react-virtual` above
  50 rows (`overscan: 8`, 38 px estimate). Every matching row stays reachable by
  scrolling; the badge reports the true total.
- **Bound boards.** 60 cards total across at most 12 columns; each truncated
  column shows "Showing N of M cards", and the embed footer states the subset.
- **Bound galleries.** 60 cards, with a "Gallery preview: showing N of M cards"
  footer.
- **Bound calendars.** All rows are still projected by `projectCalendarEvents`,
  but the undated list renders at most 50 events and says so.
- **No pagination API.** The existing API has no cursor/limit contract for rows,
  so the smallest reliable change is one shared fetch plus bounded rendering.
  Adding pagination would require a new API contract and was out of scope.

The row payload is still one full response per database per cache window
(≈443 KB for 1,000 rows in the benchmark); the improvement is that it is no
longer multiplied by the number of embeds, and DOM work is bounded.

## 6. Insertion UX and P0

`MarkdownToolbar` gains **Embed view**, available in Live, Source and Split
editing. The dialog lists databases, then their saved views, previews the exact
fence and inserts it through `insertNodusViewBlock`.

P0 behaviour:

| Cursor context | Result |
|---|---|
| Normal paragraph | Block inserted after the current line; prose is not split |
| Inside a fenced code block | Refused; note unchanged, dialog explains why |
| Inside a table cell or inline code | Refused |
| Immediately before a fence | Inserted before the fence, never inside it |
| Immediately after a fence | Inserted after it |
| Document end | Inserted at the end |
| Selection spanning lines | Selection text is preserved; block is inserted before it |
| Multiple existing embeds | No special case; the guard is context-based |

The command reuses the same `ancestor` guard pattern as other Markdown commands.
Switching databases in the picker clears the stale view id and disables Insert
while views load, closing the race identified by the audit.

The picker's states live in `ui/src/editor/embedPickerState.ts` and are driven by
a reducer. "Loading saved views", "this database has no saved view" and "could
not load saved views" are now separate deterministic states: the empty message
appears only after a successful empty response, and a failed database load is
never reported as an empty vault. Tests cover initial loading, empty, failure,
retry, selection and database switching.

## 7. Failure handling

| Case | Result |
|---|---|
| Malformed directive | Inline card: message, offending source, expected syntax |
| Unknown database | Inline card: "Database not found" with id and Retry |
| Unknown view | Inline card: names the database and the missing view id |
| API failure | Inline card with the error text and Retry; failure is not cached |
| Empty result | "No rows match this view." |
| Unsupported layout | Fallback card naming the requested layout and reason |
| Legacy note | Unchanged Markdown rendering |
| Ordinary code fence | Unchanged `FencedCode` rendering |

No directive can trigger a write. The note body is the only value insertion
changes, through the normal editor transaction and save path.

## 8. Evidence

Environment: Node 24.22.2, Vite 8.3.5, macOS, production preview for benchmarks.

### Automated

Commands were run in the PR worktree with the repository's installed
`node_modules`. Exit codes were captured directly.

| Gate | Command | Exit | Result |
|---|---|---|---|
| Root TypeScript | `npx tsc --noEmit` | **0** | pass |
| UI TypeScript | `npx tsc -p tsconfig.ui.json --noEmit` | **0** | pass (now includes the new `.tsx` tests) |
| Focused composition, editor and database suites | `vitest run … --maxWorkers=1` | **0** | 216 passed across 13 files |
| New suites only | `vitest run test/markdown-embed-limits.test.tsx test/view-data-invalidation.test.tsx test/embed-picker-state.test.tsx test/editor-vault-identity.test.tsx test/editor-preview-prop.test.tsx --maxWorkers=1` | **0** | 40 passed |
| Native executor lock | `npm run build:executor-lock` | **0** | `executor_lock.node` built |
| Full suite, serial (final head) | `vitest run --maxWorkers=1` | **1** | 1,841 passed, 1 skipped; one unrelated `storage-backup` timeout. That file passes alone (58 passed) |
| Full suite, rerun of the noisy files | 16 files, `--maxWorkers=1 --testTimeout=30000` | **0** | 216 passed, 1 skipped (one templates test needed a 60 s timeout when run alone; it passes) |
| Full suite, default parallel (final head) | `vitest run` | **1** | 1,744 passed, 91 failed, 1 skipped across 24 files; 64 timeouts, one cleanup `ENOTEMPTY`, one worker-start error (`ui-property-api`). No composition, editor or database-UI file failed; the affected storage/sync/plugin files pass serially |
| Production build | `npm run build` | **0** | pass (pre-existing chunk-size warning) |
| Whitespace | `git diff --check` | **0** | clean |

The full parallel suite is not green in this environment: filesystem-heavy
storage, sync and plugin tests time out at the default 5 s and one cleanup step
races with `ENOTEMPTY`. The same classes of failure were reported for the
untouched baseline in the independent review. They are environment/concurrency
failures, not assertions in this change, but the suite is not described as
passing.

### Browser

| Scenario | Result |
|---|---|
| Six embeds in one note (three databases, six views) | 6 rendered, 0 errors |
| Table + board + calendar from the same database | Table 6 rows, board 4 columns / 6 cards, calendar November 2026 with 30 day cells |
| Request counts, six embeds | 2 database lists (app + service), 3 view lists, 3 row lists |
| Live invalidation | A property edit through `api.setNoteProperty` reloads the affected database's rows once; unrelated note/preference writes no longer clear views |
| Twenty embeds, 878 rows (dev) | 20/20 ready in ~2 s; 1 view and 1 row request for the shared database; 360 mounted row elements instead of 2,000 |

### Performance, before → after (1,000 records)

Measured with `scripts/benchmark-embed-layouts.mjs` in Chromium 131 (headless),
1320×900, dev server, one fresh page per scenario. "Before" is PR head
`9a749bd` (unbounded board/gallery); "after" is this change.

| Scenario | Before render | Before cards | Before DOM | After render | After cards | After DOM |
|---|---|---|---|---|---|---|
| 1 board × 1,000 | 1,349 ms | 1,000 | 10,534 | 997 ms | 50 | 1,042 |
| 20 boards × 1,000 | 13,095 ms | 20,000 | 201,284 | 1,356 ms | 1,000 | 11,449 |
| 1 gallery × 1,000 | 1,031 ms | 1,000 | 11,510 | 413 ms | 60 | 1,172 |
| 20 galleries × 1,000 | 12,699 ms | 20,000 | 220,804 | 1,286 ms | 1,200 | 14,049 |
| Mixed table + board + gallery | 1,832 ms | 2,000 | 21,704 | 443 ms | 110 | 1,879 |

Responsiveness after mount (two animation frames plus card measurement) stayed
at 19–29 ms / ≤ 4.3 ms in every after scenario. Chromium reported ≈76.6 MB of
used JS heap in every scenario (a coarse page-level figure; it did not separate
the scenarios meaningfully, so DOM nodes and mounted cards are the comparable
signals). Each scenario made one row request (≈443 KB); the 20-embed cases still
fetch once, not twenty times, and the mounted card count per embed is fixed by
the cap rather than the row count.

The table path from the earlier audit (20 embeds × 878 rows) mounted 360 rows
instead of 2,000; that behaviour is unchanged.

## 9. Files

| File | Role |
|---|---|
| `ui/src/embeds/nodusView.ts` | Directive parser, serializer, view lookup |
| `ui/src/embeds/viewDataService.ts` | Shared cache, dedupe, scoped/coalesced invalidation, expiry and bounds |
| `ui/src/embeds/viewDataInvalidation.ts` | Pure mutation → cache-scope mapping |
| `ui/src/embeds/embedLimits.ts` | Board, gallery and calendar preview bounds |
| `ui/src/embeds/embedLayout.ts` | Saved layout → renderer resolution with explicit fallback |
| `ui/src/embeds/EmbeddedDatabaseView.tsx` | Load orchestration, layout dispatch, virtualised table, bounded layouts, error cards |
| `ui/src/editor/MarkdownPreview.tsx` | Renders `nodus-view` fences; passes vault identity |
| `ui/src/editor/EmbedViewDialog.tsx` | Picker, stale-selection fix, refusal feedback |
| `ui/src/editor/embedPickerState.ts` | Deterministic picker reducer and placeholders |
| `ui/src/editor/markdownCommands.ts` | Context-aware `insertNodusViewBlock` |
| `ui/src/api.ts` | Dispatches `nodus:data-changed` with the affected cache scope |
| `ui/src/property-value-format.ts` | Shared formatter, no database-browser import |
| `scripts/seed-note-composition-demo.mjs` | Disposable demo vault with table, board and calendar views |
| `scripts/benchmark-embed-layouts.mjs` | 1,000-row board/gallery/mixed embed benchmark |
| `test/markdown-composition-m1-m3.test.tsx` | Service, layout resolution and insertion context |
| `test/nodus-view-embed.test.tsx` | Parser, table rendering, large-result cap, preview integration |
| `test/markdown-embed-limits.test.tsx` | Board, gallery and calendar bounds at 1,000 rows |
| `test/view-data-invalidation.test.tsx` | Scoped invalidation, coalescing, expiry, vault isolation |
| `test/embed-picker-state.test.tsx` | Picker loading, empty, failure and selection states |
| `test/editor-vault-identity.test.tsx` | Editor-level `vaultIdentity` host marker |
| `test/editor-preview-prop.test.tsx` | Editor forwards `vaultIdentity` to the preview component |

## 10. Demo

```bash
node scripts/seed-note-composition-demo.mjs /tmp/nodus-composition-demo
NODUS_VAULT=/tmp/nodus-composition-demo \
NODUS_PREFERENCES_PATH=/tmp/nodus-composition-prefs.json \
NODUS_ALLOWED_ORIGINS=http://127.0.0.1:5173 \
  pnpm dev
```

Open `/app`, then **Demo → Note composition**. Choose **Preview** or Split: Live
shows the fence text. The note contains a documentation table, a bug table, two
test-case tables with different filters and columns, a board and a calendar.
**Embed edge cases** contains malformed, missing-database, missing-view and
ordinary code-fence cases.

The seed writes three databases, six saved views and sixteen row notes. It
refuses to overwrite an existing vault.

## 11. Limitations

- **Preview/Split only.** Live mode still shows the fence; a CodeMirror widget
  would be a separate change.
- **Read-only.** No inline property edit, row creation, view switcher or
  "open database" action in the embed header.
- **Board and gallery are bounded previews, not virtualised.** At most 60 cards
  (12 board columns) render per embed, and the embed states the subset. This
  keeps twenty embeds responsive but means the embed is not a complete record
  browser; the database view remains the authoritative surface. Virtualising
  these layouts is the next step if full previews are required.
- **Calendar preview caps undated events at 50.** Dated events still use the
  existing day preview/overflow model.
- **Full row payload per database.** Bounded rendering limits DOM work, not
  network transfer (≈443 KB per 1,000 rows). A paginated row API would be the
  next step for very large databases.
- **Board and calendar settings are saved-view settings.** No per-embed override;
  create another saved view instead.
- **Filtering is the existing AND-only model.** No OR groups or joins.
- **No source-mode diagnostics.** Broken references are visible in Preview only.
- **Cross-tab and external edits are TTL-bounded.** There is no broadcast or file
  watcher for embedded-view data; the cache expires after 30 s.
- **Undo/redo and save/reopen are covered by the editor regression suite and a
  browser smoke, not by a new dedicated DOM test.**
- The full parallel repository suite is not green in this environment; storage,
  sync and plugin files time out under load and pass serially. The exact results
  are in §8.

## 12. Recommendation

This is a sound foundation for a Notion-like note in a Markdown-first product:
the persisted primitive is still a fence, the renderers and filters are the
existing database components, and the data layer is a cache rather than a second
database system. It is not production-ready. Before a phase proposal:

1. Decide the editing scope (read-only is defensible) and add an explicit
   "open database" action.
2. Replace the board/gallery card caps with real virtualisers before claiming
   full embedded-view parity, then add a paginated row contract or measure the
   real limit on large vaults.
3. Decide whether Live mode renders embeds.
4. Add source-mode diagnostics and an automated browser smoke.
5. Only then evaluate a slash command, view-name resolution and interop export.

No storage change is required for any of those steps.
