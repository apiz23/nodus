# Nodus editor

Nodus uses CodeMirror 6 as a source-preserving Markdown editor. The raw Markdown body is the editor document; live formatting is drawn with view-only decorations. There is no intermediate rich-text document and no Markdown serializer in the editing path.

## Modes

- **Live** styles headings, emphasis, strong text, inline code, bullet lists, blockquotes, code fences, tables, task checkboxes, and wiki links. Syntax markers are hidden while the cursor is outside them and revealed when the selection enters their range.
- **Source** shows the exact Markdown text with no live decorations. It is the escape hatch for raw syntax and for reviewing what will be saved.
- **Preview** renders the current draft as read-only Markdown. Switching modes does not dirty or rewrite the note, and the CodeMirror instance stays mounted so its selection and undo history survive a preview visit.

The mode is local to the editor session and does not change the note or mark it dirty.

## Formatting and writing commands

The **Format** button above the body opens a compact, keyboard-accessible popover. It offers bold, italic, strikethrough, inline code, headings 1–6, paragraph, blockquote, bulleted/numbered lists, fenced code, and Markdown links. The same commands work in Live and Source modes. Closing an applied action returns focus to the document and retains its logical selection.

- Inline styles toggle existing Markdown delimiters rather than duplicating them. Multiline emphasis applies to nonempty selected line fragments, preserving blank lines and surrounding whitespace. Inline code is for a single line; use a fenced block for multiline code.
- Line commands retain list, checkbox, quote, and indentation context. A selection ending at the beginning of the next line does not format that next line. Formatting commands do not turn literal fenced-code contents into Markdown.
- **Code block** accepts an optional language identifier, preserves the selected code and its indentation, and uses longer fences when the code contains backticks. With no selection, the caret starts inside the new block. Inside an existing fence, the action changes its language identifier instead of nesting a block; a blank identifier removes the language. Identifiers are stored as Markdown; this does not add language-specific syntax highlighting.
- **Insert or edit link** wraps selected text, or inserts a selected `link text` placeholder at the caret. Without a supplied destination, a selected label gets a selected `https://` placeholder. The action edits an existing inline link's destination instead of nesting links. Multiline selections produce one link per nonempty line. Relative paths and anchors are accepted; whitespace and parentheses in destinations are encoded. Wiki links and code literals are kept intact rather than converted into ordinary Markdown links.
- Every formatting action is a CodeMirror transaction and a separate undo step. Reversed selections, multiple selections, and homogeneous CRLF documents retain their selection/source behavior.

| Shortcut in the Markdown body | Action |
| --- | --- |
| Ctrl/Cmd+B | Bold |
| Ctrl/Cmd+I | Italic |
| Ctrl/Cmd+Shift+X | Strikethrough |
| Ctrl/Cmd+E | Inline code |
| Ctrl/Cmd+Shift+C | Fenced code block |
| Ctrl/Cmd+Shift+K | Insert/edit Markdown link |
| Ctrl/Cmd+Alt+1–6 | Heading level |
| Ctrl/Cmd+Alt+0 | Paragraph |
| Ctrl/Cmd+Shift+7 / 8 | Numbered / bulleted list |

Ctrl/Cmd+K remains the workspace command palette; Ctrl/Cmd+S remains the existing immediate save shortcut. Formatting shortcuts leave form inputs and other surfaces alone.

### Lists, indentation, and Enter

List and blockquote continuation, checkbox continuation, ordered-sibling renumbering, and markup-aware Backspace reuse CodeMirror's Markdown commands. Enter continues a checked task as a new unchecked task. Enter on an empty list marker exits one list level immediately.

Tab/Shift+Tab indent/outdent list items, code, and multiline selections by four spaces. An ordinary plain-text caret keeps normal Tab focus navigation. Inside an indentation context, press Escape then Tab to move focus out of the editor.

Inside a code fence, Enter retains the current line's indentation. Enter after a manually typed, unclosed opening fence adds a matching closing fence and places the caret between them; an existing closing fence is not duplicated.

## Source fidelity

- `EditorState.doc` contains the Markdown body. Decorations never write to it.
- Saving uses the same manual Save path and `baseHash` stale-write protection as the rest of Nodus.
- Frontmatter is not part of the editor. It remains outside the body and is preserved by the storage/API layer.
- Unknown Markdown syntax remains raw because the live layer only decorates Markdown nodes it recognizes.

## Markdown preview

Preview uses the existing GFM-capable Lezer Markdown parser and renders nodes as escaped React text/elements. It supports heading levels 1–6 with unique heading anchors, paragraphs and hard breaks, nested ordered/unordered/task lists, blockquotes, horizontal rules, tables, inline emphasis/strike/code, fenced code, links, and images. Syntax-highlight colors and surfaces use theme semantic tokens. Fenced code has a language label, a Copy action, and horizontal scrolling for long lines.

Resolved wiki links use stable note IDs and open through the existing navigation callback. Unresolved and ambiguous wiki links remain visibly inert. Backlinks remain available below the preview. Ordinary external links allow HTTP(S) and mailto destinations; HTTP(S) links open with `noopener noreferrer`. Unsafe protocols are rendered as inert labels. Raw HTML is always escaped.

HTTPS remote images may load with `no-referrer`; other remote protocols are rejected. Relative local images resolve from the Markdown file's folder and are fetched through the local image API, which only returns supported raster formats from regular, non-symlink files inside the active vault, with a 10 MiB size limit. Missing or rejected images show fallback text. SVG and other unsupported formats do not render. Images resize to the available width. Preview rendering does not add an attachment manager or change the vault format.

## Line endings

- Homogeneous LF is preserved.
- Homogeneous CRLF is preserved through `EditorState.lineSeparator`.
- Mixed line endings keep the existing behavior for this phase. They are not promised byte-for-byte fidelity through every edit. `test/editor-state.test.ts` pins the current state-level round-trip behavior.

## Scope and trade-offs

- Preview and Live are read-only renderings of the Markdown draft; edits still happen in CodeMirror and save through the existing autosave/storage path.
- Code highlighting uses a small local tokenizer with theme-colored common tokens rather than language-specific grammars. Unknown constructs remain readable plain code.
- Image files are not copied or managed by Nodus; their existing vault paths remain the source. SVG is intentionally unsupported.
- Task checkboxes are interactive widgets that perform a minimal source transaction. They use the normal undo history.
- Wiki links resolve against the note summaries. Resolved links open on `Mod/Ctrl+click`; ambiguous and unresolved links never choose a target implicitly. Plain click places the source cursor and reveals the raw link.
- This is not a block editor. There are no nested block handles, drag-to-reorder blocks, slash menus, or HTML table widgets.

## Accessibility and performance

- The CodeMirror content node is a labeled multiline textbox.
- Source mode exposes raw Markdown for assistive-technology and editing use.
- Decoration passes start from visible ranges; a large intersecting block may still receive line decorations outside the viewport. The full document is not rendered into DOM nodes. Wiki-link resolution scans visible line ranges and excludes code through the syntax tree.
- Wiki-link title/alias lookup is built once per note-summary snapshot and reused across editor transactions. Updated summaries replace the resolver, so renames, aliases, and deleted targets retain the normal resolution rules.
- Large-note rendering uses CodeMirror's viewport handling, with the block-decoration exception above. Prior measurements: a 100 KB note and an 850 KB note were both usable; the 850 KB note had a single very long line and took about 1.7 seconds to open. A 1 MB note remains unverified; use Source mode if the live editor is not responsive.

## Fallback

If the CodeMirror live layer fails IME, caret/selection, CRLF, accessibility, or large-note acceptance, stop and report the evidence. The fallback is to revert the CodeMirror editor change; there is no second editor in this phase.
