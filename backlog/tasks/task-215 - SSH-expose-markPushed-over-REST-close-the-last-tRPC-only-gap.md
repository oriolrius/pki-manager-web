---
id: TASK-215
title: 'SSH: expose markPushed over REST (close the last tRPC-only gap)'
status: To Do
assignee: []
created_date: '2026-08-25 05:31'
labels:
  - ssh-cert-manager
  - backend
  - api
  - rest
dependencies: []
ordinal: 42014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The SSH surface is meant to be reachable from both APIs — typed tRPC for the frontend and REST/OpenAPI for automation — but 'mark principals pushed' is only available as the tRPC procedure ssh.principal.markPushed (backend/src/trpc/procedures/ssh.ts). backend/src/rest/routes/ssh.routes.ts exposes GET /hosts/:id/auth-principals to RENDER the files, but there is no REST way to clear the resulting Stale flag afterwards.

Impact: any REST-only operator (scripts, the Python pki-manager-cli, Ansible) can register a host, issue its cert, create principals and map them — the whole onboarding — and then has to drop out of REST and hand-craft a tRPC POST just for this last step, or leave the host permanently marked Stale in the UI. Hit while onboarding ovh-ymbihq-node on 2026-08-25: every other step was a clean /api/v1/ssh/... call; markPushed required POST /trpc/ssh.principal.markPushed.

Both APIs must keep delegating to the same service method (sshPrincipalService.markPushed) — no logic duplicated in the route.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An operator can clear a host's Stale principals flag using only the REST API, without any tRPC call
- [ ] #2 The endpoint appears in the OpenAPI spec and is callable from Swagger UI at /api/docs
- [ ] #3 Marking pushed via REST and via tRPC produce identical results (same service method, same audit_log entry)
- [ ] #4 Calling the endpoint with an unknown host id returns 404 rather than a 500
- [ ] #5 A state-changing call writes an audit_log row on both success and failure
<!-- AC:END -->
