---
id: TASK-224
title: 'ZONE-07: REST/OpenAPI zone endpoints + zone filters, parity guard green'
status: To Do
assignee: []
created_date: '2026-09-01 04:48'
updated_date: '2026-09-01 05:41'
labels:
  - ssh-zones
  - ssh-cert-manager
  - backend
  - api
  - rest
milestone: SSH Zones
dependencies:
  - TASK-223
ordinal: 51014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Give the REST/OpenAPI surface everything the tRPC surface got in TASK-223, so scripts, the sibling pki-manager-cli and Ansible can drive a multi-zone installation without a single tRPC call.

TASK-216 brought the SSH REST surface to full parity (52 procedures) and left behind the regression guard backend/src/rest/routes/ssh-rest-parity.test.ts, which enumerates the LIVE tRPC router via sshRouter._def.procedures and fails if any procedure lacks a REST twin, with an assertion that the REST_EXEMPT list stays empty. That guard will fail the moment TASK-223 lands, and closing it is the definition of done here.

Routes to add under the existing /api/v1 block (backend/src/rest/routes/ssh.routes.ts, registered via the `api` instance):
  GET    /zones            list (?includeArchived=)
  POST   /zones            create        (admin)
  GET    /zones/:zoneRef   get by id or slug
  PATCH  /zones/:zoneRef   update display name / description (admin)
  POST   /zones/:zoneRef/archive   and  /unarchive            (admin)

Query filters to add: `?zoneId=` on GET /cas, /trust-anchors, /hosts, /identities, /users/certificates, /principals, /principals/mappings, /principals/stale-hosts, /bulk/expiring, and the mon metrics route. Optional `zoneId` in the bodies of POST /cas, /cas/import, /hosts, /identities, /principals and the token mint route.

Two traps already documented in TASK-216's notes and worth re-reading before starting:
- Fastify validates a declared body schema even when no body is sent, so any reason-only or empty-body POST needs the existing `optionalBody` preValidation hook. The two archive routes take no body -- use it.
- A route whose handler returns a Record rather than an array must declare objectSchema, not an array response schema (this is what broke /principals/mappings).

Path parameter naming: find-my-way rejects two different parameter names at the same path position, so pick `:zoneRef` (accepting id or slug) once and use it consistently.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Zones can be listed, created, fetched, updated and archived over the REST API
- [x] #2 Every SSH list endpoint accepts a zone filter and every creation endpoint accepts an explicit zone
- [ ] #3 All new endpoints appear in the OpenAPI spec and are callable from Swagger UI at /api/docs
- [ ] #4 The REST/tRPC parity test passes with no exemptions, so no zone operation is tRPC-only
- [ ] #5 A duplicate zone slug returns a conflict and an unknown zone returns 404 rather than 500
- [ ] #6 A REST-only client can create a second zone, provision its CAs, enroll a host into it and issue a user certificate there
<!-- AC:END -->





## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. ssh.routes.ts: add the six zone routes, each delegating to the same zone service singleton the tRPC procedure calls and reusing the Zod schemas from ssh-schemas.ts. No logic in the route.
2. Add the ?zoneId= query parameters to the ten list routes and the optional zoneId body field to the six creation routes; declare them in the OpenAPI schema objects so they show up in Swagger.
3. Apply the optionalBody preValidation hook to /zones/:zoneRef/archive and /unarchive.
4. Rely on the router's setErrorHandler (/not found/i -> 404) for SshZoneNotFoundError; verify SshZoneExistsError surfaces as 409 and not 400.
5. Re-run ssh-rest-parity.test.ts and confirm it goes green with REST_EXEMPT still empty; if the zone router is mounted outside sshRouter, extend the guard to enumerate it too rather than exempting it.
6. Extend ssh-rest-new-endpoints.integration.test.ts (or add ssh-zone-rest.integration.test.ts): zone CRUD over REST, 404 on unknown zone, 409 on duplicate slug, ?zoneId= filtering returns only that zone, and an assertion that the new operations appear in the generated OpenAPI document.
7. Smoke the routes against the dev backend and check they render in Swagger UI at /api/docs.
8. pnpm typecheck + full backend suite.
<!-- SECTION:PLAN:END -->
