---
id: TASK-276
title: just is the entry point for the dev stack and restarts it
status: To Do
assignee: []
created_date: '2026-11-25T10:07:00Z'
labels:
  - tooling
milestone: m-4
dependencies: []
ordinal: 96014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The dev stack has two entry points today (pnpm dev and bare mprocs) and pnpm dev only re-attaches to a running stack, so stale processes keep serving old code. Other projects of the owner use a justfile whose dev recipe always restarts the project's own services.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 just dev stops only this repository's running dev processes and starts them again
- [ ] #2 just dev works without a TTY and prints where the stack is
- [ ] #3 just lists recipes for status, logs, stop and down
- [ ] #4 Processes of other projects are never signalled
- [ ] #5 The development guide and AGENTS.md name just as the only entry point
<!-- AC:END -->
