# ADR 01 — Sync Topology

## Status
Approved

## Context
Nodus is a personal knowledge workspace. Phase 3 must let one person keep multiple devices in sync without introducing multi-tenant SaaS complexity.

## Decision
- One relay process serves exactly one vault/person.
- Multiple clients connect to that relay over TLS or a private overlay network.
- The relay is the source of truth for ordered changes, operation results, and device sequences.
- Clients remain authoritative for local file contents; sync is pull/push, not remote filesystem mounting.
- Localhost development uses plain HTTP with a self-signed or automatically generated certificate, documented as insecure for production.

## Consequences
- Simple authorization model: every authenticated device owns the whole vault.
- No need for per-document access control, sharing, or public endpoints in the MVP.
- The relay must not be exposed to the public internet without TLS or an overlay.
