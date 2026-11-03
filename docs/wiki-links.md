# Nodus Wiki-Link Rules

Nodus notes link to each other with wiki-link syntax. Links stay readable as plain text, and the original text is always kept.

## Syntax

| Form | Meaning |
|---|---|
| `[[Target]]` | Link by title or alias. |
| `[[Target\|Display]]` | Link by title or alias, shown as `Display`. |
| `[[<uuid>]]` | Link by note ID (ID-pinned). |
| `[[<uuid>\|Display]]` | ID-pinned link, shown as `Display`. |
| `[[folder/note]]` | Link by workspace-relative path. |

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
| Anything else | Compared against every note's title and aliases after Unicode NFC normalization, trimming, and lowercasing, then by workspace-relative path without a trailing `.md`. |

For title and alias matching:
- one matching note: `resolved`;
- no matching note: `unresolved`;
- two or more matching notes (for example two notes with the same title, or a title that equals another note's alias): `ambiguous`, with every candidate ID.

Title and alias take precedence over path. Path links are a fallback, accept `folder/note` and `folder/note.md`, normalize `\` to `/`, and are lowercase/NFC-insensitive. External schemes such as `https:` and `mailto:` are ignored as internal relationships.

Nodus never picks one of the candidates automatically.

## Duplicates, missing targets, and renames

- **Duplicate titles** are allowed. Title links to them are `ambiguous`. The ID-pinned form avoids the ambiguity.
- **Missing targets** are `unresolved`. The link text stays in the body unchanged until you create the target or explicitly repair the link.
- **Renamed notes:** ID-pinned links keep working because they match on `id`. Path links break when a note moves.
- **Title changes are rename-safe:** when a note's title changes and confirmed incoming links address the previous title, Nodus retains the previous title as an alias on the renamed note. Existing `[[Old title]]` links keep resolving without rewriting any other Markdown file. The alias is visible and can be removed through normal metadata editing; removing it will break those title links again. A title change that differs only by case or Unicode normalization does not add an alias because resolution already treats those forms as equal.
- **Path links are not rewritten:** moving a note to another folder still breaks links that address the old path. Use ID-pinned links for references that must survive moves.
- **Explicit repair:** Discovery can rewrite one unresolved or ambiguous occurrence to a chosen note. The rewrite preserves explicit display text, adds a readable display when pinning a bare link, and uses the target's stable ID by default. No other note is modified.

## Knowledge discovery and link repair

Discovery in the sidebar and command palette lists unresolved wiki links, ambiguous references,
and isolated notes. `orphans` remains available for API compatibility and means no confirmed
incoming link. The UI uses the stricter **isolated** definition: no confirmed incoming and no
confirmed outgoing internal link. Self-links, unresolved links, and ambiguous mentions do not
count. Isolated notes are valid notes, not errors. The scanner already excludes hidden/system
metadata; there is no separate template-note convention to exclude.

Each unresolved link carries up to three deterministic repair suggestions ranked from note
titles, aliases, workspace paths, shared words, and bounded edit distance. Suggestions are local,
explainable, and never applied automatically. Ambiguous links list their current candidates in
resolver order. A repair is revision-checked against the source note's raw hash, re-verifies the
exact occurrence (offsets, target, and optional display text), and rewrites only that source note.

Create target preserves the original Markdown and rechecks resolution under the vault write lock.
If a title or alias now resolves, the existing note opens. Ambiguous references require an explicit
choice in the source Markdown. Missing UUID targets create a “Recovered note” with the requested ID.

The editor's linked mentions section opens sources by stable ID and separates ambiguous mentions.
ID links survive moves and title changes. Title/alias links follow the existing resolution rules
and benefit from the rename-safe alias behavior described above.

The reusable `buildLinkIndex` snapshot contains notes, link occurrences (raw text, target, display,
body offsets, line, source ID/path, context, and resolution), plus orphan and isolated notes. Markdown is the
source of truth. The local API shares an in-memory snapshot for up to five seconds, coalesces
concurrent rebuilds, and invalidates after note writes and restore. External changes appear on the
next request after expiry or immediately with Refresh from disk / Refresh backlinks. Nothing
parses while typing; discovery reflects saved notes. No persistent index or new dependencies are used.

- `GET /api/discovery` returns `unresolved`, `ambiguous`, `isolated`, and compatibility `orphans`.
  Unresolved and ambiguous entries include bounded `suggestions` with a title, path, score, and
  deterministic reason.
- `POST /api/discovery/create` accepts `{ "target": "Title or UUID" }` and returns the destination note.
- `POST /api/notes/:id/links/repair` accepts `{ "baseHash", "start", "end", "target",
  "replacementNoteId", "display"?, "pin"? }`, rewrites exactly one occurrence, and returns the
  saved note, whether it changed, and whether the target is ID-pinned. `pin` defaults to `true`;
  when a title target would be ambiguous, the server falls back to the stable ID.
- `GET /api/notes/:id/backlinks` returns incoming source titles, snippets, counts, and ambiguity
  flags, plus outgoing link occurrences with resolved target IDs, titles, paths, and status.
- Both GET endpoints accept `?refresh=true` to rebuild from disk.
- `GET /api/insights` and `GET /api/notes/:id/related` reuse the same vault-scoped snapshot for read-only graph metrics, clusters, and deterministic related-note evidence.

## Not implemented

- Automatic rewriting of path links when a note moves. Title renames preserve incoming title
  links through an alias, but moving a note still breaks `[[folder/old-path]]` references.
- Heading or block targets (`[[Note#Heading]]`). The `#` is treated as part of the title.
- Link extraction from frontmatter fields.
- Semantic or AI-assisted suggestions. Repair ranking is deterministic and local.

See [knowledge graph](knowledge-graph.md) for graph projection, filters, virtual unresolved targets,
complexity, and limits.
