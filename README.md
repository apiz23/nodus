# Nodus

Nodus is a local-first workspace for notes, projects, and personal work management. Write in Markdown, link ideas across notes, and organize the same notes as rows, cards, or calendar entries. A vault is a folder on your computer. You can read its Markdown files outside Nodus and use the local workspace without an account.

[Quick start](#quick-start) · [Workspace guide](#workspace-guide) · [Projects and Work Items](#projects-and-work-items) · [Backup and moving data](#backup-and-moving-data) · [Development](#development)

## Quick start

From a checkout of this repository, use Node.js **24 or later** and pnpm **11.9.0**.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

1. Open the [local workspace](http://127.0.0.1:5173/app). The [root page](http://127.0.0.1:5173/) is the product landing page.
2. On first launch, choose the default `./vault` folder or use **Browse…** to select an existing vault folder. Nodus remembers the choice for the next launch. You can change it later from the vault menu or **Settings → Local vault**.
3. In the sidebar’s **Pages** section, choose **New note**, give it a title, and write something. Use **New folder** to organize pages, or a folder’s **New note here** action to create a note directly inside it.
4. Type `[[` in a note to link another page. Use sidebar search to find notes, or press **⌘K** on macOS or **Ctrl+K** to open the command palette and search for notes, folders, databases, and commands.

Use **Browse…** for an existing vault outside the allowed roots for typed paths. If you use **Use folder**, enter an absolute path under an allowed root. By default, typed paths are restricted to the parent of the active vault, or the parent of the default vault on first run. Set `NODUS_VAULT_ROOTS` for additional roots. Use the platform path separator (`:` on macOS/Linux, `;` on Windows).

## Workspace guide

| Where | What you can do |
|---|---|
| **All notes / Pages** | Browse and organize notes and folders, use folder breadcrumbs, edit Markdown, and switch between Live, Source, Preview, or split layouts. Use the editor outline for headings and **Connections** for linked-note context. Add page icons and attachments as needed. [Editor](docs/editor.md) · [Wiki links](docs/wiki-links.md) · [Page icons](docs/page-icons.md) |
| **Search and command palette** | Find notes by title, alias, path, body text, tags, and registered properties. Use operators such as `tag:` and `folder:`, structured filters, saved searches, and search history. The palette also opens recent notes and runs workspace commands. [Search](docs/global-search.md) · [Shortcuts](docs/shortcuts.md) |
| **Tasks** | Write Markdown checkboxes in any note. Open Tasks to search, filter open or completed items, group them, and jump to their source notes. Due dates, scheduled dates, and priorities use Markdown metadata. Checking off a task updates its source note. [Task management](docs/task-management.md) |
| **Databases** | Create a schema, add typed properties, and add notes as records. Open existing records or edit source properties in the view. Save Table, List, Kanban, Calendar, and Gallery views with their own configuration. Relations connect records, while rollups and formulas show derived values. [Saved views](docs/database-views.md) · [Relations and rollups](docs/database-relations.md) · [Formulas](docs/database-formulas.md) |
| **Templates / From template** | Preview and apply reusable note or database templates. Note templates can use variables. Database templates can include saved views and starter rows. The built-in Projects and Work Items templates are available here. [Templates](docs/templates.md) |
| **Discovery** | Review unresolved or ambiguous wiki links, choose the intended note to repair a link, and explore backlinks and related notes. [Wiki links](docs/wiki-links.md) · [Related notes](docs/knowledge-retrieval.md) |
| **Local graph** | Explore connections between notes, filter clusters, find paths between notes, and save graph views. Open a note directly from the graph. [Knowledge graph](docs/knowledge-graph.md) |
| **Knowledge health** | Review vault metrics, connected clusters, and highly connected or recently modified notes. Use the results to navigate to notes, Discovery, or the graph. [Knowledge health](docs/knowledge-graph.md) |
| **Smart organization** | Review suggestions for tags, possible duplicates, folder destinations, and registered properties. Tag changes need preview and explicit application. Folder suggestions are previews. [Smart organization](docs/smart-organization.md) |
| **Documents** | Expand this sidebar section to browse managed PDF and Word (`.docx`) attachments and open them from the workspace. |
| **Settings** | Switch vaults, inspect storage health, manage backups and workspace transfers, and adjust the theme, sidebar, editor, and note panels. Workspace layout preferences are scoped to the vault in the current browser. [Workspace customization](docs/workspace-customization.md) · [Storage health](docs/storage.md#health-checks) |
| **Conflicts** | Experimental relay tools for explicit pairing, manual checks for incoming changes, and conflict review. The local workspace works independently of these tools. |

### Projects and Work Items

1. Open **Templates** or choose **From template** in the sidebar. Under **Project management**, preview and apply **Projects**, then repeat for **Work Items**.
2. In **Databases**, open **Work Items → Edit schema**. Add a **Relation** named **Project**, target your **Projects** database, choose **One record**, and save. This connects Work Items to the project database in your vault.
3. Add project records in **Projects**. Add work records in **Work Items**, then set their **Project**, **Status**, **Priority**, and **Date** as needed. A Markdown checkbox in the **Tasks** dashboard and a Work Items record serve different workflows.
4. Select the **Calendar** saved view in Work Items to see records by their **Date** property. Use the period controls to browse dates and **Today** to jump back. Open an entry to edit its source note. Use a date’s create action to start a Work Item with that date filled in. Work Items without a date stay outside the dated grid.
5. If Calendar reports that a note was created but its date could not be saved, inspect the note before starting another one. The note can remain in the vault while the date write is incomplete. [Calendar behavior and recovery](docs/database-views.md#ui-and-note-mutations)

### Make a database view fit your work

Use filters and sorts to narrow the view. Choose a Select property to group a Kanban board, or choose a Date property to place records on a Calendar. Calendar also supports an optional end date and Month, Week, Day, and Timeline layouts.

In a Table view, open **Columns** to show, hide, or reorder properties. Drag a property header’s divider to resize it, or focus the divider and use the arrow keys. Choose **Save view** to keep the settings for that view. The note title column stays fixed. [Column settings and view formats](docs/database-views.md)

For repeatable local actions, open **Database automations** from the command palette. Automations have local triggers and a constrained set of actions. [Database automations](docs/database-automations.md)

## Backup and moving data

A vault stores Markdown and separate JSON files for database definitions and saved views. It can also contain managed attachments, registered properties, and template data. [Vault layout and storage guarantees](docs/storage.md)

- **Back up before updating or moving a vault.** Open **Backup and restore** from the command palette. Create a backup in an empty directory outside the vault and validate it. Backups use a manifest with file hashes.
- **Verify restore in an empty vault first.** Switch to a separate empty vault, preview the backup, and confirm the source and active destination. Restore merges into the active vault. Overwrite is off by default, and some conflicts remain blocked even when overwrite is enabled. If a restore reports a partial failure, inspect the destination before retrying. [Backup and recovery](docs/storage.md#backup-and-recovery)
- **Transfer a workspace with portable export and import.** Use **Import or export workspace** from the command palette. Export to an empty folder outside the vault. On import, preview the source, review conflicts, and confirm the requested changes. Backups and portable exports have different coverage, so check the included resources before relying on either for migration. [Export and import](docs/storage.md#export-and-import) · [Template portability](docs/templates.md#persistence-and-portability)

## Current limits and privacy

Notes are stored and edited locally. The UI loads font assets from Google Fonts. Normal workspace use requires no account, analytics, telemetry, or AI service. The experimental Conflicts workflow communicates with the relay you explicitly configure, so keep it disconnected for local-only use.

Database, property, and select-option deletion and existing-property type conversion are outside the current UI scope. Background or cloud sync, collaboration, hosted deployment, and a standalone mobile client are outside the current product scope.

## Development

The workspace uses React, Vite, TypeScript, and shadcn/ui. A loopback API opens the filesystem vault from the Node process.

```sh
pnpm typecheck     # root and UI TypeScript checks
pnpm test          # automated suite
pnpm build         # production build
pnpm preview       # serve the build locally
```

The built workspace is available at [127.0.0.1:4173/app](http://127.0.0.1:4173/app). For the optional Chromium smoke suite, see the [browser test guide](docs/browser-smoke.md). For platform-specific development notes, see the [Windows handoff](docs/windows-development.md).

Set `NODUS_VAULT` to pin a vault at startup. That setting overrides the remembered selection on every server restart and creates the configured folder if it is missing. Use the default local ports when possible. If you start on a custom port, set `NODUS_ALLOWED_ORIGINS` to the exact browser origin, including its port, so actions such as vault switching reach the loopback API.

The [documentation index](docs/README.md) covers feature guides, architecture, and project history. See the [note format](docs/note-format.md) and [storage guide](docs/storage.md) for versioning, conditional writes, recovery behavior, and compatibility.

## License

Apache License 2.0. See [LICENSE](LICENSE).
