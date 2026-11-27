# Windows development handoff

Continuation notes for picking up the responsive editor redesign on a Windows machine.

## 1. Branch and base

| Item | Value |
|---|---|
| Feature branch | `feat/responsive-editor-redesign` |
| Base commit | `3aa063a28fb69cc2c490cda31c1bb565d8b9ff2d` ("Markdown composition: shared view data, saved layouts, large datasets (#38)") |
| Branch tip at handoff | the handoff commit that contains this file; the feature commit before it is `f481096dc16ccbd78c0361c62eac8884c04e8618` |

Feature commits (oldest first):

| Commit | Summary |
|---|---|
| `df22600` | `docs: rewrite README as a workspace guide and fix the New note shortcut hint` |
| `822ea1d` | `feat(ui): report vault storage health from the Settings action` |
| `f481096` | `feat(editor): responsive editor and preview layout with compact tabs` |

## 2. Implementation status

Complete and verified on macOS:

- Responsive editor/preview layout. The editor measures its own frame; at 900 px or more of
  editor area it renders a resizable side-by-side split with a vertical separator and 300 px
  minimum panes. Below that it renders compact `Editor` / `Preview` tabs with the editor
  selected first, arrow-key navigation, and no resize separator.
- Panes stay mounted across tab switches, so the CodeMirror document and unsaved drafts survive.
- Scroll positions are remembered per surface (editor, preview, and each compact tab). A surface
  first shown opens at its natural top.
- Sidebar storage health is reported from the Settings action through a stable `Settings`
  accessible name plus an `aria-describedby` description and a status dot.
- The dead `creating` prop was removed from the sidebar contract; duplicate-create protection
  stays on `createInFlightRef` in `App.tsx`.
- `docs/shortcuts.md` now points at the Pages panel note action instead of the removed
  sidebar-wide `New page` button.

Known issues carried into this handoff:

- The desktop split threshold is 900 px of *editor area*, so a 1024 px window with the sidebar
  open shows compact tabs rather than a split. Confirm this is the intended tablet behaviour.
- Scroll restoration can be overridden by CodeMirror bringing the caret into view when the
  editor is re-shown after a long paste that left the caret at the end of the document. Manual
  verification needed before claiming exact restoration in that flow.
- `scripts/relations-smoke.mjs` fails at its "incoming relation records" step on both this
  branch and clean `3aa063a`; it is a pre-existing script defect, not a regression here.

## 3. Requirements

| Requirement | Value |
|---|---|
| Node.js | 24.0.0 or newer (`engines.node: ">=24.0.0"`); `node:sqlite` is still experimental and logs a warning |
| pnpm | 11.9.0 (`packageManager: "pnpm@11.9.0"`); lockfile `lockfileVersion: '9.0'` |
| Native toolchain | only for `native/executor-lock` (`node-gyp`, C++). Needs Visual Studio Build Tools with the "Desktop development with C++" workload and Python 3. Not required for the app, TypeScript, Vitest, or the Vite build |
| Browsers for smoke scripts | Playwright Chromium: `pnpm exec playwright install chromium` |

## 4. Fresh Windows checkout

Use PowerShell. Do not copy `node_modules`, `dist`, `native/executor-lock/build`, or any macOS
build output from another machine; install dependencies fresh on Windows.

```powershell
git clone git@github.com:apiz23/nodus.git nodus
cd nodus
git fetch origin
git switch --track origin/feat/responsive-editor-redesign

node --version    # must print v24.x or newer
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm --version    # must print 11.9.0
```

Install dependencies from the committed lockfile:

```powershell
pnpm install --frozen-lockfile
```

## 5. Development server

```powershell
# Default vault at .\vault
pnpm dev

# Or point at another vault (the folder must exist)
$env:NODUS_VAULT = "C:\Users\<you>\Documents\NodusVault"
$env:NODUS_VAULT_ROOTS = "C:\Users\<you>\Documents"
pnpm dev
```

The dev server binds `127.0.0.1:5173` (strict port, not exposed on the network). Open
`http://127.0.0.1:5173/app`.

Environment variables read by the local API:

| Variable | Purpose |
|---|---|
| `NODUS_VAULT` | Vault folder to open |
| `NODUS_VAULT_ROOTS` | Additional allowed roots, separated by `;` on Windows (`:` on macOS/Linux) |
| `NODUS_ALLOWED_ORIGINS` | Extra allowed browser origins (comma separated) |
| `NODUS_BACKUP_ROOTS` | Extra roots allowed for backups and portable export targets |
| `NODUS_PREFERENCES_PATH` | Where UI preferences are stored |

Smoke scripts set their own temporary vaults; they do not touch `.\vault`.

## 6. TypeScript

```powershell
pnpm exec tsc --noEmit                  # server/core
pnpm exec tsc -p tsconfig.ui.json --noEmit   # UI, includes test/ui-sidebar.test.tsx and test/ui-editor-split-layout.test.tsx
```

`pnpm typecheck` runs both, but it goes through the pinned pnpm shim; on a machine where the
pinned `@pnpm/exe` binary is unavailable, call the two `tsc` commands above directly.

## 7. Tests

```powershell
# Full Vitest suite
pnpm test

# Focused responsive editor and sidebar coverage
pnpm exec vitest run test/ui-editor-split-layout.test.tsx test/ui-editor-layout.test.tsx test/ui-sidebar.test.tsx test/ui-editor-reliability.test.ts test/editor-markdown-preview.test.tsx test/editor-vault-identity.test.tsx test/editor-preview-prop.test.tsx test/markdown-embed-insertion.test.tsx test/markdown-embed-limits.test.tsx
```

The full suite spawns one worker per file and is load-sensitive: on a busy machine some storage
and sync tests hit their 5 s timeouts. Re-run the failing files individually before treating a
failure as real, or bound the workers:

```powershell
pnpm exec vitest run --maxWorkers=4
```

Browser smoke scripts (each boots its own Vite server on an ephemeral port):

```powershell
pnpm exec playwright install chromium
node scripts/workspace-customization-smoke.mjs   # responsive tabs, pane bounds, overflow
node scripts/search-smoke.mjs
node scripts/project-management-smoke.mjs
```

## 8. Build

```powershell
pnpm build
```

Output goes to `ui\dist`. Chunk-size warnings above 500 kB are expected and non-fatal.

## 9. Windows-specific risks

1. **Native executor lock** — `native/executor-lock` compiles with node-gyp. Without VS Build
   Tools and Python 3, `pnpm build:executor-lock` and `pnpm test:executor-lock` fail; the rest of
   the project builds and tests without it.
2. **Path separators** — the app uses `node:path` for filesystem work, but `NODUS_VAULT_ROOTS`
   and vault paths in docs assume the platform separator (`;` on Windows). Markdown note paths
   inside a vault are always `/`; do not hand-edit them with backslashes.
3. **Case sensitivity** — macOS and Windows default filesystems are case-insensitive while CI
   Linux is not. `tsc` currently resolves every `@/` import, but new imports should match file
   case exactly.
4. **File watchers** — the dev server watches vault snapshots; large vaults on OneDrive or other
   synchronised folders can drop or delay events. Keep test vaults on a local disk.
5. **Long paths** — deep vault folders plus `node_modules` can exceed 260 characters unless
   `LongPathsEnabled` is set. Clone near the drive root, e.g. `C:\dev\nodus`.
6. **Line endings** — commits are made with the repository's default settings; check
   `git config core.autocrlf` before committing on Windows so Markdown snapshots stay byte-stable.
7. **`node:sqlite` experimental warning** — expected on Node 24; it does not indicate a failure.
8. **Port 5173 is strict** — a second `pnpm dev` will fail rather than pick another port.

## 10. Remaining manual verification

Not covered by macOS automation:

- Safari (desktop and iOS) — tab keyboard handling, `ResizeObserver` timing, the 900 px split
  threshold.
- Firefox — separator drag bounds and tab focus order.
- Physical iOS and Android — on-screen keyboard with the compact tab bar, and scroll restoration
  after the keyboard resizes the viewport.
- Windows — Chrome and Edge at 390, 640, 768, 1024, 1280, and 1440 px, plus 125%/150% display
  scaling, which changes the effective CSS width and therefore whether compact tabs or the split
  renders.
- Windows — native executor-lock build and `pnpm test:executor-lock`.
- Windows — full `pnpm test` under a normal desktop workload to confirm the 5 s timeout budget.
