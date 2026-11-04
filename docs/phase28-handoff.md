# Phase 28 accepted handoff

**Status: COMPLETE / ACCEPTED.** The project owner formally accepted Phase 28 — Calendar & Timeline on **2026-11-04**. The [official roadmap](ROADMAP.md#phase-28--calendar--timeline) remains authoritative. The historical review notes below preserve earlier statuses and are superseded by this acceptance record.

## Final implementation scope

Month Calendar provides aligned date cells, month/Today navigation, selected/current date indicators, overflow inspection and a selected-day agenda. Week displays seven days beginning Sunday; Day focuses the selected date. Switching presentations preserves selected-date context. Completed and incomplete tasks coexist with database events, and missing or invalid dates remain accessible in Undated.

Timeline is the accepted **bounded month-card overview**, using the same event projection and date semantics. It has date cards, month navigation, overflow inspection and source navigation. It does not implement a scaled date axis, zoom or arbitrary-range selection; those are deferred improvements.

Strict Gregorian `YYYY-MM-DD` values represent dates without timezone conversion. Ranges require a start; optional ends are inclusive, and a missing end produces a valid single-day event. Invalid dates and reversed ranges remain diagnostic/Undated events. See the [temporal contract](temporal-contract.md) and [database views](database-views.md).

Saved views retain the v3 envelope. Legacy `datePropertyId` configurations remain single-day Calendars; `startDatePropertyId` plus optional `endDatePropertyId` supports ranges. Existing serialization, templates and portable/backup boundaries remain compatible.

Database edits validate persisted Calendar configuration, property types, range ordering and note/view hashes under the vault lock; configured endpoints are written atomically. Task scheduling reloads and re-extracts current Markdown before a conditional write. Stale revisions fail without overwriting newer content. Explicit dialogs provide validation, pending, cancel and conflict states; projections refresh after confirmed writes.

Markdown remains authoritative. `[scheduled:YYYY-MM-DD]` places a task; `[due:YYYY-MM-DD]` remains independent metadata. Scheduling preserves completion, priority, continuation paragraphs, nested tasks and unrelated content. Invalid or duplicate scheduling metadata is rejected visibly. No task sidecar or event store exists.

Source navigation uses note UUIDs rather than resolving stale titles or paths. Unavailable sources show errors and clear the editor without opening another note or creating a replacement. Browser fixtures verify deletion after projection, unavailable/stale identities, note counts and unchanged content hashes. Request-generation/active-instance guards prevent obsolete responses from replacing newer results or changing current loading/error state. Deterministic browser gates verify newer success before older success/failure, date/month context, current-request errors and Retry. Empty states remain distinct from errors.

## Final verification evidence

These are the completed implementation verification results; this acceptance task runs documentation checks only.

- Node: **24.18.1**.
- Focused Calendar/source tests: **5 files, 28 tests passed**.
- Full suite: **125 files, 1,271 tests passed**.
- Playwright database-view smoke: **passed**.
- Typecheck: **passed**.
- External Vite build: **passed**; `/private/tmp/nodus-phase28-source-response.4fOTai/index.html` verified.
- `git diff --check` and `git diff --cached --check`: **passed**.

## Known limitations and deferred improvements

Timed events, timezone conversion, drag-to-reschedule and scaled-axis Timeline features are outside the accepted scope. Date editing uses explicit dialogs. Calendar/Timeline are bounded projections rather than a new persistence system; no new performance guarantee is claimed. Calendar note creation remains two operations with retained-note/retry recovery if date assignment fails. Vite retains its large App chunk warning.

The historical build incident overwrote ignored repository `dist/` assets; original bytes remain unrecovered. Acceptance does not claim restoration. Future builds must use a fresh external directory and verify its `index.html`.

Phase 27 PR #16 (`331bce0`) remains integrated in cached `origin/main`. The cached `2231a30` task-description wrapping follow-up is not counted as integrated; existing Phase 27 integration evidence is preserved below.

## Phase 29 starting point — Advanced Import & Export

**PLANNED / NOT STARTED.** Follow the [existing Phase 29 roadmap definition](ROADMAP.md#phase-29--advanced-import--export); no implementation is authorized by this handoff and no official subphases are introduced.

Before implementation, inspect existing import/export, backup/restore and storage architecture; identify supported formats and current limitations. Preserve Markdown, attachments, metadata and links. Consider database data, properties, relations and saved views where the existing roadmap requires them. Protect vault data and existing user content, and define validation, collision handling, actionable errors, partial-write reporting and recovery expectations before making changes. Do not claim external-product compatibility without verified fixtures or expand beyond the roadmap.

## Historical implementation and review record

The following notes are retained for traceability. Their in-progress, unresolved-scope and pending-acceptance statements describe earlier review stages, not the current accepted status.

# Phase 28 implementation handoff

**Status:** In progress, unaccepted. Cached `origin/main` contains Phase 27 PR #16 at `331bce0f98b66a38e59bc62a3ae744f6f845b20d`, so the Phase 27 dependency is integrated. The cached `origin/fix/phase-27-post-merge` branch also contains `2231a30` (long task-description wrapping), which is not an ancestor of cached `origin/main`; this follow-up is therefore not counted as integrated here. This handoff does not create or rename roadmap phases.

## Current implementation evidence

- `src/temporal/date.ts` defines strict date-only values and inclusive ranges.
- `src/calendar/events.ts` is the shared pure projection for database records and Markdown tasks. Due dates remain metadata; scheduled dates place task events.
- `src/calendar/layout.ts` bounds visible event expansion and provides the month, week, day, and date-selection calculations.
- `src/tasks/extract.ts` derives task metadata from Markdown and writes no sidecar data. Scheduling re-extracts the current task and retains its source identity and surrounding Markdown.
- `src/ui-server/api.ts` exposes conditional task scheduling and Calendar range updates. Database updates use configured date properties and source-note revisions.
- `ui/src/DatabaseLayouts.tsx` contains Month, Week, Day, and Timeline presentations plus the date editor. `ui/src/DatabasesView.tsx` shares projections and refreshes rows/tasks after confirmed writes.

## Review corrections in this handoff

The database range API previously checked saved Calendar configuration before entering the vault write lock, leaving a small race if the view changed before the row update. The storage write now also verifies the saved-view raw hash and the configured date property IDs while holding the same root lock as the note write. A stale view revision is rejected before the note is written.

Timeline overflow previously displayed a count without exposing the remaining events. It now expands the remaining events using the shared bounded day projection. Month overflow likewise shows only items outside its preview. No date range is expanded beyond the visible calendar window.

## Remaining acceptance work

- Timeline is currently a bounded month of date cards. It has no scaled horizontal date axis, zoom, or arbitrary visible-range selection. The active roadmap calls for a “timeline of notes and tasks” but does not define those interactions, so whether a scaled axis is required remains unresolved product scope; do not infer it from the label alone.
- The Calendar uses semantic buttons and an accessible Dialog. Month/week date cells now support arrow-key movement. The Playwright database-view smoke exercises Calendar date dialog cancel/save, stale note and saved-view conflicts, month/week/day navigation, overflow, undated items, and keyboard date movement; retain its exact result below after the current run.
- Phase 27 PR #16 is integrated in cached `origin/main`. The separate cached post-merge text-wrapping change `2231a30` is not in that ref; this is a minor follow-up, not a missing task API dependency.
- The saved-view and temporal docs now describe current behavior; no independent handoff existed before this file.

## Generated artifact preservation issue

A previous build invocation used `pnpm run build -- --outDir …`. The extra separator caused Vite to ignore the requested output directory and write into the ignored repository `dist/`. The prior hashed files were replaced; their original bytes could not be found in the checkout or available temporary copies. They have **not** been reconstructed or restored. Do not treat the current `dist/` as the prior generated output. Future builds must use a direct Vite command with an explicit fresh output directory under `/private/tmp`, then verify that directory’s `index.html`.

## Verification after this review

- Node: v24.18.1.
- `pnpm exec vitest run --no-cache test/storage-database-views.test.ts test/tasks-extract.test.ts test/calendar-events.test.ts test/calendar-layout.test.ts test/temporal-date.test.ts test/ui-calendar-integration.test.tsx test/note-properties.test.ts test/database-relations.test.ts test/database-view-layout.test.ts --maxWorkers=1`: 9 files, 107 tests passed.
- `pnpm exec vitest run --no-cache test/ui-calendar-edit-api.test.ts test/ui-tasks-api.test.ts --maxWorkers=1` (loopback enabled): 2 files, 12 tests passed.
- Full repository suite: `pnpm exec vitest run --no-cache --maxWorkers=1`; 125 files, 1,270 tests passed.
- Typecheck: `pnpm run typecheck` passed.
- Production build: `pnpm exec vite build --config ui/vite.config.ts --outDir /private/tmp/nodus-phase28-final-review.weQJ3A`; passed and that directory’s `index.html` was verified. Vite emitted the existing >500 kB App chunk warning.
- `git diff --check`: passed.

These previous results establish the reviewed source state, not Phase 28 acceptance. The Timeline scale interpretation remains unresolved, and the original ignored `dist/` assets remain unrecovered. See the current session entry below for the latest browser and regression evidence.

## 2026-11-04 review follow-up

- **Browser:** `pnpm test:database-views` passed in Chromium using the existing Playwright harness. The Calendar segment checked initial dialog focus, cancel without a write, date save and visible projection refresh, duplicate scheduled-token validation without rewriting Markdown, stale note conflict, stale saved-view conflict, arrow-key date movement, previous/next Month and Week navigation, Day navigation, selected-day database/task agenda, completed task visibility, overflow inspection, and Undated events. The broader smoke also passed its database formula/table/list/gallery/board/relation/rollup regressions.
- **Focused tests:** 17 files / 166 tests passed, including temporal, event/layout, task extraction and API, Calendar API/UI, database views/properties, relations, automations, templates, and backup flows.
- **Full suite:** `pnpm exec vitest run --no-cache --maxWorkers=1` passed 125 files / 1,271 tests.
- **Typecheck:** `pnpm run typecheck` passed with Node v24.18.1.
- **Build:** `pnpm exec vite build --config ui/vite.config.ts --outDir /private/tmp/nodus-phase28-final-review.TUca83` passed; `/private/tmp/nodus-phase28-final-review.TUca83/index.html` was verified. Vite emitted the existing warning for the 915.97 kB App chunk.
- **Phase 27:** The active roadmap was stale because its task-management status was not reconciled after PR #16 merged. Cached `origin/main` points at `331bce0` (“feat: add Markdown task management (Phase 27) (#16)”). The separate cached branch commit `2231a30` only wraps long task descriptions and is not an ancestor of cached `origin/main`; it is tracked as a follow-up rather than a missing task API dependency.
- **Timeline:** The active roadmap says “timeline of notes and tasks” without requiring an axis, zoom, or arbitrary range. This handoff describes the actual bounded month-card view. A scaled-axis interpretation remains unresolved product scope; Phase 28 is not marked accepted.
- **Generated artifact integrity:** The prior `dist/` overwrite incident remains unresolved. Original ignored assets were not restored. This review wrote build output only to the external path above and did not run builds into repository `dist/`.


Phase 28 scope decision (2026-11-04): The project owner selected the existing bounded month-card Timeline for Phase 28. A scaled date axis, zoom controls, and arbitrary-range Timeline are outside this phase. This resolves the earlier scope ambiguity; formal Phase 28 acceptance remains pending browser verification and owner review.


Browser review evidence (2026-11-04): The intermittent first-event timeout was a fixture assertion defect: the captured Calendar showed three Overflow fixtures and “+3 more” on October 28 while the authoritative Alpha row had the correct date. Day preview order uses source IDs; randomly generated fixture UUIDs could put Alpha outside the preview. The smoke now waits for overflow readiness and inspects the complete agenda/expanded list rather than assuming Alpha is in the preview. Timeline overflow assertions also respect the expansion state retained across view switching. Direct Timeline date cards, tasks, overflow, navigation, empty/Undated states, and source-note opening with unchanged content hash passed in Chromium. Focused tests passed 7 files / 46 tests; full serial tests passed 125 files / 1,271 tests; typecheck passed. External build /private/tmp/nodus-phase28-browser.wFZK69/index.html was verified; the existing large-chunk warning remains. Unavailable-source and explicit stale-response browser scenarios still require review before acceptance. The historical dist incident remains unresolved; this review did not write repository dist, vault data, or backups.

Final browser rerun passed with a gated task-request loading indicator, injected task API failure, and successful Retry. Canceled requests from prior Databases mounts do not all emit browser response events; response-count assertions account for cancellation while requiring an observed injected failure. Unavailable/stale source-note and deliberately reordered response scenarios remain explicit acceptance gaps.


### 2026-11-04 — Source identity and asynchronous response browser verification

Phase 28 remains IN PROGRESS and UNACCEPTED pending owner review. This entry supersedes the earlier unavailable-source and reordered-response verification gaps. The existing bounded month-card Timeline scope is unchanged.

`scripts/database-views-smoke.mjs` now verifies two intercepted unavailable/stale source identities and a real temporary-vault deletion after the Calendar event loads. The error is visible, no other note editor opens, note count falls only for the deliberate fixture deletion, and an unaffected source note retains its content hash. Source navigation uses the owning note UUID; `openNoteById` clears the active editor on the current request's failure and does not resolve a missing ID by title/path or create a replacement note.

Controlled task-request gates hold request group A while the Calendar is left and reopened for group B. B resolves first; A then succeeds with an empty task projection or fails. The newer tasks remain visible, loading is cleared by the current request, obsolete errors remain absent, and month/date navigation is retained. Initialization can issue more than one request, so every obsolete-instance initialization request is gated. Completion promises and browser rendering frames synchronize the assertions; no timeout extension or arbitrary sleep is used by these new scenarios. Existing injected-current-request failure and Retry coverage remains. The React effect's active-instance guard owns projection, error and loading updates. No application behavior change was required.

Browser command: `pnpm test:database-views` passed with these scenarios. Focused tests: 5 files / 28 tests passed. External Vite build passed at `/private/tmp/nodus-phase28-source-response.4fOTai/index.html` (verified; existing large-chunk warning). Full-suite/typecheck results are recorded after completion. Tests mutate only their temporary fixture vault; repository vault, backups and ignored dist are untouched. Historical overwritten dist assets remain unrecovered.

Final regression: Node v24.18.1; `pnpm exec vitest run --no-cache --maxWorkers=1` passed 125 files / 1,271 tests; `pnpm run typecheck` passed. Both `git diff --check` and `git diff --cached --check` passed. Formal acceptance remains a project-owner decision.
