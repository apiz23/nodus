# Templates

Templates are stored locally in `.nodus-templates/templates.json` as a strict
`nodus-templates` version 1 catalog. The file is optional: an absent file means
the vault has no templates. A malformed or unsupported file is reported as an
invalid vault entry and is never rewritten during reads.

## Note templates

Note templates store title, Markdown body, tags, aliases, icon, custom
frontmatter, and declared variables. Variables have stable machine names and
one of three types: `text`, `date` (`YYYY-MM-DD`), or `number`. Interpolation
uses `{{name}}` and runs only in title, body, aliases, icon, and string-valued
custom frontmatter. Unknown names and invalid values fail preview and apply.
Reserved Nodus frontmatter keys cannot be supplied by a template.

Preview is read-only. Applying creates a new UUID and uses the existing safe
note path allocator. It never replaces a note, even when the generated title
matches another note; normal path suffixing resolves that collision.

## Database templates

Database templates contain a validated database definition, saved views, and
optional starter rows. Starter values are checked using the database's existing
note-property projection and type rules. Applying assigns a fresh database ID,
fresh saved-view IDs, and fresh row note IDs, then submits the whole batch to the
vault's import validator. Existing duplicate-ID, path, and overwrite checks
remain in force. The vault root lock guards validation and writes. Each file is
written atomically; as with existing imports, a filesystem failure after some
files are written is reported as an incomplete/partial import rather than
rolled back as a multi-file transaction.

## Persistence and portability

Catalog reads and writes use the vault root lock, atomic replacement, and
SHA-256 compare-and-swap revisions. Portable export/import carries the catalog
as a managed hidden file. Backup format version 7 records its identity, hash,
size, format version, and count. Backup versions 1 through 6 remain readable;
they simply contain no template catalog. Restore validates the complete
catalog before applying it.

Templates contain declarative data only. Applying them executes no user code
and has no cloud dependency.
