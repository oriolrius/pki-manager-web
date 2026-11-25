---
id: TASK-216
title: 'SSH REST/OpenAPI parity: expose the 22 tRPC-only SSH operations'
status: Done
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Brings the SSH REST surface to full parity with tRPC: all 52 procedures are now reachable over /api/v1/ssh (30 were before; 22 added).

New routes in rest/routes/ssh.routes.ts, each delegating to the same service singleton as its tRPC twin:
- CA: GET /cas/:caId · POST /cas/import · POST /cas/:caId/{revoke,rotate,retire}
- Host: GET /hosts/:id · GET /hosts/:id/deploy-bundle · POST /hosts/:id/{revoke,ecies-key,offboard}
- Identity: GET /identities · POST /identities/:id/{disable,offboard} · GET /users/certificates
- Principal: GET /principals/mappings · GET /principals/stale-hosts · DELETE /principals/:id
- Bulk: GET /bulk/expiring · POST /bulk/{renew,revoke}
- KRL: POST /cas/:caId/{revoke-serial,revoke-key}

Two latent service bugs found and fixed (same class as the TASK-215 markPushed no-op):
- deletePrincipal() had no existence check: deleting an unknown id removed zero rows and reported success. Now throws -> 404.
- revokeCurrent() collapsed "no such host" and "host has no live cert" into one message, so a typo'd id surfaced as a 400 state error. Now distinguishes them -> 404 vs 400.

Two REST-layer defects caught by the new tests, not by review:
- /principals/mappings returned 400 because mappingsByPrincipal yields a Record, not an array, and the route declared an array response schema. Now objectSchema.
- Fastify validates a declared body schema even when no body is sent, so reason-only POSTs rejected a bare `curl -X POST` with "body must be object". Added an optionalBody preValidation hook that defaults the body to {}; applied to the four new reason-only routes and to the pre-existing /certs/:id/revoke, which had the same flaw.

Tests:
- ssh-rest-parity.test.ts (55 tests) is the regression guard: it enumerates the LIVE tRPC router via sshRouter._def.procedures and asserts every procedure maps to a registered REST operation. Adding a tRPC-only procedure now fails CI. Verified the guard actually fails by temporarily deleting a mapping. REST_EXEMPT is empty and a test asserts it stays empty.
- ssh-rest-new-endpoints.integration.test.ts (22 tests, no KMS): reads, state changes, the in-use principal delete rejection, optional reason bodies, and a 404-on-unknown-id table across 10 new routes.

Verified: typecheck clean; full backend suite 63 files / 702 tests (was 61/625). Smoked live against the dev backend: /identities, /cas/:caId, /hosts/:id/deploy-bundle, /bulk/expiring, /principals/mappings, a bare POST /hosts/:id/revoke, and a 404.
<!-- SECTION:NOTES:END -->
