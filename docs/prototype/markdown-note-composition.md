# Markdown note composition prototype

**Status:** exploratory, uncommitted, on `feat/markdown-note-composition-prototype`.
No storage format, schema, migration, roadmap or product-vision change.

## 1. Question

Can an ordinary Nodus Markdown note behave like a Notion page: prose plus
several embedded database views, each with its own saved configuration?

The answer in this prototype is yes, without a new file type. A note embeds a
saved view through a standard fenced code block.

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
- The alternative, a new note block or dashboard resource, would touch note
  serialization, strict vault snapshots, backup manifests and import/export.

## 3. Resolution and rendering

| Step | Behaviour |
|---|---|
| Parse | `parseNodusViewDirective` validates keys and UUIDs; never throws |
| Database | `api.databases()` resolves the schema and display name |
| View | `api.databaseViews(databaseId)` must contain the referenced view id |
| Rows | `api.databaseRows(databaseId)` returns notes projected through `nodus_data` |
| Filter/sort | Reuses `selectDatabaseRows` from `ui/src/database-table.ts` with the saved view's filters and ordered sorts |
| Columns | `visiblePropertyIds` from the saved view; schema order when empty |
| Display | Reuses the shadcn `Table` primitives and the shared `formatPropertyValue`; relations render target titles, formula errors stay labelled |

Rows remain external. The note holds only the reference; no record is copied,
cached or serialised into Markdown.

Each embed is independent: it names its own view and height. The same database
can appear twice with different views, columns and sorts. In the demo note the
test-case database appears once filtered to `v1.1.1` (5 rows) and once
unfiltered (6 rows).

## 4. Insertion UX

`MarkdownToolbar` gains **Embed view**, available in Live, Source and Split
editing. It opens a dialog that lists databases, then their saved views, shows
the exact fence that will be inserted, and writes it at the cursor through the
new `insertNodusViewBlock` command. No database row is written by insertion.

If the vault has no databases, or a database has no saved view, the dialog says
so instead of inserting a broken reference.

## 5. Failure handling

| Case | Result |
|---|---|
| Malformed directive | Inline card: message, the offending source, expected syntax |
| Unknown database | Inline card: "Database not found" with the id and Retry |
| Unknown view | Inline card: names the database and the missing view id |
| Rows API failure | Inline card with the error text and Retry |
| Empty result | "No rows match this view." |
| Legacy note | Unchanged Markdown rendering |
| Ordinary code fence | Unchanged `FencedCode` rendering |

Security: only UUIDs are accepted, no URLs or HTML, all text renders through
React escaping, the directive is length-capped, and no directive can trigger a
write. `height` is clamped to a known range.

## 6. Files

| File | Role |
|---|---|
| `ui/src/embeds/nodusView.ts` | Directive parser, serializer, view lookup |
| `ui/src/embeds/EmbeddedDatabaseView.tsx` | Fetch/resolve container, presentational table, error cards |
| `ui/src/editor/MarkdownPreview.tsx` | Renders `nodus-view` fences instead of code |
| `ui/src/editor/EmbedViewDialog.tsx` | Database and view picker |
| `ui/src/editor/MarkdownToolbar.tsx` | Insertion entry point |
| `ui/src/editor/markdownCommands.ts` | `insertNodusViewBlock` command |
| `ui/src/property-value-format.ts` | Shared value formatter, moved out of `DatabasesView` so the preview chunk does not import the database browser |
| `scripts/seed-note-composition-demo.mjs` | Disposable demo vault |
| `test/nodus-view-embed.test.tsx` | Parser, presentational table, preview integration |

`DatabasesView.tsx` keeps its exported `formatPropertyValue` by re-export, so
existing imports are unchanged.

## 7. Demo

```bash
node scripts/seed-note-composition-demo.mjs /tmp/nodus-composition-demo
NODUS_VAULT=/tmp/nodus-composition-demo \
NODUS_PREFERENCES_PATH=/tmp/nodus-composition-prefs.json \
NODUS_ALLOWED_ORIGINS=http://127.0.0.1:5173 \
  pnpm dev
```

Open `/app`, then **Demo → Note composition**. Choose **Preview** (or Split) in
the rendering-mode control: the Live editor shows the fence text, the preview
renders the views. **Embed edge cases** contains the malformed, missing-database,
missing-view and ordinary code-fence cases.

The seed writes three databases, four saved views and sixteen row notes. It
refuses to overwrite an existing vault.

## 8. Evidence

| Gate | Result |
|---|---|
| Root and UI TypeScript | pass |
| `test/nodus-view-embed.test.tsx` | 20 passed |
| Editor, databases and formula regression suites | 187 passed across 6 files |
| Production build | pass |
| Browser: four embeds in one note | 4 rendered, 0 errors, 0 page errors |
| Browser: filtered view | 5 of 6 rows, `v1.1.0` excluded |
| Browser: independent views | two renders of one database, different columns and counts |
| Browser: malformed / missing database / missing view | three distinct cards |
| Browser: insertion | database and view pickers, fence inserted, note saved through the normal path |
| `git diff --check` | clean |

## 9. Limitations

- **Preview only.** Live mode shows the fence; embeds render in Preview and Split.
- **No caching.** Each mount performs three API reads; several embeds repeat the
  database list request. A shared cache keyed by vault and database is the next step.
- **Row cap, no virtualization.** The table renders at most 100 rows and says so.
  A 878-row database needs the virtualiser used by `DatabasesView`.
- **Read-only.** No inline edit, row creation, view switching or opening the full
  database from the embed header.
- **View configuration is the saved view.** Per-embed column overrides are not
  supported; copy a view instead.
- **Filtering is the existing AND-only filter model.** No cross-database joins,
  no OR groups.
- **No slash command or paste detection.** Insertion is a toolbar dialog.
- Full repository suite not run; focused suites above were.
- `node_modules` is a symlink to another worktree because the pinned pnpm cannot
  install on this host; it is a review artefact and must be removed before a commit.

## 10. Recommendation

Keep this as the generic primitive. A Notion-like page is now a normal note plus
fenced view references, not a new screen. Before proposing it for a phase:

1. Add a shared view cache and virtualise the embedded table.
2. Add a source-mode diagnostic for broken references, not only preview cards.
3. Decide whether Live mode should render embeds (needs a CodeMirror widget).
4. Add an "open database" action on the embed header.
5. Only then evaluate a slash command and view-name resolution.

No storage change is required for any of those steps.
