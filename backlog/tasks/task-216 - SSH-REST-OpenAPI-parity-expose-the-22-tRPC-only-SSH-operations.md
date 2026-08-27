---
id: TASK-216
title: 'SSH REST/OpenAPI parity: expose the 22 tRPC-only SSH operations'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-08-27 20:19'
updated_date: '2026-08-27 20:29'
labels:
  - ssh-cert-manager
  - backend
  - api
  - rest
dependencies: []
ordinal: 43014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The SSH service layer is meant to be reachable from both APIs (typed tRPC for the UI, REST/OpenAPI for automation), but an audit of backend/src/trpc/procedures/ssh.ts against backend/src/rest/routes/ssh.routes.ts shows only 38 of 60 procedures have a REST twin. 22 operations the UI can perform are impossible over REST, so scripts, the Python pki-manager-cli and Ansible cannot drive a full SSH CA lifecycle.

Missing, by router:
- ca (5): get, import, revoke, rotate, retire  -> the entire CA lifecycle after create is UI-only
- host (5): get, deployBundle, revoke, registerEciesKey, offboard
- user (4): listIdentities, disableIdentity, offboard, listCertificates
- principal (3): mappingsByPrincipal, delete, staleHosts
- bulk (3): expiring, renew, revoke  -> the whole bulk router
- krl (2): revokeSerial, revokeKey  -> revoke-by-serial and revoke-by-fingerprint

Every new route must delegate to the same service singleton the tRPC procedure calls, validate with the same Zod schema, and add no logic of its own. Follows TASK-215, which closed the markPushed gap the same way.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every SSH operation available over tRPC is also callable over the REST API
- [x] #2 All new endpoints appear in the OpenAPI spec and are callable from Swagger UI at /api/docs
- [x] #3 A REST-only client can run a full SSH CA lifecycle (create/inspect/rotate/retire a CA, onboard/inspect/offboard a host, manage identities and their certs) without any tRPC call
- [x] #4 REST and tRPC return the same data for the same operation, because both call the same service method
- [x] #5 An unknown id returns 404 rather than 500 on every new endpoint
- [x] #6 A test asserts REST/tRPC parity so a future tRPC-only procedure is caught automatically
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add 22 routes to rest/routes/ssh.routes.ts, each delegating to the same service singleton as its tRPC twin, reusing the existing Zod schemas (importSshCaSchema, identityIdSchema, ...) plus small inline ones for bulk/krl bodies.
2. Path conventions: CA sub-routes keep the existing :caId param (find-my-way rejects a different param name at the same position); hosts/identities keep :id. Reads are GET, state changes are POST /<resource>/:id/<verb>, principal delete is DELETE /principals/:id.
3. Errors: the router's setErrorHandler already maps /not found/i to 404, so services that throw a "... not found" message need no per-route handling. Audit any service method that silently no-ops on a bad id (the TASK-215 bug).
4. Tests: a parity test that enumerates the tRPC router and asserts every procedure has a REST route (this is the regression guard, AC#6), plus an integration test exercising the new endpoints against a real Fastify instance, plus OpenAPI presence assertions.
5. Verify: pnpm typecheck + full backend suite; smoke the new routes against the dev backend.
<!-- SECTION:PLAN:END -->
