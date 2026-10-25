# Nodus Wiki-Link Rules

Nodus notes link to each other with wiki-link syntax. Links stay readable as plain text, and the original text is always kept.

## Syntax

| Form | Meaning |
|---|---|
| `[[Target]]` | Link by title or alias. |
| `[[Target\|Display]]` | Link by title or alias, shown as `Display`. |
| `[[<uuid>]]` | Link by note ID (ID-pinned). |
| `[[<uuid>\|Display]]` | ID-pinned link, shown as `Display`. |

Rules:
- The target cannot contain `[`, `]`, `|`, or a line break.
- Only the first `|` separates the target from the display text. Any further `|` is kept as literal display text.
- The target is trimmed. A target that is empty after trimming is not a link.
- Display text is kept as written.
- Links cannot span lines.

## Scanning

`parseWikiLinks(body)` returns each link with:
- `raw`: the exact original text, for example `[[Roadmap|plan]]`.
- `target` and `display` (only when a `|` is present).
- `start` and `end`: offsets into the body, so `body.slice(start, end) === raw`.

Links are ignored inside:
- fenced code blocks (` ``` ` or `~~~`, with up to three leading spaces). A fence closes only with a marker of the same character that is at least as long as the opening marker;
- inline code spans delimited by backticks, on one line.

Scanning never changes the body. `raw` is never rewritten.

## Resolution

`resolveLink(target, notes)` maps a target to a note:

| Target | Result |
|---|---|
| Lowercase UUID v4 | `resolved` if a note has that `id`, otherwise `unresolved`. Titles are not checked. |
| Anything else | Compared against every note's title and aliases after Unicode NFC normalization, trimming, and lowercasing. |

For title and alias matching:
- one matching note: `resolved`;
- no matching note: `unresolved`;
- two or more matching notes (for example two notes with the same title, or a title that equals another note's alias): `ambiguous`, with every candidate ID.

Nodus never picks one of the candidates automatically.

## Duplicates, missing targets, and renames

- **Duplicate titles** are allowed. Title links to them are `ambiguous`. The ID-pinned form avoids the ambiguity.
- **Missing targets** are `unresolved`. The link text stays in the body unchanged.
- **Renamed notes:** title and alias links break after a rename, because they are matched by text. ID-pinned links keep working, because they match on `id`. Phase 1 does not rewrite links when a note is renamed, so a rename can leave title links unresolved. Use the ID-pinned form for links that must survive renames.

## Not implemented in Phase 1

- Backlinks index or graph.
- Automatic link rewriting on rename.
- Heading or block targets (`[[Note#Heading]]`). The `#` is treated as part of the title.
- Link autocomplete, search, or any editor integration.
- Link extraction from frontmatter fields.
