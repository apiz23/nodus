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

## Health diagnostics

`checkHealth()` reads the optional catalog without changing it. A missing
`.nodus-templates` directory or missing `templates.json` is valid and means the
vault has no templates. An existing catalog is checked with the same strict
parser used by template management. Health issues identify the catalog path and
use the vault's standard issue codes for malformed content, unsupported
versions, duplicate IDs, unsafe paths, and incomplete writes. Messages include
preservation or recovery guidance. An unreadable directory, catalog, or
transaction journal is reported as an issue; health checks do not repair,
rewrite, or remove anything.

The health check also reports an interrupted database-template staging journal
under `.nodus-tmp-template-apply-<uuid>`. A prepared transaction can be recovered
only when the user next explicitly applies a database template. If the journal
is invalid or recovery cannot prove which files belong to the transaction, it
stops and preserves the journal and target files for manual inspection.

## Database application and recovery

Database template application validates and serializes every generated note,
view, and database definition before writing. It then writes all bytes into a
unique hidden staging directory with a manifest, publishes each destination
with exclusive hard links, and publishes the database definition last as the
completion marker. Existing files are never replaced. If a write or publish
fails, rollback removes only destination files whose device and inode still
match the staged file and whose content hash still matches the journal; files
that cannot be proven transaction-owned are left untouched and keep the journal
available for inspection. A later explicit database-template apply retries
recovery from a prepared journal before starting the new application. A
committed journal only needs staging cleanup, which can also be completed on a
later apply.

This is a recoverable staged-write protocol, not a filesystem-wide transaction.
The vault lock coordinates Nodus processes, but external programs do not honor
it, and other readers may observe files while they are being published. A crash
can leave a prepared journal; health reports it and backup/export refuse to
snapshot until it is recovered. A committed application may leave a cleanup
journal, but its complete data remains available and the next explicit apply
can remove the staging files. Ordinary backup, export, and import continue to
carry template catalogs using the version 7 manifest and backward-compatible
versions 1 through 6. Note template creation continues to use the existing
single-file atomic note write.
