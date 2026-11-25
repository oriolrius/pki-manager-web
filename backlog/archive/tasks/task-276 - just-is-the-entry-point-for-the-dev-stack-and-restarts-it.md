---
id: TASK-276
title: just is the entry point for the dev stack and restarts it
status: Done
assignee:
  - '@claude'
created_date: '2026-11-25T10:07:00Z'
updated_date: '2026-11-25T10:54:00Z'
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
- [x] #1 just dev stops only this repository's running dev processes and starts them again
- [x] #2 just dev works without a TTY and prints where the stack is
- [x] #3 just lists recipes for status, logs, stop and down
- [x] #4 Processes of other projects are never signalled
- [x] #5 The development guide and AGENTS.md name just as the only entry point
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
`just` is the single entry point of the dev stack.

- `justfile`: dev (restart), attach, status, urls, logs, stop, down, setup, test, typecheck, lint, build, db-migrate, site-dev/build/preview, demo.
- `scripts/dev-session.sh`: `restart` stops this repository's tmux session and its leftovers on our ports, refuses when another project holds a port, starts KMS/Keycloak and mprocs with `--log-dir .dev-logs`.
- A process is ours only when its working directory is inside this repository or one of its worktrees; the docker dependencies always run from the main checkout.
- Removed the root `pnpm dev:*` scripts.

Tested on the real dev stack: first start without a TTY, restart (all three PIDs changed), logs, stop, a foreign listener on 52080 (refused, not killed), a leftover of this repository (stopped, then started).
<!-- SECTION:NOTES:END -->
