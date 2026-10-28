# Phase 2A editor acceptance evidence

Automated run: 2026-10-28, macOS 14.6, x64 Intel Core i5-8257U, 8 logical cores, Node 24.18.1, pnpm 11.9.0, Vite 8.3.5, Playwright 1.49.0 with bundled Chromium. Browser automation used headless Chromium at 1280×900 and fresh temporary vaults under the system temporary directory. No user vault was used.

The user subsequently confirmed that **all manual editor acceptance checks listed below were performed and passed**. This is recorded as user-confirmed evidence. The user did not provide the manual session's OS/browser versions, input method/assistive technology, exact steps, timings, or screenshots/logs, so those details are not independently recorded here. Automated and repository evidence remains distinguished from that confirmation.

## Plan criteria

The controlling plan is [`2026-10-25-phase2a-live-editor.md`](superpowers/plans/2026-10-25-phase2a-live-editor.md). Task 6 requires `pnpm test`, `pnpm typecheck`, and `pnpm build`; a measured bundle delta; manual-test results; and an acceptance gate for IME, caret/selection, CRLF, accessibility, and performance. A failed gate means stop and report evidence; it does not prescribe a numeric bundle-size ceiling. Tasks 1–5 specify icon/alias projection, a raw-Markdown CodeMirror document with manual save and stale-write protection, viewport-scoped live decorations, task-list/wiki-link behavior, and page-icon UI.

## Bundle comparison

The closest reproducible pre-change tree is parent commit `aa7bac818f18040f943865e587d538e7e39b6609`; commit `4de6c703fa89a96e41bb80cf36a6b9bc59f1d812` introduced the editor. Both trees were built with Node 24.18.1, the same installed Vite 8.3.5 toolchain, and the same Vite production configuration. The parent tree came from `git archive` in `/tmp`; both builds wrote only to temporary output directories. The parent package/lock differ only by the five direct CodeMirror dependencies in the milestone commit. Measurements count emitted `.js` and `.css` assets, raw bytes and `gzipSync` default compression, summed per build.

This comparison is reproducible as a **whole-application delta from the pre-editor parent to the current tree**, but it is not an editor-only attribution: the editor-introducing commit also changed the broader workspace, and later commits changed the application further. Therefore this is useful size evidence, not proof that CodeMirror alone accounts for the increase.

| Tree | JavaScript raw / gzip | CSS raw / gzip | JS + CSS raw / gzip |
|---|---:|---:|---:|
| Pre-change parent `aa7bac8` | 445,814 / 136,600 B | 66,536 / 11,684 B | 512,350 / 148,284 B |
| Current `1363c28` | 996,260 / 323,161 B | 70,657 / 12,406 B | 1,066,917 / 335,567 B |
| Delta | +550,446 / +186,561 B | +4,121 / +722 B | +554,567 / +187,283 B |

The current app bundle is about 996 KB raw JavaScript and 323 KB gzip; Vite reports a chunk-size warning above its 500 KB threshold. This is not a plan-defined failure threshold, but it is worth tracking. No chunk splitting or optimization was attempted. Build logs and byte counts were observed on this machine; no measurements are inferred. The equivalent build invocation is `node --input-type=module -e 'import { build } from "vite"; await build({ configFile: "ui/vite.config.ts", build: { outDir: "/tmp/nodus-build-output", emptyOutDir: true } })'` from each tree; use a distinct output path for each build.

## Acceptance matrix

| Criterion | Status | Steps and observed evidence |
|---|---|---|
| Startup, empty vault, create/save two notes, navigate, reload and reselect | **PASS** | Ran `pnpm test:browser`. The checked-in runner started its own strict-loopback Vite process with a fresh temporary vault, verified that process's `/api/status` root, then Chromium checked empty state, created and saved two notes, navigated, checked API and Markdown-file persistence, reloaded/reselected, and found no uncaught browser errors or essential API failures. Cleanup completed with exit code 0. |
| Editor accessible name and basic source-mode editing | **PASS (bounded)** | Supplemental headless Chromium session opened a seeded note in a temporary vault, located the body as textbox “Markdown body”, switched to Source, inserted `café 日本語 🙂` with the keyboard, saved, and confirmed bytes in the temporary Markdown file. This does not establish assistive-technology usability. |
| Homogeneous CRLF through actual UI edit/save | **PASS (bounded)** | The temporary vault contained a CRLF note. After editing and saving in Source mode, the original CRLF bytes and appended Unicode text remained in the file. Mixed line endings remain explicitly outside the byte-preservation guarantee. |
| IME composition (including non-Latin composition) | **PASS — user-confirmed; details not recorded** | User confirms the required manual IME checks passed. The input method, platform, composition steps, and saved/reloaded result details were not supplied. |
| Caret navigation, selection, replacement, undo/redo, document boundaries | **PASS — user-confirmed; details not recorded** | User confirms the manual caret/selection checks passed. Exact navigation keys, mouse-selection steps, boundary cases, and undo/redo observations were not supplied. |
| Keyboard, accessible names, focus, and assistive-technology checks | **PASS — user-confirmed; details not recorded** | User confirms the manual accessibility checks passed. Screen reader/assistive-technology name/version, keyboard paths, focus observations, and semantic output were not supplied. Automated browser evidence independently verifies the “Markdown body” textbox accessible name and keyboard text insertion only. |
| Live-mode visual behavior and Source-mode behavior | **PASS — user-confirmed; details not recorded** | User confirms the manual rendering-mode checks passed. Specific Markdown constructs, cursor reveal behavior, and visual observations were not supplied. Automated tests and the smoke test provide narrower evidence. |
| Task-list interaction and wiki-link behavior | **PASS — user-confirmed; details not recorded** | User confirms the manual task-list/wiki-link checks passed. Toggle/undo steps, link resolution cases, modifiers, and navigation results were not supplied. Unit tests cover task-marker transactions and wiki-link parsing/resolution. |
| Page-icon picker and persistence | **PASS — user-confirmed; details not recorded** | User confirms the picker checks passed. Add/change/remove cases and save/reload evidence were not supplied. Projection/API behavior has automated coverage. |
| Large-note responsiveness | **PASS — user-confirmed; details not recorded** | User confirms the manual performance checks passed. Fixture sizes/content, Live/Source mode, timings, hardware/browser details, and interaction observations were not supplied. `docs/editor.md` separately records prior 100 KB and 850 KB observations and says 1 MB was unverified; those prior notes are not treated as measurements from this acceptance session. |

## Validation run

- `pnpm test:browser` — passed; checked-in end-to-end smoke described above.
- `pnpm exec vitest run --no-cache test/editor-state.test.ts test/editor-tasklist.test.ts test/editor-wikilinks.test.ts test/page-icon.test.ts test/page-icons.test.ts test/ui-editor-layout.test.tsx test/ui-editor-reliability.test.ts --maxWorkers=2` — 7 files, 51 tests passed.
- `pnpm typecheck` — passed (both configured TypeScript projects).
- Production builds of the pre-change parent and current tree — passed with Vite 8.3.5. Both used temporary output directories; current build warned that its JavaScript chunk exceeds 500 KB. The build byte comparison uses the emitted JS/CSS assets above.
- `git diff --check` — passed after adding this report.

## Limitations and disposition

The user has confirmed every manual editor check in the plan and the combined status matrix now records those checks as PASS. The audit cannot independently reproduce or inspect those manual observations because their environment, steps, and artifacts were not recorded. The bundle increase is measured, but a clean editor-only delta cannot be attributed from the available history because the editor landed together with broader UI changes.

One earlier build invocation in the inspection session omitted its temporary-output variable and Vite consequently wrote the current production build to ignored `dist/`. Its current files are Vite-generated app assets and are reproducible from the current tree; the previous ignored contents are unknown and cannot be verified or reconstructed from Git. Subsequent builds explicitly verified a temporary output path and confirmed the current `dist/` fingerprint did not change. This report does not claim the original `dist/` contents were preserved.
