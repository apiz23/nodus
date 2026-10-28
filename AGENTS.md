# Nodus contributor instructions

## Standing shadcn/ui component reuse policy

- Before building or changing UI, inspect and reuse the existing shadcn/ui components in `ui/src/components/ui` and established product compositions.
- Compose existing primitives for inputs, buttons, menus, dialogs, command palettes, lists, and feedback. Prefer their existing variants, semantic tokens, accessibility, and keyboard behavior over custom replacements.
- Consult the repository's shadcn skill and the relevant component documentation. Preserve local component customizations; do not overwrite or reinstall components as part of routine feature work.
- Add a component or dependency only when existing primitives cannot reasonably satisfy the feature, and explain the reason. Keep the current Vite/React/TypeScript architecture.
- Use the standard component for the job: Button for actions, Input/Textarea for text, Select for short choices, Command inside Popover for searchable or long lists, Popover for compact contextual controls, DropdownMenu for action menus, Sheet for long contextual forms, Dialog for focused tasks, AlertDialog for destructive confirmation, Tabs for sections, Collapsible/Accordion for secondary content, Badge for metadata, Table for tabular data, Tooltip for supplemental text, and Checkbox/RadioGroup/Switch corresponding to their semantics.
- Custom domain components such as database tables, Kanban, calendar, tree navigation, graph views, and editor integration are allowed, but their controls, menus, dialogs, inputs, and feedback must compose the shared shadcn/ui primitives and design tokens.
- Avoid nested overlays when a simpler native control or inline form is clearer. Never use a tooltip as the only access to an action or essential content.
- Preserve unrelated working-tree changes. Do not reset, clean, stage, commit, or push unless explicitly requested.
