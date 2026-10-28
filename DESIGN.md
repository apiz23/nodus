---
name: Nodus
description: Local-first Markdown knowledge workspace — warm paper neutrals, ink text, one Geist family, moss green as the sole accent.
colors:
  background: "#fbfaf7"
  foreground: "#2b2a26"
  card: "#ffffff"
  card-foreground: "#2b2a26"
  popover: "#ffffff"
  popover-foreground: "#2b2a26"
  primary: "#2b2a26"
  primary-foreground: "#fbfaf7"
  secondary: "#f0eee9"
  secondary-foreground: "#2b2a26"
  muted: "#f1efea"
  muted-foreground: "#6c675e"
  accent: "#edeae3"
  accent-foreground: "#2b2a26"
  success: "#2f7d63"
  destructive: "#c7443e"
  border: "#e6e2da"
  input: "#ddd8cf"
  ring: "#2f7d63"
  sidebar: "#f4f2ed"
  sidebar-foreground: "#2b2a26"
  sidebar-border: "#e3dfd6"
  sidebar-accent: "#e9e6de"
  selection: "#d5e7de"
  tooltip: "#2b2a26"
  tooltip-foreground: "#fbfaf7"
typography:
  display:
    fontFamily: "\"Geist Variable\", ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Helvetica, Arial, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "\"Geist Variable\", ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Helvetica, Arial, sans-serif"
    fontSize: "1.7em"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  title:
    fontFamily: "\"Geist Variable\", ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Helvetica, Arial, sans-serif"
    fontSize: "1.4em"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  body:
    fontFamily: "\"Geist Variable\", ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Helvetica, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
  label:
    fontFamily: "\"Geist Variable\", ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, \"Cascadia Code\", Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "9.6px"
  lg: "12px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "32px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "#2b2a26cc"
    textColor: "{colors.primary-foreground}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "32px"
  button-save-dirty:
    backgroundColor: "{colors.success}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "32px"
  tree-row-selected:
    backgroundColor: "rgba(47, 125, 99, 0.12)"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    height: "28px"
  badge-tag:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.sm}"
    height: "18px"
  tooltip:
    backgroundColor: "{colors.tooltip}"
    textColor: "{colors.tooltip-foreground}"
    rounded: "{rounded.md}"
---

# Design System: Nodus

## Overview

**Creative North Star: "Quiet Craft"**

Nodus is a writing tool that disappears into the page. The world is warm paper, not Notion-gray: every surface is a slightly different temperature of the same warm neutral, and the only chromatic events are moss-green marks — the caret, a wiki link, the active tree row, the dirty→saved transition. Density is lean-operate: a 240px sidebar carries navigation, search, tree, and vault status; everything else is one scrollable editor column.

The system is monochrome-plus-one. Ink (`#2b2a26`) does all structural and action work — text, primary buttons, brand chip. The moss `--success` family (`#2f7d63` light, `#7fbfa6` dark) is reserved for state and connection: links, selection tint, focus rings, caret, active nav, save confirmation, the vault-status dot. Dark mode is a cooler graphite sibling (`#1c1b19` surfaces, `#e8e5df` ink), not a recolor: the same roles, restated.

**Key Characteristics:**
- Warm paper neutrals (light) / cooler graphite neutrals (dark); no pure gray
- One family, Geist Variable, everywhere; monospace only for machine strings (paths, IDs, hashes, code)
- Ink primary buttons; moss green is the sole accent and appears on ≤~10% of any screen
- 12px container radius; 1px borders or a soft shadow on a surface — never both
- Quiet 100–250ms state motion; `prefers-reduced-motion` collapses all of it
- Icons are Lucide line icons at stroke-width 1.75; no glyph or emoji stand-ins for UI icons

## Colors

Palette is warm neutral ladder plus one moss accent; the dark theme is a restatement of the same roles on graphite. Frontmatter values are the light theme (canonical); dark overrides follow each role in parens.

### Primary
- **Ink** (`#2b2a26`; dark `#e8e5df`): all body and UI text, primary button fill, brand chip, tooltip surface. The action color of the system is ink, not the accent.

### Secondary
- **Moss** (`--success` `#2f7d63`; dark `#7fbfa6`): the only accent. Wiki links and inline markdown links, editor caret, text selection tint (`#d5e7de` light / `#2f4a41` dark), focus rings (`--ring`), active sidebar nav and tree rows (12% tint), dirty Save button, "Saved" confirmation, vault-status dot, list bullets.

### Neutral
- **Paper** (`#fbfaf7`): app background.
- **Card White** (`#ffffff`): cards, popovers, dialogs.
- **Sidebar Paper** (`#f4f2ed`; dark `#191817`): sidebar surface, one step deeper than the editor canvas.
- **Warm Gray Text** (`#6c675e`; dark `#a29c90`): secondary text, placeholders, meta, inactive icons.
- **Border** (`#e6e2da`; dark `#333130`) and **Input Border** (`#ddd8cf`; dark `#403d39`): 1px structure and field strokes.
- **Tinted Surfaces** (`#f0eee9` secondary / `#f1efea` muted / `#edeae3` accent hover; dark `#2e2c29` / `#2b2a27` / `#32302c`): selected segments, hover rows, skeletons, chips.

### Named Rules
**The Moss Rule.** Moss green marks state and connection only: links, caret, selection, focus, active nav/tree, save status. Never a large fill, never a page background, never body text. Its rarity is the point — if a screen reads green, the rule is broken.

**The Ink Action Rule.** Primary buttons are ink, not moss. Moss appears on a primary-family control only when the control itself is a state event (the Save button turns moss when and only when the note is dirty).

## Typography

**Display Font:** Geist Variable (`"Geist Variable"` with `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif` fallback)
**Body Font:** Geist Variable (same stack)
**Mono Font:** `ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace` — machine strings only: vault paths, note IDs, SHA hashes, code spans, fenced code, inline key hints

**Character:** One humanist sans does every job from a 40px page title to an 11px status line. The voice is calm and slightly tight at large sizes (negative tracking on titles), open at reading size. There is no second display face and no serif anywhere in chrome or prose.

### Hierarchy
- **Page title** (600, 34px mobile / 40px `sm:up`, line-height 1.15, tracking −0.025em): the note-title input at the top of the editor.
- **Prose H1** (600, 1.7em, line-height 1.3, tracking −0.015em): first-level markdown heading inside the editor.
- **Prose H2–H5** (600, 1.4em → 1em, same line-height/tracking): stepped down per level; H6 shrinks to 0.9em, uppercase, tracking 0.04em.
- **Body** (400, 17px, line-height 1.7): editor prose. Strong text is weight 650; emphasis is italic.
- **UI label** (400–600, 12–13px): sidebar rows 13px, breadcrumb 12px, meta lines 12.5px, status/kbd/tags 11–12px.

### Named Rules
**The One Family Rule.** Geist Variable is the only proportional face. Mono is quarantined to strings a machine owns (paths, IDs, hashes, code). Never introduce a serif, a second sans, or a "display" family for titles — scale and tracking do that work.

## Layout

Desktop is a two-column grid: 240px sidebar + `minmax(0,1fr)` editor (`md:grid-cols-[240px_minmax(0,1fr)]`). Focus mode collapses to a single column. Below `md`, the sidebar becomes a 280px fixed drawer over a `bg-black/20` scrim.

The editor column centers a `max-w-[43rem]` (688px) sheet with `px-6 sm:px-8` gutters and `py-12 sm:py-16` vertical rhythm; prose measures about 65–75 characters per line at 17px. A 44px top bar (`h-11`, `border-b`) carries breadcrumb (hidden below `sm`), save state, Live/Source segment, focus toggle, overflow menu, and Save. Sidebar internals use a 28px row (`h-7`) rhythm, 16px tree indent per depth level, and 8px gaps between groups. Spacing rides the 4px scale; nothing sits off-grid.

## Elevation & Depth

Flat by default. Structure comes from 1px borders (`--border`, `--sidebar-border`) and from tonal steps between canvas, sidebar, card, and tinted surfaces — not from shadows. Soft shadow appears only as state or as floating overlay: `shadow-sm` under the active Live/Source segment and the dirty Save button; Radix menus use `shadow-md`/`shadow-lg` plus a `ring-1 ring-foreground/10`; dialogs float on `ring-1 ring-foreground/10` over a `bg-black/20` scrim. The CodeMirror tooltip carries the one ambient shadow in the system: `0 8px 24px rgba(20, 18, 14, 0.12)`.

### Shadow Vocabulary
- **State lift** (`shadow-sm`): active segment, dirty Save button — paired with a background change, never alone.
- **Overlay** (`shadow-md` / `shadow-lg` + `ring-1 ring-foreground/10`): dropdowns, command palette, dialogs.
- **Editor tooltip** (`0 8px 24px rgba(20, 18, 14, 0.12)`): autocomplete tooltip only.

### Named Rules
**The Border-or-Shadow Rule.** A container carries a 1px border or a soft shadow to separate from its parent — never both on the same resting surface. (Menus are the sanctioned exception: ring + shadow + scrim is the overlay recipe.)

## Shapes

One radius scale derived from `--radius: 0.75rem` (12px): `md` = 0.8× (9.6px) for buttons, inputs, tooltips; `lg` = 12px for dialogs, cards, menus; `sm` = 4px for badges. Two micro-radii recur in shell chrome: 4px on tree/search-result rows and 5px on the Live/Source segment. Borders are always 1px. Scrollbars are thin with a fully round thumb (`border-radius: 999px`, `color-mix` of muted-foreground at 35%). No pills, no hard corners, no clipping tricks.

## Components

### Buttons
Character: compact, ink-first, tactile but quiet. All shadcn-base.
- **Shape:** rounded-md (9.6px), default height 32px (`h-8`); sizes xs 24px / sm 28px / lg 36px / icon squares.
- **Primary:** ink fill (`bg-primary`), paper text, hover at 80% ink, `focus-visible:ring-2 ring-ring/80`, active `translate-y-px`.
- **Ghost:** transparent, hover `bg-muted`; the workhorse for toolbar and sidebar actions.
- **Outline / Secondary / Destructive / Link:** standard shadcn variants on the warm tokens; destructive is tinted (`bg-destructive/10 text-destructive`), not a solid red block.
- **Save (stateful):** ghost at rest (`text-muted-foreground`); when dirty becomes `bg-success text-white shadow-sm` with moss focus ring. Moss fill only while dirty.

### Inputs / Fields
- **Shape:** rounded-md (9.6px), height 32px, `border-input`, transparent background.
- **Focus:** `border-ring` + `ring-2 ring-ring/80`.
- **Sidebar search:** borderless at rest, `bg-sidebar-accent` on hover/focus; 12.5–13px; ⌘K kbd hint right-aligned.
- **Title input:** borderless, 34/40px display type, `ring-1 ring-ring/70` on focus.

### Navigation (sidebar + tree)
- **Sidebar:** 240px desktop, 280px mobile drawer, `bg-sidebar`, `border-r border-sidebar-border`.
- **Nav rows / tree rows:** 28px tall, 4px radius, 13px text; hover `bg-sidebar-accent`; selected `bg-success/12 font-medium` with moss icon (nav) or moss-tinted row (tree); `focus-visible:ring-2 ring-ring/80`.
- **Tree indent:** 16px per depth; folder chevron rotates 90° open (transition-transform).

### Cards / Containers
- **Corner style:** rounded-md or rounded-lg (9.6–12px).
- **Background:** card white / popover, or `bg-muted/40–60` for quiet inset panels.
- **Border:** 1px `border-border`; no resting shadow.
- **Internal padding:** 12–16px (`px-3 py-3` family).

### Chips / Badges
- **Tags:** secondary fill, `rounded` (4px), 18px tall, 11px medium text, `#tag` prefix.
- **Aliases:** outline variant, same geometry.

### Live/Source Segment
- **Shape:** 24px tall, 5px radius, 11px medium labels.
- **Active:** `border-border bg-muted text-foreground shadow-sm`; inactive: transparent border, muted text.

### Tooltips
Ink surface (`bg-tooltip`, paper text), rounded-md, 11–12px, 6px 12px padding. Machine payloads (note ID, hash) set in mono.

### Signature: Live Markdown editor
The CodeMirror surface is the product's face:
- **Caret:** 2px moss bar (`caret-color: var(--success)`), also on body.
- **Selection:** `--selection` token (moss tint).
- **Links:** moss, 1px underline, offset 0.18em, underline color `color-mix` of moss at 45%; unresolved wikilinks go muted-gray dashed, ambiguous dotted. Markdown syntax marks hide until the selection touches them.
- **List bullets:** moss `•` widget replacing the raw `-` mark.
- **Blockquotes:** 2px `border-border` left rule, muted italic.
- **Inline code / fenced code:** mono on `bg-muted`; fenced at 0.88em.
- **Headings:** weight 600, tight leading; no gutter, no active-line highlight.

### Iconography
Lucide React icons, 16px default (`size-4`), stroke-width 1.75 globally. Page icons are user-chosen emoji rendered as content, not as UI chrome.

## Do's and Don'ts

### Do:
- **Do** keep moss green (`#2f7d63` / `#7fbfa6`) on state and connection only: links, caret, selection, focus rings, active nav/tree, dirty-save, status dot.
- **Do** make primary actions ink (`bg-primary`), sized 32px with rounded-md (9.6px) and a `ring-2 ring-ring/80` focus ring.
- **Do** separate surfaces with 1px borders and tonal steps; reach for `shadow-sm`/overlay shadow only as state or floating elevation.
- **Do** set every proportional glyph in Geist Variable; use mono only for paths, IDs, hashes, and code.
- **Do** keep editor prose at 17px/1.7 inside a 65–75-character measure (max-w-[43rem] sheet).
- **Do** respect `prefers-reduced-motion`: state changes stay within 100–250ms and collapse to instant under reduced motion.
- **Do** render icons as Lucide line icons at stroke-width 1.75.

### Don't:
- **Don't** fill large surfaces, page backgrounds, or body text with moss green — the Moss Rule caps it at small state marks.
- **Don't** pair a 1px border and a shadow on the same resting container.
- **Don't** introduce a second font family, a serif, or a decorative display face for titles.
- **Don't** add kickers, eyebrows, or hard offset (neobrutalist) shadows; the system has neither and must not grow them.
- **Don't** substitute text glyphs or emoji for UI icons.
- **Don't** use pure gray neutrals (`#888`-family) or pure black/white chrome; every neutral stays on the warm (light) or graphite (dark) ladder.
- **Don't** use solid destructive red fills for destructive buttons; destructive is tinted (`bg-destructive/10 text-destructive`).
