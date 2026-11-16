# Core completion audit — 2026-11-16

Supporting evidence report; docs/ROADMAP.md remains authoritative. Status is not
owner acceptance. Source/test presence and historical evidence are distinguished
from fresh command outcomes, recorded below after verification. The entire
historical acceptance suite has not been independently reconstructed per phase.

## Baseline and ownership

Active main c819c0a4ffd1fc6638c7beac59f6e67e08e5d426. Live remote main
c5bf78b41fa4bcd05ca93f99155d8e586e1a33ff, checked by ls-remote without fetch.
13 ahead/1 behind. Twenty worktree registrations (15 paths reported missing),
six retained stashes. No worktree cleanup is part of this development task.

Ten preexisting modified tracked paths: .gitignore/package.json/pnpm-lock.yaml
belong to executor build setup; docs/README.md and ROADMAP.md to approved Phase31
planning; three UI test files plus CommandPalette/ShortcutReferenceDialog belong
to reviewed five-file Phase30/32 reconciliation (+39/-3). Eighteen preexisting
untracked files: twelve acceptance screenshots; Phase31 specification; native
binding/source/identity contract; executor wrapper and tests. Screenshots remain
local evidence and are not silently included in source commits.

The original detached dirty worktree, Phase19 candidate, Visual/Brand dirty
worktree, Phase27 worktree, all stashes, recovery archives and refs remain protected.
No original dirty-main work is automatically considered merged by this audit.

## Phase matrix

| Phase | Scope | Status | Implementation evidence | Test evidence | Git status at audit | Next action |
|---|---|---|---|---|---|---|
| 1 | Domain/format | Completed and integrated | src/domain; src/format | Domain/format tests | See implementation refs; main or planned | Retain strict validation |
| 2 | Vault/storage | Completed and integrated | src/storage | Storage tests | See implementation refs; main or planned | Retain format compatibility |
| 2A | Markdown editor | Completed and integrated | ui/src/Editor.tsx | Editor tests/smokes | See implementation refs; main or planned | Preserve editor behavior |
| 3 | Relay/sync foundation | Partially completed; experimental | src/relay; src/sync | Relay/sync tests | See implementation refs; main or planned | Do not equate with supported cloud sync |
| 4 | Navigation/organization | Completed and integrated | ui/src/Sidebar.tsx | Navigation tests | See implementation refs; main or planned | Retain recovery |
| 5 | UX polish | Completed and integrated | ui/src | UI tests | See implementation refs; main or planned | Retain documented limits |
| 6 | Search/discovery | Completed and integrated | src/search | Search tests/smoke | See implementation refs; main or planned | Retain bounds |
| 7A | Metadata/catalogs | Completed and integrated | src/properties | Catalog tests | See implementation refs; main or planned | No schema lifecycle expansion |
| 7B | Databases/views | Completed and integrated | src/database | Database/view tests | See implementation refs; main or planned | Keep unassigned column-order work isolated |
| 7C | Relations/rollups | Completed and integrated | src/database | Relation/rollup tests | See implementation refs; main or planned | Retain bounded evaluation |
| 7D | Formula authoring | Completed and integrated | src/database | Formula tests | See implementation refs; main or planned | No arbitrary script execution |
| 8 | Storage reliability | Completed and integrated with limitations | src/storage/fs | Root-lock/reliability tests | See implementation refs; main or planned | External writers remain outside coordination |
| 9 | Performance/caching | Partially completed; review outstanding | src/indexing; docs/structured-data-performance.md | Benchmark configs/scripts | See implementation refs; main or planned | Run current measurements; define remaining acceptance |
| 10 | Gallery/view ordering | Completed and integrated | src/database; ui/src | View tests | See implementation refs; main or planned | Retain saved-view contract |
| 11A | Relation lifecycle | Completed and integrated | src/database | Relation tests | See implementation refs; main or planned | No unapproved property deletion |
| 11B | Rollup/relation search | Completed and integrated | src/database | Rollup tests | See implementation refs; main or planned | Retain existing scope |
| 11C | Relation formulas | Completed and integrated; documentation debt | docs/database-formulas.md; src/database | Formula tests | See implementation refs; main or planned | Review drift without inventing missing features |
| 12 | Database automations | Completed and integrated with limitations | src/database/automations.ts | database-automations tests | See implementation refs; main or planned | Unchanged by standalone executor adapter |
| 13 | Templates | Completed and integrated | src/database/templates.ts | Template tests | See implementation refs; main or planned | No unrelated template work |
| 14 | Template reliability | Completed and integrated | src/storage/fs/vault.ts | Template/health tests | See implementation refs; main or planned | Retain recovery behavior |
| 15P | Commands/productivity | Completed and integrated | ui/src/CommandPalette.tsx | Palette tests | See implementation refs; main or planned | Historical advanced-query Phase 15 is not this scope |
| 16 | Editor enhancements | Completed and integrated | ui/src | Editor tests | See implementation refs; main or planned | Branch ancestry differs after squash; do not remerge blindly |
| 17G | Knowledge graph | Completed and integrated | ui/src/GraphView.tsx; src/indexing | Graph tests | See implementation refs; main or planned | Unique ancestry does not imply missing feature |
| 18L | Link integrity/repair | Completed and integrated with limitations | src/links | Link tests | See implementation refs; main or planned | Preserve detached a39d4f8 history |
| 19 | Move-safe links | Blocked by integrity/recovery design | rescue/phase-19; isolated stage8 candidate | Preserved unrelated-link corruption probe | Isolated rescue/candidate; not integrated | Do not integrate candidate or shared write-session work |
| 20 | Knowledge intelligence | Completed and integrated with limitations | docs/knowledge-retrieval.md; src/indexing | Insight tests/smoke | See implementation refs; main or planned | Retain bounded scope |
| 21 | Advanced graph | Completed and integrated with limitations | docs/knowledge-graph.md | Graph tests | See implementation refs; main or planned | No new graph architecture |
| 22 | Portable graph views | Completed and integrated with limitations | docs/knowledge-graph.md | Graph view tests | See implementation refs; main or planned | Historical numbering differs |
| 23 | Advanced search | Completed and integrated with limitations | src/search | Search tests/smoke | See implementation refs; main or planned | Retain strict query semantics |
| 24 | Knowledge retrieval | Completed and integrated; 24D explicitly deferred | docs/knowledge-retrieval.md | Retrieval tests/benchmark | See implementation refs; main or planned | Do not start deferred 24D |
| 25 | Smart organization | Completed and integrated with limitations | src/organization | Organization tests | See implementation refs; main or planned | Automatic moves blocked by 19 |
| 26 | Workspace customization | Completed and integrated with limitations | ui/src/workspacePreferences.ts | Workspace tests/smoke | See implementation refs; main or planned | Browser-local settings limitations |
| 27 | Task management | Completed and integrated with limitations | src/tasks; ui/src/draftRecoveryJournal.ts | Task/draft tests | See implementation refs; main or planned | 0556095 unique ancestry; draft source currently matches main |
| 28 | Calendar/timeline | Completed and integrated; owner accepted | src/calendar; src/temporal | Calendar/temporal tests | See implementation refs; main or planned | Bounded month-card timeline is accepted scope |
| 29A/B/C | Import/export foundations | Completed and integrated | src/storage/portable | Portable tests | See implementation refs; main or planned | 29C owner accepted |
| 29D | Import execution/recovery | Implementation integrated; formal acceptance pending | docs/phase29d-handoff.md; src/storage/fs/vault.ts | Import process/recovery tests | See implementation refs; main or planned | Review D.7 and documented crash limits with owner |
| 30 | Conflict resolution | Partially completed acceptance; implementation integrated | src/sync; ui/src/ConflictsView.tsx | Conflict tests/browser smoke | See implementation refs; main or planned | Formal acceptance and broader durability evidence pending |
| 31A | Workflow scope | Completed documentation; uncommitted | docs/phase31-automation-workflow.md | Design review | Uncommitted active-main work | Preserve approved decisions |
| 31B.1 | Executor ownership | Partially completed; uncommitted | native/executor-lock; src/storage/fs/executor-lock.ts | F1/F2 macOS accepted; F3 focused tests | Uncommitted active-main work | F3 diagnostics implemented today; remaining platform gates open |
| 31B.2–B.5 | Journal/execution/recovery | Not started; blocked by prerequisites/scope approval | docs/phase31-automation-workflow.md | No implementation acceptance | Uncommitted active-main work | Do not begin under this task |
| 32 | UX simplification | Implementation integrated; owner sign-off pending | ui/src; six integration commits | Integrated acceptance evidence; five-file reconciliation dirty | See implementation refs; main or planned | Commit reviewed reconciliation only after fresh checks |
| 33 | Tauri | Not started; blocked by core-first policy | Roadmap | No desktop qualification | See implementation refs; main or planned | Do not begin |
| 34 | Synchronization | Explicitly deferred/experimental | src/sync; docs/phase3 | Experimental tests only | See implementation refs; main or planned | No accounts/cloud/Supabase claims |
| 35 | Security/performance | Not started; scope needs definition | Roadmap | No phase acceptance | See implementation refs; main or planned | Review concrete release risks first |
| 36 | Release readiness | Not started; blocked by core gates | Roadmap | No release acceptance | See implementation refs; main or planned | Require verified publication and Windows evidence |
| P0–P4 | Independent plugin workstream | Design/foundation integrated | src/plugins; docs/plugin-workstream-roadmap.md | test/plugins | See implementation refs; main or planned | Metadata registry only; no executable runtime |
| P5–P8 | Plugin runtime/management | Explicitly deferred | docs/plugin-workstream-p5-readiness.md | No runtime tests | See implementation refs; main or planned | Requires host/security/product decisions |

## Dependency order

1. Verify and commit reviewed five-file UI reconciliation separately from Phase31.
2. Preserve/commit approved Phase31 foundation and F3 diagnostics with tests; it
   stays unused by Phase12 and is not a platform-wide acceptance claim.
3. Finish Phase29D owner review and Phase30 scoped durability evidence; request
   explicit acceptance decisions rather than marking phases complete by assertion.
4. Phase32 owner sign-off; no extra redesign is needed to obtain sign-off.
5. Phase19 remains isolated until recovery ownership protocol can safely pass its
   original unrelated-link regression. Do not enable automatic organization moves.
6. Phase9 measurement/review and Phase11C documentation debt, followed by concrete
   Phase35/36 specifications. Phase31 F4/H2/B.2+ require separately established scope.
7. Only then consider desktop host work. Keep Phase34 and plugin runtime deferred.

## Ancestry and integration

Old local main 3a0ed3b and remote c5bf78b have identical tree
afdb82d5305783cb6da0bc55e7aea213d8801c11, with different ancestry. Seven local
commits cover splash, import completeness, metadata-only plugins and documentation.
Remote is one squash commit (58 paths, +5124/-67). Six subsequent main commits
are Phase32 (8b7401a), Phase30 (64bb301), Visual (5159668), roadmap (e1ea032),
Connections (632e348), acceptance (c819c0a). Preserve these commits.

Do not force-push. A normal main-to-origin push currently fails ancestry checks.
A content-preserving merge of the remote squash ancestry must be previewed and
verified; if it conflicts semantically, stop publication. No old feature branch
should be merged solely because its commits are absent by OID: squash integration
leaves unique ancestry. Phase19 86fafd1 is truly unintegrated; Phase27 fix 0556095
has unique ancestry but its draftRecoveryJournal.ts currently matches main.

## Unique branch ancestry inventory

Counts below mean commits not reachable from main, not missing functionality.
All branches remain retained. Missing worktree registrations are not pruned.

```text
  1 backup/main-750d3ea
  1 backup/main-919b71d
  1 docs/phase-integration-status
  3 feat/phase-16-markdown-editor
  2 feat/phase-17-knowledge-graph
  5 feat/phase-20-knowledge-intelligence
  4 feat/phase-21-advanced-graph-exploration
  6 feat/phase-22-portable-graph-views
  1 feat/phase-23-advanced-search-filtering
  3 feat/phase-24-knowledge-retrieval
  3 feat/phase-25-smart-organization
  1 feat/phase-26-workspace-customization
  2 feat/phase-27-task-management
  1 feature/phase-29d-1-import-freshness
  1 feature/phase-30-conflict-resolution
  1 feature/phase-32-ux-simplification
  1 feature/visual-brand-isolation
  1 fix/draft-recovery-schema-upgrade
  3 fix/graph-canvas-interaction
  2 fix/phase-27-post-merge
  4 integration/phase29b-29c-20261105
  0 integration/phase32-30-visual-20261113
  0 integration/stage8-local
  0 main
  1 rescue/phase-19
```

## Verification

Fresh outcomes will be recorded after the commands complete. No completion claim
is made from source presence alone. See windows-development.md for native Windows
qualification blockers and exact setup commands.

## Preserved stash identities

```text
901b3d988c607bc0ef8f26ccaf4948741cd7067b
1afb7a25a8a8eadc3b043022afa0d39a103ecd53
d142d0688f2e728b85c260103736f83aa44457d7
441a0cc6ad3d5c7e4bf06f81219b1e5181fcc5df
83b67cce25855b5188b7e63590b30e34551cf6a3
e3d67f72df0b0dcd803089d377e0c9d7e870f21c
```

## Current verification and preserved exclusions

- Native build: `corepack pnpm run build:executor-lock` passed on Darwin x64/APFS.
- Executor/root-lock/automation focused run: 44 tests across 4 files passed.
- Full serial run: `corepack pnpm exec vitest run --maxWorkers=1` passed
  1,536 tests across 149 files (313.05 seconds).
- `corepack pnpm run typecheck` and `corepack pnpm run build` passed. Existing
  App chunk warning remains (959.71 kB minified, 269.54 kB gzip).
- All nine browser scripts passed: browser-smoke, landing-visual-smoke,
  search-smoke, workspace-customization-smoke, database-views-smoke,
  phase32-mobile-smoke, conflict-ui-smoke, combined-conflicts-navigation-smoke,
  connections-sheet-smoke. Combined and Connections checks covered 320/375/768/1280
  widths and light/dark themes; landing checked six widths/two themes. No actual
  screen-reader acceptance or Windows execution is claimed.
- `node scripts/import-recovery-process-smoke.mjs` passed real restart/recovery and
  ambiguous external-edit preservation. `node scripts/editor-draft-recovery-smoke.mjs`
  passed persistence, explicit recovery, and save/cleanup behavior.
- Additional import/draft six-file focused run: 45 passed, 1 timed out at existing
  5-second limit in the structured-resource publication test while full/browser
  checks were running. Source/test timeout was not changed. Full serial suite
  passed the same test. An unchanged focused rerun is recorded separately below.
- `git diff --check` passed.

Original detached index still hashes to
f683dd8e185c4dc53bcceca73668e10551af607a8ededb8a2892c441ad366c21.
Rescue 86fafd10868bafceeb94635226c76d405d76a860 and all 20 registrations retained.
The original detached worktree still contains staged AGENTS/design/tooling/security
work, mixed UI/editor/Markdown changes, database column ordering, Getting Started,
local templates/docs and five demo-vault metadata paths. These are not silently
absorbed or discarded. Current Stage8 candidate remains dirty with Phase19 code;
Visual/Brand remains dirty; Phase27 worktree reports no tracked modifications.
Each needs an individual source/acceptance review before any further integration.
Existing central recovery archives and all six stashes remain in place. Twelve
active-main screenshots are retained as local untracked evidence.

F3 acceptance boundary: errors and bounded diagnostics are implemented and tested;
test-only failures are reported after real syscalls. Actual kernel close failures,
GC-teardown diagnostic availability and Linux/Windows are not qualified. No Phase12
execution, vault writer lock, backup version, or portable format changed.

Focused import/draft rerun without the full suite competing: 46 tests across six
files passed unchanged in 22.02 seconds. The original timeout remains recorded;
no timeout or product assertion was weakened. UI reconciliation was committed as
44ddf19 (+39/-3), and executor foundation/F3 as d526cfa. F3 remains pending review,
not accepted across platforms. The docs and Windows handoff are a separate commit.
