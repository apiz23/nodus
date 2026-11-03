# Workspace customization

## Design proposal

Workspace customization will use one versioned browser-local preference document for the shell and editor layout. It separates a global theme value from per-vault workspace records keyed by the active vault's canonical path. Note content, draft recovery, search history, graph views, and other feature-owned data remain in their existing stores; the new document is not a general replacement for feature persistence.

The first schema will validate every field against safe defaults and bounded values. It will migrate the existing global theme, sidebar width, and editor-width keys when the first vault is opened, assigning the old unscoped layout values to that vault only. Other vaults start with defaults. Invalid preference data must not affect note storage or prevent the app from opening.

The discoverable entry point is **Settings → Workspace**, with a matching command-palette action. All Notes, search, and Settings remain available; configurable navigation sections may be hidden or reordered. Sidebar width continues to use the installed resizable panels component. Editor modes remain backed by the existing Markdown draft state; split preview renders the same draft on both sides and does not add a save path.

Presets will preview their layout changes before applying them. They update only workspace layout fields and keep a one-step, persisted undo snapshot. Resetting workspace preferences never resets the global theme or changes notes. The current layout remains constrained to the existing sidebar and editor panels rather than introducing a general window manager.

## UX decisions

- Common controls live in Settings, which is always pinned in the sidebar; the command palette provides a second route.
- Presets show a concise description of their effects before the user applies them.
- Advanced section ordering and visibility are grouped below the presets.
- Note tree, search, All Notes, and Settings remain reachable; optional navigation entries can be restored from Settings or reset to defaults.
- Existing semantic typography and color tokens are reused. This feature does not load fonts or replace branding assets.

## Implemented in Phase 26

### Preference storage

The browser stores one JSON record at `nodus-workspace-preferences-v1`. Its top-level `version` is `1`; `global.theme` stores the global light/dark theme, and `workspaces` maps the active vault's path to its workspace settings and optional one-step preset undo snapshot. The record contains layout and visibility values only, never Markdown, note titles, or draft content. This is browser-profile storage, so it survives reloads in that profile but is not part of vault backups or portable exports.

Runtime normalization enforces known section IDs, enumerated layouts, booleans, and bounded dimensions (sidebar 200–480 px and split balance 35–65%). Missing or malformed data falls back to defaults with a visible settings message. A future schema version is left untouched and workspace writes are disabled rather than overwriting data created by a newer Nodus. Browser storage failures leave the selected layout active for the current session and show an error. Reset writes defaults for the current vault and leaves the global theme and notes unchanged.

The old global theme and unscoped sidebar/editor width keys are read during migration. Theme remains global; the old widths are assigned once to the first vault opened after migration. Later vaults use their own record or defaults. Search history, saved searches, graph views, draft recovery, and other feature-owned data remain in their existing stores.

### Sidebar and editor

Settings → Workspace is the primary entry point; Settings remains pinned, and the command palette's Settings action includes workspace/layout terms. All Notes and search stay available. Discovery, graph, knowledge health, organization, databases, and templates can be reordered with labeled up/down controls or hidden; the Settings controls restore them, and reset restores all sections. Desktop sidebar width is adjustable by dragging the existing accessible resizer or by choosing a width in Settings; the icon-rail collapse control remains available.

Editor layout offers Live, Source, Preview, and Split. Split mode uses the installed `react-resizable-panels` component: horizontal on wide screens and vertical on narrow screens, with a bounded 35–65% ratio. The same controlled Markdown draft is used in the editor and preview. The editor remains mounted when switching layouts, so the change does not introduce a second draft or persistence mechanism. Existing comfortable/full writing width and below-editor backlinks, relation backlinks, and related-note panels can be configured independently.

### Presets and limitations

Writing, Research, Knowledge management, Database, and Minimal presets describe their effect in a preview dialog before applying. Applying a preset stores the previous workspace for one-step undo. Ordinary subsequent preference changes clear that undo so it cannot unexpectedly revert later edits.

The settings currently customize only existing navigation and note-editor panels; there is no arbitrary pane manager, drag-to-reorder, or custom workspace composition. Preferences are local to one browser profile and are not synced, backed up, or shared between browsers. The feature uses the typography and component tokens present in the checked-out baseline and does not load fonts or alter branding assets.
