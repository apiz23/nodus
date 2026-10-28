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

- Graph visualization.
- Automatic link rewriting on rename.
- Heading or block targets (`[[Note#Heading]]`). The `#` is treated as part of the title.
- Link extraction from frontmatter fields.

## Knowledge discovery

Discovery in the sidebar and command palette lists unresolved wiki links, ambiguous references,
and orphan notes. A note is an orphan when no other note has a confirmed incoming wiki link;
self-links and ambiguous mentions do not count. Orphans are valid notes, not errors. The scanner
already excludes hidden/system metadata; there is no separate template-note convention to exclude.

Create target preserves the original Markdown and rechecks resolution under the vault write lock.
If a title or alias now resolves, the existing note opens. Ambiguous references require an explicit
choice in the source Markdown. Missing UUID targets create a “Recovered note” with the requested ID.

The editor's linked mentions section opens sources by stable ID and separates ambiguous mentions.
ID links survive moves and title changes. Title/alias links follow the existing resolution rules;
no link text is rewritten on rename.

The reusable `buildLinkIndex` snapshot contains notes, link occurrences (raw text, target, display,
body offsets, line, source ID/path, context, and resolution), and orphan notes. Markdown is the
source of truth. The local API shares an in-memory snapshot for up to five seconds, coalesces
concurrent rebuilds, and invalidates after note writes and restore. External changes appear on the
next request after expiry or immediately with Refresh from disk / Refresh backlinks. Nothing
parses while typing; discovery reflects saved notes. No persistent index or new dependencies are used.

- `GET /api/discovery` returns `unresolved`, `ambiguous`, and `orphans`.
- `POST /api/discovery/create` accepts `{ "target": "Title or UUID" }` and returns the destination note.
- `GET /api/notes/:id/backlinks` returns source titles, snippets, counts, and ambiguity flags.
- Both GET endpoints accept `?refresh=true` to rebuild from disk.
