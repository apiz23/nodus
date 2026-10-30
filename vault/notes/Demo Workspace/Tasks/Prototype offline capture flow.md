---
title: Prototype offline capture flow
tags:
  - demo
  - task
nodus:
  version: 1
  id: 734b0ce2-24dd-4a9b-8e13-63bf718471be
  createdAt: 2026-09-18T09:00:00Z
  updatedAt: 2026-10-28T09:00:00Z
nodus_data:
  format: nodus-note-properties
  version: 1
  databases:
    e20725da-8024-4683-b2c1-b005757f5b2f:
      fe2e8743-4a47-4d55-813c-a92cd449cb7e: 95e3543a-c641-40f9-85f3-9df83fa6a16f
      f19fa92d-f629-467a-b350-15147c639314: ea94ad67-3502-44e0-8934-ae960235c9d0
      6a21e052-c91f-432d-915a-5ddb758bb45e: 2026-11-12
      26152696-1342-4e63-9324-b1f987dc1c09: 8
      a7c270f2-dd65-42c6-abe8-ccd1be7509b6: false
      e831ced1-5004-4819-86a5-213c23394ba6: Beacon Mobile Companion
      f01f88f8-6100-4a5b-856a-8b790be6e4c1: Kenji Watanabe
---
# Prototype offline capture flow

Test a capture flow that writes locally before any sync or network step.

- Project: [[Beacon Mobile Companion]]
- Owner: [[Kenji Watanabe]]
- Reference: [[Local-first software principles]]

The prototype may use in-memory state, but the eventual contract must preserve the local edit.