# Keyboard shortcuts and command palette

Nodus keeps application shortcuts in one registry (`ui/src/shortcuts.ts`) and derives both the key handler and the in-app reference from it. The command palette (`ui/src/CommandPalette.tsx`) is the discoverable surface for every workspace action.

## Shortcut reference

| Action | macOS | Windows / Linux | Available while typing |
|---|---|---|---|
| Command palette | `⌘K` | `Ctrl+K` | Yes, in the Markdown editor and sidebar search |
| New note | `⌘N` | `Ctrl+N` | No; use the palette or New page button |
| Save note | `⌘S` | `Ctrl+S` | Yes, in the Markdown editor and title |
| Recent notes | `⌘⇧H` | `Ctrl+Shift+H` | Yes, in the Markdown editor |
| Keyboard shortcuts | `⌘/` | `Ctrl+/` | Yes, including text fields |

Open **Keyboard shortcuts** from the command palette or press the reference shortcut. The dialog lists every binding, grouped as Workspace, Notes, and Help.

### Focus rules

- Global shortcuts never run while an unexpected modal, conflict, recovery, or busy vault operation is active.
- `New note` is suppressed while any text field has focus, including the Markdown editor.
- `Save note` runs only for the active editor/title, not from sidebar search or unrelated form fields.
- The command palette can open from the Markdown editor and from sidebar search; it toggles closed with the same shortcut.
- Checkboxes, radio buttons, buttons, and other non-text inputs do not suppress shortcuts.
- Both `Meta` and `Ctrl` are accepted as the primary modifier for cross-platform keyboard muscle memory. The reference UI and command list display the platform-correct label.
- IME composition and already-handled events are ignored.

## Command palette

Press the palette shortcut or choose an action from the sidebar. The palette:

- Groups actions by **Notes**, **Navigation**, **Databases**, **Folders**, **Appearance**, and **Help**, plus a **Recent notes** group in the empty state.
- Searches command names, keyword aliases, and categories. A command with no matching title token can still match through keywords such as `create`, `history`, `appearance`, or `settings`.
- Shows each command’s keyboard shortcut beside its label.
- Lists matching notes below command groups using the existing server-ranked search. Notes open by stable ID.
- Lists databases by stable database ID and folders by path. Opening a folder returns to All notes with its path as the search query; opening a database selects it in the Databases view.
- Deduplicates command registrations by stable command ID, keeping the first definition.
- Keeps the palette open when a command rejects, shows an alert with a **Try again** action, and closes only after success.
- Shows separate loading, no-results, and search-error states with a retry action.
- Uses shadcn `CommandDialog` and `cmdk` for Enter/Arrow/Home/End/Escape keyboard navigation. The search input is focused on open and labelled **Search notes or commands**.

Clicking or pressing Enter runs the same application handlers used by the visible UI, including unsaved-change confirmation and stale-write handling.

## Recent notes

**Recent notes** (`⌘⇧H` / `Ctrl+Shift+H`) opens a keyboard-only quick switcher for up to 12 recently opened notes in the current vault.

- Notes are recorded after they load successfully.
- History is stored per vault in `localStorage` under `nodus-recent-notes-v1`, next to the existing theme, sidebar-width, and editor-width preferences.
- Entries use stable note IDs. Before display, App reconciles them against the current note list, so deleted notes disappear and moved or renamed notes use their current title and path.
- Corrupt JSON, unknown versions, invalid entries, duplicate IDs, and unavailable/full storage are ignored or discarded without blocking navigation.
- Clearing a vault’s history removes only that vault’s key. There is no server-side recent-note state and no change to the vault contents.

## Accessibility

- The command, recent-notes, and shortcut-reference dialogs have accessible names and descriptions.
- The command and recent-notes search inputs have explicit labels and focused-on-open behavior.
- Command items expose option roles and labels; notes include an explicit **Open <title>** label.
- Arrow keys, Home/End, Enter, and Escape are handled by the shared command primitive.
- Shortcut labels are visible text, not the only way to discover an action; every command has a name and description.
- Focus returns to the previous element when a dialog closes through the shared dialog primitive.

## Verification

Focused:

```sh
pnpm exec vitest run test/ui-command-palette.test.ts test/ui-search.test.ts test/ui-sidebar.test.tsx
pnpm test:browser
```

Broad:

```sh
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

`test/ui-command-palette.test.ts` covers command registration, deduplication, search/ranking, grouping, execution failures, shortcut conflicts, platform labels, focus policy, text-entry detection, recent-note persistence, moved/deleted destinations, and corrupt-preference recovery. `scripts/browser-smoke.mjs` covers real keyboard navigation, palette command execution, recent-note switching, shortcut labels, and the shortcut reference dialog.
