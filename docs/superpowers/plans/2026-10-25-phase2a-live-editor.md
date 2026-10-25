# Phase 2A — Live Markdown Editor

**Goal:** Replace the plain `<textarea>` body editor with a source-preserving CodeMirror 6 live Markdown editor and add optional page icons.

**Architecture:** CodeMirror 6 keeps the raw Markdown string as the document. Decorations are visual only. Frontmatter is edited outside the editor. Save remains manual with `baseHash` stale-write protection.

**Constraints**
- Five approved CodeMirror direct dependencies only.
- No Milkdown/Tiptap/Lexical/react-markdown/@uiw/@latentic.
- Preserve LF and homogeneous CRLF; mixed endings preserved as current behavior, documented.
- Tables stay source-styled; images not loaded; no full block editor.
- Preserve all existing uncommitted work.

## Task 1 — Icon/aliases projection
- Add `src/ui-server/page-icon.ts`: normalize/read/apply icon in extra frontmatter.
- Expose `aliases` and `icon` on `UiNoteSummary`/`UiNote`/`UiSearchResult`.
- `saveLocalNote` handles `icon` only when present; omitted preserves, null removes, string sets.
- Tests for normalization, preserve/remove, list/search DTOs.

## Task 2 — CodeMirror editor shell
- Add dependencies.
- Create `ui/src/editor/CodeMirrorEditor.tsx`, `ui/src/editor/createEditorState.ts`, `ui/src/editor/theme.ts`.
- Replace `Editor.tsx` body textarea; wire `App.tsx`.
- Configure `lineSeparator` from body; LF/CRLF preserved; mixed documented.
- Manual save/dirty/baseHash/note switch unchanged.
- Add Live/Source toggle (Live no-op until Task 3).
- Node-only tests for state round-trip and line separators.

## Task 3 — Live decoration foundation
- Create `ui/src/editor/liveMarkdown.ts`.
- Decorate headings, emphasis, inline code, lists, blockquotes, code fences.
- Hide markers outside selection; reveal on cursor entry.
- Use `visibleRanges`; full-document parse avoided.
- Tests for decoration ranges and document preservation.

## Task 4 — Task lists, wiki links, navigation
- Create `ui/src/editor/taskList.ts`, `ui/src/editor/wikiLinks.ts`.
- Checkboxes dispatch minimal transactions; undo works.
- Wiki links decorated outside code; resolved links navigate on Ctrl+click through existing dirty guard.
- Tables styled as source; images not loaded.

## Task 5 — Page icon UI
- Create `ui/src/pageIcons.ts`, `ui/src/PageIcon.tsx`, `ui/src/PageIconPicker.tsx`.
- Icon above title; picker; omission/null/string semantics.
- Tree/search/palette display icon.

## Task 6 — Docs, fallback gate, verification
- Create `docs/editor.md`, `docs/page-icons.md`.
- Run `pnpm test`, `pnpm typecheck`, `pnpm build`.
- Measure bundle delta; report manual-test results.
- If CodeMirror fails IME/selection/CRLF/a11y/performance gate, stop and report evidence; do not ship both editors.
