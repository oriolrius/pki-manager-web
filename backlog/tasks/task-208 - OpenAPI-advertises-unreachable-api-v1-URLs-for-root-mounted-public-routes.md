---
id: TASK-208
title: OpenAPI advertises unreachable /api/v1 URLs for root-mounted public routes
status: In Progress
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
