# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person using Nodus across several personal devices. Primary context: a laptop or desktop workspace with a local vault, plus an optional home-controlled relay for device-to-device sync. Nodus is not designed for shared team editing or multi-tenant accounts.

## Product Purpose

Nodus is a lightweight, local-first knowledge workspace for linked Markdown notes and structured database definitions. It exists so a person can organize notes and reference data without giving up ownership of the underlying files. Success means the vault remains readable and editable outside Nodus, local work remains usable offline, and optional sync does not silently lose or overwrite edits.

## Positioning

Nodus combines the portability of an Obsidian-style Markdown vault with the structured organization of a lightweight Notion-style workspace. The distinguishing mechanism is a plain-file vault with stable UUID identity, portable JSON database definitions, and an optional single-owner relay that syncs versioned changes rather than taking ownership of the files.

## Operating Context

- The user opens a local vault directory containing Markdown notes and `databases/*.json` definitions.
- Notes are edited as Markdown with YAML frontmatter; the body remains portable.
- The React/Vite UI runs on localhost and talks to a local Node API, never directly to relay admin endpoints.
- Cross-device sync is optional, CLI-first, and uses a home-controlled relay.
- Backups, import/export, and recovery are part of normal vault stewardship.
- The UI is desktop-friendly and responsive to narrow screens; it is not a mobile-native app.

## Capabilities and Constraints

Confirmed implemented or present in the repository:
- Markdown notes with YAML frontmatter, stable UUID v4 IDs, tags, aliases, and wiki links.
- Versioned JSON database definitions with typed properties.
- Filesystem vault CRUD, path safety, atomic per-file writes, portable export/import, and verified backup/restore.
- React/Vite local UI with note editing, search, command palette, read-only database schemas, settings, and local folder selection.
- Node/SQLite relay foundation with device pairing, hashed bearer tokens, revisions, change feed, tombstones, and retired IDs.
- Programmatic sync client foundation with outbox, apply ledger, cursor, bootstrap, pull/push, and conflict copies.

Constraints:
- Markdown files and portable database definitions remain the source of truth.
- Core reading and editing must work offline without an account.
- One owner; one personal relay per vault.
- No telemetry, analytics, hidden network calls, or third-party data transfer.
- Sync metadata stays outside Markdown and outside the vault content format.
- Conflicts must be explicit and preserve divergent edits; no silent last-write-wins for synced notes.
- No CRDTs in the current product direction.
- Database rows, views, relations, formulas, query execution, publishing, and multi-user collaboration are not implemented.
- The local UI does not currently call relay sync endpoints; UI sync is not connected.
- Sync is experimental and not yet suitable for production multi-device use.

Undecided or not yet proven:
- Production packaging and keychain-based credential storage.
- End-to-end encryption for any non-home relay.
- Backup/restore orchestration for the relay.
- Exact production sync onboarding and conflict-resolution UX.

## Brand Commitments

- Name: Nodus.
- Voice: calm, direct, plain language; no hype or productivity theater.
- The product should feel like a quiet workspace for real work, not a generic admin dashboard or marketing landing page.
- Preserve user ownership and file portability in all product communication.

## Evidence on Hand

- `README.md` — product overview, storage layout, scope, local UI, and privacy claims.
- `docs/note-format.md`, `docs/database-format.md`, `docs/wiki-links.md` — portable format contracts.
- `docs/storage.md` — storage guarantees and limitations.
- `docs/phase3/` — sync architecture, protocol, threat model, acceptance criteria, and roadmap.
- `src/` — domain, format, storage, relay, sync, and local API implementations.
- `ui/src/` — working React UI and shadcn/Tailwind system.
- `test/` — current behavior and regression coverage.

## Product Principles

1. **The vault belongs to the user.** Plain Markdown and portable JSON outrank application convenience.
2. **Local work is the default.** Offline editing is not a degraded mode.
3. **Never silently lose an edit.** Conflicts are explicit and divergent content is preserved.
4. **Quiet utility over spectacle.** The workspace should disappear into the task.
5. **Sync is optional, private, and understandable.** One owner, a home relay, and recoverable state.

## Accessibility & Inclusion

The current UI targets keyboard access, visible focus states, semantic labels, and responsive layouts on small screens. No formal WCAG conformance level has been confirmed.
