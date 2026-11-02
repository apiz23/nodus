# Database automations

Automations are local, declarative workflows stored in `.nodus-automations/automations.json`. They refer to databases, records, and properties by UUID. The file is strict JSON (`nodus-database-automations`, version 1) and writes use the vault's atomic sibling-file replacement and root lock. Execution history is stored in `.nodus-automations/history.json`; backup v6 includes both files. Older backup versions remain readable and simply restore without automation files.

## Events and ordering

The current UI emits events when a note is added as a database row, when a structured database property is changed, and before/after a property change is compared for `condition-entered`; deleting a note emits `record-deleted` for each database membership. A `property-updated` automation watches one property ID. Conditions are ANDed. `condition-entered` fires only on a transition from not matching to matching.

For an event, enabled automations for that database are considered in ascending automation UUID order. Actions run in their saved array order. A persisted claim keyed by event ID and automation ID prevents a repeated observation from executing twice, including concurrent API requests. Internal action writes do not emit automation events, so actions cannot recursively start workflows.

## Writes and failure behavior

Every action is checked against the current schema and then uses the existing structured property setter. Each property write is individually validated, stale-checked, root-locked, and atomic. The full action list is not a multi-file transaction: if an action fails, earlier successful actions remain. History records the failure, the number of completed actions, and the error. A missing record, changed schema, invalid value, or vanished property fails safely and is visible in history. Invalid references left by later schema changes are recorded as failures when their trigger occurs.

Deleting a record is terminal for row-local actions, so matching deletion workflows are recorded as failures with the explanation that the record no longer exists. They do not recreate the deleted note. There is no arbitrary script execution, scheduler, cloud service, or background worker. Event delivery occurs in the local API request path.

Execution history is append-only and definitions may be edited or removed independently; old execution entries retain the automation UUID so they remain attributable after deletion. A persisted `running` entry means the process stopped after claiming the event and before recording completion. That event is intentionally not replayed, because replay could duplicate already-applied actions.
