# Markdown note composition — M1–M3 implementation

**Status:** exploratory implementation on `feat/markdown-note-composition-m1-m3`,
based on the verified prototype commit `7b4f0bc`. No storage format, schema,
migration, roadmap or product-vision change. Nothing is merged.

## 1. Question

Can an ordinary Nodus Markdown note behave like a Notion page: prose plus
several embedded database views, each with its own saved configuration?

The answer remains yes without a new file type. A note embeds a saved view
through a standard fenced code block, and the implementation now shares data
between embeds, honours the saved layout, virtualises large tables and refuses
insertion inside literal Markdown.

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
| Invalidation | `nodus:data-changed` clears the cache and notifies mounted embeds |
| Stale fills | An invalidation bumps a generation counter; a response that started before it cannot repopulate the cache |
| Vault isolation | Changing the vault identity clears the cache and changes every key |
| Scope | One database list, one view list and one row list per database, shared by all embeds |

`ui/src/api.ts` dispatches `nodus:data-changed` after every successful non-GET
request, so a property edit, note save, view save or row creation reloads open
embeds. The runtime guard uses `globalThis`, so the UI file still type-checks
under the repository's Node-targeted root config.

Different saved views of the same database share the row load but keep their own
filters, ordered sorts and visible property lists. No HTML or arbitrary URL is
accepted from a directive; only UUIDs reach the API.

## 4. M2 — saved layout fidelity

`ui/src/embeds/embedLayout.ts` maps a `DatabaseView` to a renderer:

| Saved type | Result |
|---|---|
| `table` | Read-only table; virtualised above 50 rows |
| `list` | `ListView` with the saved group property when it exists |
| `kanban` | `KanbanView` only when `groupPropertyId` names a select property |
| `calendar` | `CalendarView` with the saved start date and optional end date, fed by the pure `projectCalendarEvents` projection |
| `gallery` | `GalleryView` |
| Unknown type or missing required setting | Explicit fallback card naming the requested layout and the reason; never a silent table |

All layouts are the existing `ui/src/DatabaseLayouts.tsx` components. Embedded
rendering passes `disabled: true` and a no-op edit handler, so a reader cannot
mutate a record from inside a note yet. Row click opens the record note through
the normal `onOpenNote` path.

Filters, ordered sorts and visible properties are applied by the existing
`selectDatabaseRows` helper before rendering, so an embed shows the same rows as
the corresponding saved view.

## 5. M3 — large datasets

The audit benchmark is an 878-row database embedded twenty times.

- **Fetch once.** Twenty embeds request one database list, one view list and one
  row payload per unique database during the cache window, instead of three reads
  per embed.
- **Virtualise.** `EmbeddedViewTable` uses the installed `@tanstack/react-virtual`
  virtualiser above 50 rows, with `overscan: 8` and a 38 px row estimate. The
  table header is sticky, the scroll region is keyboard-focusable and named, and
  spacer rows preserve scroll height and column spans.
- **No 100-row truncation.** Every matching row is reachable by scrolling; the
  badge reports the true total.
- **No pagination API.** The existing API has no cursor/limit contract for rows,
  so the smallest reliable change is one shared fetch plus windowed rendering.
  Adding pagination would require a new API contract and was out of scope.

Measured results are in §8. The payload is still one full row response per
database per cache window; the improvement is that it is no longer multiplied by
the number of embeds.

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

| Gate | Result |
|---|---|
| Root `tsc --noEmit` | pass |
| UI `tsc -p tsconfig.ui.json --noEmit` | pass |
| New M1/M2/P0 suite | 19 passed |
| Embed suite | 19 passed |
| Editor, database and preview regression (focused) | 109 passed across 5 files |
| Full repository `vitest run` | see final implementation report |
| Production build | pass (pre-existing chunk-size warning) |
| `git diff --check` | clean |

### Browser

| Scenario | Result |
|---|---|
| Six embeds in one note (three databases, six views) | 6 rendered, 0 errors |
| Table + board + calendar from the same database | Table 6 rows, board 4 columns / 6 cards, calendar November 2026 with 30 day cells |
| Request counts, six embeds | 2 database lists (app + service), 3 view lists, 3 row lists |
| Live invalidation | A property edit through `api.setNoteProperty` doubled view/row requests once and the changed cell rendered without reload |
| Twenty embeds, 878 rows (dev) | 20/20 ready in ~2 s; 1 view and 1 row request for the shared database; 360 mounted row elements instead of 2,000 |

### Performance, before → after

| Scenario | Before (audit) | After |
|---|---|---|
| 20 embeds, 878 rows, requests | 22 lists / 21 views / 21 rows | 3 lists / 2 views / 2 rows (session), 1/1/1 per fresh load |
| Rows payload | ~7 MB | 334 KB per unique database |
| Time to 20/20 | ~16 s production | ~2 s dev; production figure in final report |
| Mounted rows | 2,000 (100 per embed) | 360 (virtualised windows) |

## 9. Files

| File | Role |
|---|---|
| `ui/src/embeds/nodusView.ts` | Directive parser, serializer, view lookup |
| `ui/src/embeds/viewDataService.ts` | Shared cache, dedupe, generation-safe invalidation |
| `ui/src/embeds/embedLayout.ts` | Saved layout → renderer resolution with explicit fallback |
| `ui/src/embeds/EmbeddedDatabaseView.tsx` | Load orchestration, layout dispatch, virtualised table, error cards |
| `ui/src/editor/MarkdownPreview.tsx` | Renders `nodus-view` fences; passes vault identity |
| `ui/src/editor/EmbedViewDialog.tsx` | Picker, stale-selection fix, refusal feedback |
| `ui/src/editor/markdownCommands.ts` | Context-aware `insertNodusViewBlock` |
| `ui/src/api.ts` | Dispatches `nodus:data-changed` after non-GET success |
| `ui/src/property-value-format.ts` | Shared formatter, no database-browser import |
| `scripts/seed-note-composition-demo.mjs` | Disposable demo vault with table, board and calendar views |
| `test/markdown-composition-m1-m3.test.tsx` | Service, layout resolution and insertion context |
| `test/nodus-view-embed.test.tsx` | Parser, table rendering, large-result cap, preview integration |

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
- **Full row payload per database.** Virtualisation limits DOM work, not network
  transfer. A paginated row API would be the next step for very large databases.
- **Board and calendar settings are saved-view settings.** No per-embed override;
  create another saved view instead.
- **Filtering is the existing AND-only model.** No OR groups or joins.
- **No source-mode diagnostics.** Broken references are visible in Preview only.
- **Undo/redo and save/reopen are covered by the editor regression suite and a
  browser smoke, not by a new dedicated DOM test.**
- The full repository suite and Obsidian itself are not part of this branch's
  evidence; see the implementation report for the exact commands run.

## 12. Recommendation

This is a sound foundation for a Notion-like note in a Markdown-first product:
the persisted primitive is still a fence, the renderers and filters are the
existing database components, and the data layer is a cache rather than a second
database system. It is not production-ready. Before a phase proposal:

1. Decide the editing scope (read-only is defensible) and add an explicit
   "open database" action.
2. Add a paginated row contract or measure the real limit on large vaults.
3. Decide whether Live mode renders embeds.
4. Add source-mode diagnostics and an automated browser smoke.
5. Only then evaluate a slash command, view-name resolution and interop export.

No storage change is required for any of those steps.
