# Temporal contract

This contract defines the date semantics shared by database Calendar layouts and Markdown-derived task events. It does not add date-time values, timezone conversion, a task store, or a new saved-view format version.

## Date-only values

Calendar dates are real Gregorian dates serialized as canonical `YYYY-MM-DD` strings. Validation is strict: values such as `2026-02-30`, timestamps, non-padded dates, and YAML numbers are invalid. Leap days are accepted only in leap years. Date-only values represent calendar days and are never parsed as local or UTC instants for placement.

Database properties retain the existing `date` type and the existing Markdown frontmatter representation under `nodus_data.databases[databaseId][propertyId]`. This work does not migrate database schemas or note values.

## Date ranges

A projected date range has a required start date and an optional end date. Both endpoints are inclusive. If the end is missing, it resolves to the start date, making the event a single-day event. An invalid start or end, or an end before the start, yields an invalid range and is not silently repaired.

Saved database Calendar views use `startDatePropertyId` for the required start property and may use `endDatePropertyId` for the optional end property. Both must reference date properties in the selected database. A missing value in the configured end property resolves to the start date; a non-empty invalid end or a reversed range is invalid. Existing `datePropertyId` settings remain supported as legacy single-day Calendar configurations and are interpreted as the start with no end property. New range settings use the existing version 3 saved-view envelope; the global format version is unchanged. Existing legacy view files are not rewritten merely by loading them.

Calendar display expands inclusive ranges only over dates requested by the current view. Month and Timeline currently use the selected month’s calendar days (at most 42 cells), Week uses seven dates, and Day uses one date. Events are clipped naturally by those visible dates; date-only values are not converted through UTC or local instants. Missing and invalid ranges remain discoverable in Undated.

## Markdown tasks

Task events are derived from GFM checklist items in note Markdown. `[due:YYYY-MM-DD]` remains visible in Markdown and is exposed as due-date metadata. `[scheduled:YYYY-MM-DD]` is a separate visible Markdown token. Tokens are recognized case-insensitively at the end of a logical task-content line, including continuation lines; continuation paragraphs remain part of the parent task text, while nested checklist items remain separate tasks. Inline-code spans and fenced code are excluded from task extraction/metadata. Scheduled and due dates are distinct: **scheduled date places the task on the calendar; due date does not**. A task with both tokens produces one calendar event, not two.

Valid due, scheduled, and existing priority metadata is removed from projected display text only. Invalid date tokens and every token of a duplicated date kind remain in projected text; that metadata carries an `invalid` status. The source Markdown is never edited by extraction or projection. A task without a valid scheduled token remains unscheduled even when it has a due date. Completion is derived from the Markdown checkbox marker. Task IDs are deterministic projection-local identifiers and are not persisted. Scheduling edits reload current Markdown, re-extract and verify the task identity, then use the vault’s expected-hash conditional write; they preserve due-date tokens and unrelated task content.

## Shared calendar event projection

`src/calendar/events.ts` maps existing database row projections and extracted Markdown tasks into typed calendar events. Each event includes a source identity, title, all-day temporal kind, date state, optional inclusive range, completion state where applicable, and note navigation identity. A database event identity includes its database, record, start-date property, and optional end-date property, so distinct property configurations produce distinct events. Duplicate inputs with the same identity resolve deterministically. It is pure: it does not write notes, saved views, tasks, or event records.

Date state is one of:

- `scheduled`: a valid date or range is available.
- `unscheduled`: no start date or task scheduled token is present.
- `invalid`: source metadata is invalid or a range is reversed.

Invalid database properties are detected from existing structured-data diagnostics. Invalid task tokens remain visible in the derived task text and are reported as invalid metadata. Projection order is deterministic: scheduled events by start and end date, then source kind, normalized title, and event identity; unscheduled events follow; invalid events come last. Repeated projection inputs with the same source identity are emitted once.

## Source-of-truth and compatibility boundaries

- Markdown remains authoritative for note content, task markers, due dates, and scheduled dates.
- `ExtractedTask` remains the Phase 27 task DTO shape with additive temporal fields; extraction populates the new fields, while they remain optional in the TypeScript interface so existing Phase 27 DTO consumers and fixtures stay structurally compatible.
- Phase 27 `buildTaskProjection` and `setTaskChecked` extractor exports remain available; projections are rebuilt from Markdown and marker toggles edit only the verified checkbox span.
- Database date values remain ordinary typed note frontmatter governed by existing database definitions.
- Legacy saved database views retain their `datePropertyId` shape and continue to resolve as single-day ranges. New views save the start and optional end property IDs in the existing v3 settings envelope. Backup, import, export, and template parsing use the same saved-view contract and do not introduce a separate calendar configuration store.
- There is no task sidecar, event table, hidden scheduling metadata, or automatic rewrite to normalize invalid values.
- Timed events, timezone conversion, task sidecar storage, and drag-to-reschedule writes are outside the current Calendar contract.

## Calendar presentation

The Calendar offers Month, Week, Day, and Timeline presentations over the selected saved Calendar configuration. Weeks begin Sunday, matching month headers. Month and week views expand events only across visible date cells; Timeline is currently a bounded month-of-day-cards presentation, not a scaled date-axis/bar timeline. The active roadmap names a timeline of notes and tasks but does not define axis scaling, zoom, or arbitrary-range selection, so whether those are required is unresolved scope. Month and Timeline previews provide overflow inspection, and the selected-day agenda lists every event on that day. Switching presentations retains the selected date. Month/week date cells support arrow-key movement. Events navigate to their source note, and request failures provide a retry action.

Database Calendar edits validate the selected saved view, configured date property types, date-only values, inclusive range order, and the note revision. Configured start/end values are validated and written together under the vault lock. Task scheduling uses `[scheduled:YYYY-MM-DD]`, re-extracts the task from current Markdown, checks its identity and note hash, and conditionally replaces the note. A stale revision or invalid/duplicate scheduled token fails without a source write; the UI refreshes the authoritative projection only after success. Date changes do not write to a separate calendar store.

## Current delivery status and generated artifacts

Calendar code and tests are present as working-tree implementation, but Phase 28 has not been accepted. The current Timeline is limited as described above. Browser-level Calendar dialog, navigation, keyboard, overflow, undated, and stale-write behavior is covered by `scripts/database-views-smoke.mjs`; final regression verification must still be repeated after review corrections.

One prior build accidentally wrote into ignored repository `dist/` after an extra argument separator caused Vite to ignore the requested external output directory. The original ignored files were not recoverable from the checkout or available temporary copies. This is an unresolved generated-artifact preservation issue; the original assets have not been restored. Future builds must target a fresh external directory and verify its `index.html`.


Phase 28 scope decision (2026-11-04): The project owner selected the existing bounded month-card Timeline for Phase 28. A scaled date axis, zoom controls, and arbitrary-range Timeline are outside this phase. This resolves the earlier scope ambiguity; formal Phase 28 acceptance remains pending browser verification and owner review.


Browser review evidence (2026-11-04): The intermittent first-event timeout was a fixture assertion defect: the captured Calendar showed three Overflow fixtures and “+3 more” on October 28 while the authoritative Alpha row had the correct date. Day preview order uses source IDs; randomly generated fixture UUIDs could put Alpha outside the preview. The smoke now waits for overflow readiness and inspects the complete agenda/expanded list rather than assuming Alpha is in the preview. Timeline overflow assertions also respect the expansion state retained across view switching. Direct Timeline date cards, tasks, overflow, navigation, empty/Undated states, and source-note opening with unchanged content hash passed in Chromium. Focused tests passed 7 files / 46 tests; full serial tests passed 125 files / 1,271 tests; typecheck passed. External build /private/tmp/nodus-phase28-browser.wFZK69/index.html was verified; the existing large-chunk warning remains. Unavailable-source and explicit stale-response browser scenarios still require review before acceptance. The historical dist incident remains unresolved; this review did not write repository dist, vault data, or backups.

Final browser rerun passed with a gated task-request loading indicator, injected task API failure, and successful Retry. Canceled requests from prior Databases mounts do not all emit browser response events; response-count assertions account for cancellation while requiring an observed injected failure. Unavailable/stale source-note and deliberately reordered response scenarios remain explicit acceptance gaps.


### 2026-11-04 — Source identity and asynchronous response browser verification

Phase 28 remains IN PROGRESS and UNACCEPTED pending owner review. This entry supersedes the earlier unavailable-source and reordered-response verification gaps. The existing bounded month-card Timeline scope is unchanged.

`scripts/database-views-smoke.mjs` now verifies two intercepted unavailable/stale source identities and a real temporary-vault deletion after the Calendar event loads. The error is visible, no other note editor opens, note count falls only for the deliberate fixture deletion, and an unaffected source note retains its content hash. Source navigation uses the owning note UUID; `openNoteById` clears the active editor on the current request's failure and does not resolve a missing ID by title/path or create a replacement note.

Controlled task-request gates hold request group A while the Calendar is left and reopened for group B. B resolves first; A then succeeds with an empty task projection or fails. The newer tasks remain visible, loading is cleared by the current request, obsolete errors remain absent, and month/date navigation is retained. Initialization can issue more than one request, so every obsolete-instance initialization request is gated. Completion promises and browser rendering frames synchronize the assertions; no timeout extension or arbitrary sleep is used by these new scenarios. Existing injected-current-request failure and Retry coverage remains. The React effect's active-instance guard owns projection, error and loading updates. No application behavior change was required.

Browser command: `pnpm test:database-views` passed with these scenarios. Focused tests: 5 files / 28 tests passed. External Vite build passed at `/private/tmp/nodus-phase28-source-response.4fOTai/index.html` (verified; existing large-chunk warning). Full-suite/typecheck results are recorded after completion. Tests mutate only their temporary fixture vault; repository vault, backups and ignored dist are untouched. Historical overwritten dist assets remain unrecovered.

Final regression: Node v24.18.1; `pnpm exec vitest run --no-cache --maxWorkers=1` passed 125 files / 1,271 tests; `pnpm run typecheck` passed. Both `git diff --check` and `git diff --cached --check` passed. Formal acceptance remains a project-owner decision.
