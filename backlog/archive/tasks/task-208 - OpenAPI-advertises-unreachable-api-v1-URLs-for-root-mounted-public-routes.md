---
id: TASK-208
title: OpenAPI advertises unreachable /api/v1 URLs for root-mounted public routes
status: Done
assignee:
  - '@claude'
created_date: '2026-07-11 16:47'
updated_date: '2026-07-11 17:13'
labels:
  - bug
  - api
  - openapi
milestone: API bugs
dependencies: []
ordinal: 35014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The public trust-material / KRL routes (/ssh/cas/:id/ca.pub, /ssh/host-ca-keys, /ssh/trusted-user-ca-keys, /ssh/cert-authority, /ssh/hosts/:id/cert.pub, /ssh/hosts/:id/sshd-config, /krl/:caId.bin|.json, /krl/hosts/:hostId.bin|.json) are served at the server ROOT but the OpenAPI lists them under servers:[{url:/api/v1}]. A client resolving them therefore requests /api/v1/ssh/... and gets a 404 (confirmed against pki.joor.net). Either exclude these root-mounted routes from the /api/v1 Swagger document, or document them at their real (root) base so every advertised URL is reachable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every path in the published openapi.json resolves to a live route at the documented server base (no advertised URL 404s)
- [x] #2 The public SSH/KRL root routes are either documented at their correct (root) base or omitted from the /api/v1 spec
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Root-mounted public routes (SSH trust-material/KRL, public CRL, CA download, legacy /health, tRPC catch-all) leak into the /api/v1 OpenAPI doc; @fastify/swagger strips the /api/v1 base so root paths resolve to /api/v1/... -> 404.
2. Add schema:{hide:true} to each offending root route in ssh-public.routes.ts, public-crl.routes.ts, and the inline /cas + /health handlers in server.ts (hide affects only the doc, not routing).
3. Hide the tRPC /trpc/{path} catch-all via an encapsulated onRoute hook wrapping the tRPC registration in server.ts.
4. Vitest: boot Fastify like prod, assert offending root paths ABSENT from swagger().paths while routes still MATCH (inject).
5. Typecheck; update ticket.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root-mounted public routes were captured by @fastify/swagger into the /api/v1 OpenAPI doc. @fastify/swagger strips the /api/v1 server base from paths (so a real /api/v1/certificates is documented as /certificates and resolves correctly), but ROOT routes have no /api/v1 prefix to strip, so they were advertised at their literal root path and resolved to /api/v1/<path> -> 404.

Fix (schema:{hide:true} — affects the OpenAPI doc ONLY, not routing/validation/serialization):
- backend/src/rest/routes/ssh-public.routes.ts: /krl/:caId.bin, /krl/:caId.json, /krl/hosts/:hostId.bin, /krl/hosts/:hostId.json, /ssh/cas/:id/ca.pub, /ssh/trusted-user-ca-keys, /ssh/host-ca-keys, /ssh/cert-authority, /ssh/hosts/:id/cert.pub, /ssh/hosts/:id/sshd-config (10 routes).
- backend/src/rest/routes/public-crl.routes.ts: /crl/:caId.:format.
- backend/src/server.ts: /cas/:caId.:format and the legacy root /health.

/trpc handling: the @trpc/server fastify adapter registers a bare fastify.all('/trpc/:path') with no schema, so swagger advertised /trpc/{path}. Its registration lives in server.ts (my file), so I hid it cleanly by wrapping the tRPC register() in an encapsulated child context whose onRoute hook sets schema.hide=true on every tRPC route. Verified empirically: without the wrapper the spec contains /trpc/{path}; with it, absent. No AC changes needed — both remained satisfiable.

Note: root /health is not actually a 404 (the REST /api/v1/health route strips to /health and keeps that spec entry reachable); it was hidden defensively per the ticket allowance.

Test: backend/src/rest/routes/openapi-no-root-routes.test.ts boots Fastify like prod (registerOpenAPI + real registerSshPublicRoutes + real publicCrlRoutes + root /cas stub + real tRPC behind the onRoute wrapper + a /api/v1/certificates positive control), asserts the offending root paths are ABSENT from app.swagger().paths, and injects requests proving the hidden routes are still MATCHED (GET /ssh/host-ca-keys -> 200; GET /crl/x.crl -> handler 404 not framework 404; GET /trpc/ping -> 200 pong).

Command: cd backend && DATABASE_PATH=/tmp/pki-t208.db npx vitest run src/rest/routes/openapi-no-root-routes.test.ts --reporter=basic
Result: Test Files 1 passed (1); Tests 8 passed (8).

Typecheck: npx tsc --noEmit -p tsconfig.json — the only error is a PRE-EXISTING one in external.routes.ts:175 (another owner's file, present with my edits stashed); my changes add zero new type errors.
<!-- SECTION:NOTES:END -->
