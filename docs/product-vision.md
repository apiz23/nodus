# Nodus product vision

**Status:** Long-term product direction. This document describes product intent and future targets. It is not an implementation claim, a release commitment, or authorization to start a roadmap phase. For verified implementation status and the official phase sequence, use the [master roadmap](ROADMAP.md).

## 1. Core identity

Nodus should evolve into a flexible, Notion-style workspace for managing knowledge, projects, and structured information.

Its primary identity is:

> A local-first, customizable workspace where users can organize notes, build databases, manage projects, and create their own workflows without requiring an internet connection or cloud account.

Nodus must remain a fully usable local application. Cloud synchronization and collaboration are future optional capabilities, not requirements for using the core product.

The product should be judged by whether a user can build a useful personal or project workspace from generic primitives: notes, databases, properties, views, relations, tasks, templates, and local files. The application should not require a separate hardcoded feature for every workflow.

## 2. Product principles

### Local-first by default

- Users can use Nodus without registration or an internet connection.
- Local vaults remain the primary foundation.
- Markdown notes and user-owned files remain portable.
- Core features must not depend on an external cloud provider, hosted service, account, or remote API.
- Users retain control over their data, file layout, backups, and export paths.
- A user who never configures a cloud provider must still have the complete Nodus experience, not a reduced or read-only mode.

Local-first is not a temporary implementation detail. It is the product's default operating model.

### Flexible workspace architecture

Nodus should support:

- Workspaces and project organization.
- Notes and documents.
- Customizable databases.
- Database records and properties.
- Saved views.
- Relations, rollups, and formulas.
- Tasks and Calendar.
- Templates and reusable workflows.

These capabilities should compose. A user should be able to create a workflow from shared primitives instead of waiting for a dedicated screen for that workflow.

### Customizable database experience

Users should eventually be able to create their own systems without writing application code.

Example use cases:

- Bug Tracker.
- Test Case Repository.
- Documentation and UI Checklist.
- Project Management.
- CRM.
- University Assignment Tracker.
- Personal Knowledge Base.
- Inventory Management.

A database should be reusable across different workflows. The same database should support multiple saved views, including:

- Table.
- Board (Kanban).
- Calendar.
- Gallery.
- Timeline.

Planned database capabilities include:

- Show/hide columns.
- Reorder and resize columns.
- Custom property types.
- Filtering and sorting.
- Grouping.
- Saved view configurations.
- Relations between databases.
- Rollups and formulas.
- Record detail pages.
- Reusable database templates.

Some foundations already exist, including saved database views, relations, rollups, formulas, and note/database templates. The complete target experience above is not implemented, and the roadmap remains authoritative for current status. These are long-term product goals, not claims that every capability is already available.

## 3. Optional cloud architecture

Nodus should eventually allow users to connect an external cloud backend. This is future direction only; no cloud backend is implemented or required today.

Potential future capabilities:

- User-configured connection to a cloud backend.
- Authentication.
- Remote workspace storage.
- Multi-device synchronization.
- Remote attachments and backups.
- Realtime change notifications.
- Optional shared workspaces.

### Supabase is one possible provider

Supabase is a possible external backend, not a mandatory architectural dependency. A future implementation may support a user-configured Supabase connection as one provider behind provider-neutral interfaces.

- Supabase must not be required to build, start, or use Nodus.
- Core domain logic must not contain Supabase-specific or other cloud-provider-specific assumptions.
- A provider adapter must not bypass vault path safety, conditional writes, revision checks, or explicit user consent.
- Provider choice, credentials, and remote data scope must be explicit and reversible.
- Local-only operation must remain a supported, complete configuration.

### Synchronization and multi-user collaboration are separate

Cloud synchronization and multi-user collaboration are different engineering problems and must not be conflated.

**Synchronization** means keeping one owner's vault consistent across devices. It requires revision tracking, offline operation queues, conflict detection, recovery behavior, and predictable replication.

**Multi-user collaboration** adds shared ownership, invitations, permissions, access control, presence, and concurrent editing. These are separate product and security decisions. They are not implied by adding a cloud provider or by enabling synchronization.

### Future architecture requirements

Any future cloud work should preserve and extend the existing local-first boundaries. Architecture review should consider:

- A storage abstraction that can support local and optional remote implementations.
- Stable entity IDs across devices and providers.
- Revision tracking and stale-write protection.
- Offline operation queues and deterministic replay.
- Conflict detection and explicit conflict resolution.
- Permissions and access control.
- Provider-specific adapters behind provider-neutral contracts.
- Backup, restore, and credential recovery.
- Security and privacy review before production use.

These are requirements for future design work, not implementation commitments in this document.

## 4. Product acceptance vision: O'Chat QA Workspace

**Label:** Future product acceptance scenario. This is a target used to test whether generic Nodus capabilities can support a real workflow. It is not an implemented feature, a new official phase, or a request to hardcode QA-specific screens.

### Scenario

A small QA team wants to run its work in Nodus without a separate bug tracker, test-management service, and documentation checklist application. The accepted long-term outcome is a workspace that demonstrates real project workflows using generic capabilities.

### Databases

| Database | Purpose |
|---|---|
| **Bug Tracker** | Track defects, severity, status, affected platform, project, ownership, and the test cases that expose them. |
| **Test Case Repository** | Store reusable test cases, expected behavior, execution status, platform coverage, and linked defects. |
| **Documentation & UI Checklist** | Track documentation, UI, accessibility, and release-readiness checks linked to projects and features. |

### Target capabilities demonstrated

The O'Chat QA Workspace should eventually support:

- Custom properties for severity, status, platform, project, owner, and dates.
- Configurable columns for each team's working style.
- Multiple saved views over the same data, including Table, Board (Kanban), Calendar, Gallery, and Timeline where appropriate.
- Relations between test cases and bugs, and between checklist items and project areas.
- Filters for severity, status, platform, and project.
- Record detail pages that show properties, related records, and context.
- Templates for creating standardized bug reports, test cases, and checklist items.

### Acceptance intent

The scenario succeeds when the workspace can be assembled from reusable Nodus primitives, not when Nodus ships a dedicated "QA" application. The same generic capabilities should support other workflows, such as a CRM, assignment tracker, inventory system, or personal knowledge base.

### Non-claims

This scenario does not mean that record detail pages, column resizing/reordering, every custom property type, or Timeline views are already complete. It is an acceptance target for future product work.

## 5. Relationship to the official roadmap

The official phase sequence is defined in the [master roadmap](ROADMAP.md) and remains unchanged:

- **Phase 28 — Calendar & Timeline.**
- **Phase 29 — Advanced Import & Export.**
- **Phase 30 — Conflict Resolution.** Plugin Architecture is a separate P0–P8 workstream and is not an official roadmap phase.
- **Phase 31 — Automation & Workflow Engine.**
- **Phase 32 — Product Experience & UX Simplification.**
- **Phase 33 — Tauri Desktop Experience.**
- **Phase 34 — Synchronization.**
- **Phase 35 — Security & Performance.**
- **Phase 36 — Release Readiness.**

This vision does not add official phases, renumber existing phases, or mark incomplete phases as complete.

Phase 34 should support optional cloud connectivity, with Supabase treated as one possible provider rather than a mandatory architecture. Phase 35 remains the security and performance gate for any production synchronization or provider integration.

## 6. Documentation boundary

This document is the authoritative statement of long-term product direction. Feature guides, format specifications, and the roadmap remain authoritative for current behavior and verified status.

No application source code, authentication, invitations, collaboration, Supabase integration, database behavior, or cloud dependency is introduced by this document.
