# Nodus editor

Nodus uses CodeMirror 6 as a source-preserving Markdown editor. The raw Markdown body is the editor document; live formatting is drawn with view-only decorations. There is no intermediate rich-text document and no Markdown serializer in the editing path.

## Modes

- **Live** styles headings, emphasis, strong text, inline code, bullet lists, blockquotes, code fences, tables, task checkboxes, and wiki links. Syntax markers are hidden while the cursor is outside them and revealed when the selection enters their range.
- **Source** shows the exact Markdown text with no live decorations. It is the escape hatch for raw syntax and for reviewing what will be saved.

The mode is local to the editor session and does not change the note or mark it dirty.

## Source fidelity

- `EditorState.doc` contains the Markdown body. Decorations never write to it.
- Saving uses the same manual Save path and `baseHash` stale-write protection as the rest of Nodus.
- Frontmatter is not part of the editor. It remains outside the body and is preserved by the storage/API layer.
- Unknown Markdown syntax remains raw because the live layer only decorates Markdown nodes it recognizes.

## Line endings

- Homogeneous LF is preserved.
- Homogeneous CRLF is preserved through `EditorState.lineSeparator`.
- Mixed line endings keep the existing behavior for this phase. They are not promised byte-for-byte fidelity through every edit. `test/editor-state.test.ts` pins the current state-level round-trip behavior.

## Scope and trade-offs

- Tables remain Markdown source with a monospace/table treatment. They are not rendered as HTML tables.
- Code fences are styled blocks, not syntax-highlighted editors. The fences and code remain source.
- Images are not fetched or rendered. Remote image URLs are never loaded by the editor.
- Task checkboxes are interactive widgets that perform a minimal source transaction. They use the normal undo history.
- Wiki links resolve against the note summaries. Resolved links open on `Mod/Ctrl+click`; ambiguous and unresolved links never choose a target implicitly. Plain click places the source cursor and reveals the raw link.
- This is not a block editor. There are no nested block handles, drag-to-reorder blocks, slash menus, or HTML table widgets.

## Accessibility and performance

- The CodeMirror content node is a labeled multiline textbox.
- Source mode exposes raw Markdown for assistive-technology and editing use.
- Decoration work is limited to visible ranges; the full document is not rendered into DOM nodes. Wiki-link resolution scans visible line ranges and excludes code through the syntax tree.
- Large-note performance is guarded by keeping the live decoration pass viewport-scoped. Measured here: a 100 KB note and an 850 KB note were both usable; the 850 KB note had a single very long line and took about 1.7 seconds to open. A 1 MB note remains unverified; use Source mode if the live editor is not responsive.

## Fallback

If the CodeMirror live layer fails IME, caret/selection, CRLF, accessibility, or large-note acceptance, stop and report the evidence. The fallback is to revert the CodeMirror editor change; there is no second editor in this phase.
