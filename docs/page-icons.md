# Page icons

Page icons are optional, user-owned metadata. They are stored as a top-level `icon` key in the note's existing YAML frontmatter:

```yaml
---
title: Launch plan
icon: "🚀"
nodus:
  version: 1
  id: 11111111-1111-4111-8111-111111111111
  createdAt: 2026-10-25T09:00:00Z
  updatedAt: 2026-10-25T10:30:00Z
---
```

## Semantics

- `icon` is optional. An absent icon shows the generic page glyph.
- The value is a short emoji or glyph, limited to eight Unicode code points. Control characters and leading/trailing whitespace are rejected.
- Saving with `icon` omitted preserves the existing raw value, including an invalid value written by another editor.
- Saving with `icon: null` removes only the `icon` key; unknown frontmatter and all Nodus fields remain.
- Saving with a string sets that value after validation.

The `nodus.version: 1` above is the existing note-format version. Icons do not add or change a schema version.

## Portability and external edits

The icon is ordinary frontmatter. Export, import, backup, moves, and sync carry it as note content. A user editing the Markdown outside Nodus can add, change, or remove the key. Nodus ignores an invalid external value visually but does not silently delete it during an unrelated save.

Stable note IDs, timestamps, tags, aliases, unknown frontmatter, and the Markdown body are unaffected.

## Not supported

- Image/icon uploads or remote icon URLs.
- A separate icon database or sidecar.
- Per-folder icons or icon changes that rewrite wiki links.
