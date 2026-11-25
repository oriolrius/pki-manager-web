---
id: TASK-215
title: 'SSH: expose markPushed over REST (close the last tRPC-only gap)'
status: Done
assignee:
  - '@myself'
created_date: '2026-08-25 05:31'
updated_date: '2026-08-25 05:38'
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
- [x] #1 An operator can clear a host's Stale principals flag using only the REST API, without any tRPC call
- [x] #2 The endpoint appears in the OpenAPI spec and is callable from Swagger UI at /api/docs
- [x] #3 Marking pushed via REST and via tRPC produce identical results (same service method, same audit_log entry)
- [x] #4 Calling the endpoint with an unknown host id returns 404 rather than a 500
- [x] #5 A state-changing call writes an audit_log row on both success and failure
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. services/ssh-principal.service.ts: markPushed() gains a host-existence check (throws SshPrincipalError "host <id> not found") and writes an audit_log row (ssh.principal.mark_pushed) on both success and failure; returns { hostId, fqdn, lastPrincipalPushAt } instead of void.
2. trpc/procedures/ssh.ts: markPushed returns the service result so tRPC and REST are byte-identical (frontend ignores the value -- it only invalidates queries).
3. rest/routes/ssh.routes.ts: add POST /hosts/:id/auth-principals/pushed delegating to the same service method. The router's setErrorHandler already maps /not found/i to 404, so AC#4 falls out of step 1.
4. Tests: extend ssh-openapi.test.ts (route present in spec with a documented response) and add a non-KMS integration test covering REST-clears-stale, unknown-id 404, and the audit_log rows.
5. Verify: pnpm test + typecheck in backend; confirm the endpoint in the local Swagger UI.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Adds POST /api/v1/ssh/hosts/:id/auth-principals/pushed, the REST counterpart to the existing GET .../auth-principals, so a REST-only onboarding never has to break out to tRPC.

Changes:
- services/ssh-principal.service.ts: markPushed() now looks the host up first and throws SshPrincipalError("host <id> not found") instead of silently updating zero rows; writes an audit_log row (ssh.principal.mark_pushed) on success AND failure; returns { hostId, fqdn, lastPrincipalPushAt } (new MarkPushedResult) instead of void.
- lib/audit.ts: new ssh.principal.mark_pushed operation in the AuditOperation union.
- trpc/procedures/ssh.ts: markPushed returns the service result verbatim and routes errors through mapSshError, so tRPC and REST are identical. The frontend ignores the value (it only invalidates queries), so no UI change was needed.
- rest/routes/ssh.routes.ts: the new POST route, delegating to the same service method. The router's existing setErrorHandler maps /not found/i to 404, so no per-route error handling.

Notable: the missing existence check was a real latent bug, not just a 404 nicety — a typo'd host id reported success while the host stayed Stale forever.

Tests: new src/rest/routes/ssh-mark-pushed.integration.test.ts (4 tests, no KMS needed) covers stale->cleared over REST, 404 on unknown id, audit rows on both paths, and REST/service parity; ssh-openapi.test.ts asserts the path is in the generated spec with a 200 response.

Verified: backend typecheck clean; full suite 61 files / 625 tests passing. Also exercised live against the dev backend — path present in /api/v1/openapi.json under the "SSH Certificate Manager" tag, POST returns the payload, unknown id returns 404 {"code":"SSH_ERROR"}, and both audit_log rows land.
<!-- SECTION:NOTES:END -->
