# Task management

Nodus derives tasks from ordinary Markdown checklist items. There is no task
database, no hidden task state, and no second source of truth. Completing a task
changes one character in the note's Markdown checkbox marker.

## Markdown task syntax

Tasks use GFM task-list syntax inside Markdown list items:

```md
- [ ] Incomplete task
- [x] Completed task
- [X] Also completed

- [ ] Parent task
  - [ ] Nested child
    1. [x] Nested ordered task
```

Supported forms:

- Bullet and ordered lists.
- Nested lists; parent/child relationships are derived from the list tree.
- Tasks inside blockquotes.
- Multiple tasks in one note.
- Empty labels.
- `[ ]`, `[x]`, and `[X]` markers.

Not treated as tasks:

- Checkbox-like text inside fenced code blocks.
- Checkbox-like text inside inline code.
- A bare `[ ]` outside a Markdown list item.

GFM permits one task marker per list item. Multiple inline checkbox-like
tokens on one line are not separate tasks. The task view documents this
limitation rather than inventing a second parser.

### Due dates and priorities

Recognized metadata is deliberately visible, portable text at the end of a task
label:

```md
- [ ] Send the report [due:2026-11-10] [priority:high]
- [ ] Review notes [priority:low] [due:2026-11-11]
```

Rules:

- Keys and priority values are case-insensitive.
- Priority is `high`, `medium`, or `low`.
- Due dates must be real `YYYY-MM-DD` calendar dates.
- Only one trailing due token and one trailing priority token are recognized.
- The tokens remain in the Markdown source. The dashboard removes recognized
  tokens from its display label only.
- Invalid or non-trailing tokens remain part of the task text and do not break
  extraction.
- Existing tasks without metadata continue to work unchanged.

This is a Nodus convention, not a universal Markdown standard. Other Markdown
editors will show the tokens as ordinary visible text. No hidden frontmatter or
sidecar task record is introduced.

## Extraction architecture

`src/tasks/extract.ts` uses the same `@lezer/markdown` GFM grammar that powers
the editor's Markdown parsing:

- The GFM task extension creates `Task` and `TaskMarker` nodes.
- Fenced code, inline code, and ordinary bracketed text are excluded by the
  grammar itself.
- Each task retains the note's stable ID and title/path, raw and display text,
  completion state, 1-based line, source offsets, list depth, parent task ID,
  nearest heading, due date, and priority.
- Task IDs are derived from the note ID, line, and display text. They are
  projection-local values, never persisted.
- Ordering is deterministic: note path, source line, then ID.

The vault projection is rebuilt from the shared Markdown knowledge snapshot.
`snapshotNotesWithHashes()` supplies the raw note hashes required for safe task
updates. The projection is built lazily on the first Tasks request, so search,
graph, and database views do not pay task-parsing cost. Unchanged notes reuse
their previous extraction when the vault snapshot is rebuilt after a note edit.

The projection is bounded at 50,000 tasks. Counts cover all extracted tasks; if
the bound is exceeded, the response marks itself truncated. The UI initially
renders 200 matching rows and offers **Show more**, so a large projection does
not create 30,000 DOM rows at once.

## Dashboard

The **Tasks** navigation view provides:

- All, open, and completed filters with counts.
- Client-side text filtering and folder filtering.
- Sorting by document order, note title, status, or due date.
- Grouping by note, folder, status, or due-date bucket.
- Source note, heading, line, due date, and priority context.
- Loading, empty, no-match, truncated, error, and retry states.
- A checkbox that completes or reopens the task in place.
- A source link that opens the note at the task's line.

Filters and grouping are client-side over the already loaded projection. No
additional API request is made for ordinary filtering. The existing global
search continues to index Markdown note bodies, including task descriptions;
tasks do not introduce a second search index.

## Update safety

`PUT /api/notes/:id/tasks/toggle` performs an explicit source edit:

1. Read the current note by stable ID and its raw SHA-256 hash.
2. Require the projection's `baseHash`; a mismatch returns HTTP 409
   `STALE_WRITE` and writes nothing.
3. Re-extract tasks from the current Markdown and locate the requested task ID.
4. Verify that the marker at its recorded offsets is still exactly `[ ]`,
   `[x]`, or `[X]`.
5. Change only the character inside that marker.
6. Replace the note through the existing conditional vault write using the
   current hash and root lock.
7. Mark the derived projections dirty and return the updated task and note.

This makes duplicate task text safe because the projection identity includes the
source line and the server verifies the current source marker. A renamed or
moved note is still opened by stable note ID; if its content changed, the hash
check returns a conflict instead of applying a stale line offset. A deleted note
returns not found. Concurrent external edits produce a conflict, never a silent
overwrite.

The full note body is preserved except for the selected marker. Nodus-format
frontmatter follows the existing save/serialization policy; task operations do
not add or remove frontmatter fields.

## Scope and limitations

- No separate task persistence, task database, or task-specific file format.
- No assignees, task dependencies, recurrence, WIP limits, timeline, or project
  boards in this phase.
- No metadata beyond the documented trailing due/priority tokens.
- No task creation form; tasks are authored as Markdown checkboxes.
- No persistent saved task filters or per-task comments.
- Multiple checkbox-like tokens on one line are not separate tasks.
- Task text is displayed as plain text; inline Markdown markers remain visible
  in the dashboard label.
- Counts remain complete when the projection is truncated, but only the first
  50,000 tasks are returned.
- Filters and grouping are session-local; they do not change note content.

## Performance observations

Local Node `v24.18.1`, one in-process run per size, synthetic notes with three
tasks each. These are observational measurements, not service-level guarantees.
The update measurement covers the source-marker rewrite and re-extraction only;
it excludes filesystem latency and React rendering.

| Notes | Tasks | Extract | Build projection | Warm filter | Warm sort | Warm group | One-edit rebuild | Toggle + re-extract |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 3,000 | 121.43 ms | 89.32 ms | 2.44 ms | 1.27 ms | 0.55 ms | 3.09 ms | 0.28 ms |
| 5,000 | 15,000 | 367.29 ms | 344.79 ms | 9.61 ms | 4.62 ms | 1.84 ms | 9.02 ms | 0.19 ms |
| 10,000 | 30,000 | 702.12 ms | 690.96 ms | 18.82 ms | 7.35 ms | 4.60 ms | 19.64 ms | 0.15 ms |

Memory measurements from the same run: RSS 80.68 MiB, 146.44 MiB, and 247.18
MiB respectively, including fixtures and indexes. The task projection is built
lazily rather than during every search or graph refresh.

## Verification

Focused commands:

```sh
pnpm exec vitest run test/tasks-extract.test.ts test/task-view.test.ts test/ui-tasks-api.test.ts test/ui-tasks-view.test.tsx
pnpm test:tasks
pnpm bench:tasks
```

Full verification follows the repository's standard serial test, typecheck,
build, browser, search, editor, vault, database, graph, and discovery commands.
