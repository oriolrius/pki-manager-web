---
id: TASK-136
title: >-
  SSH-18: REST routes + OpenAPI under /api/v1/ssh (authenticated CRUD) + public
  download routes
status: Done
assignee:
  - '@myself'
created_date: '2026-06-29 15:42'
updated_date: '2026-06-29 18:11'
labels:
  - ssh-cert-manager
  - backend
  - api
milestone: SSH Certificate Manager
dependencies:
  - TASK-135
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add rest/routes/ssh.routes.ts registered in rest/index.ts under prefix /ssh for AUTHENTICATED CRUD, with JSON schemas sourced from ssh-schemas.ts via openapi-schemas.ts (same Swagger at /api/docs). SEPARATELY, the PUBLIC OpenSSH-format download endpoints (GET /ssh/cas/:id/ca.pub, /trusted-user-ca-keys, /cert-authority?pattern=, /ssh/hosts/:id/cert.pub, /ssh/hosts/:id/sshd-config) are registered like the existing public /crl route — bare server.get(...) on the Fastify instance OUTSIDE registerRestApi and added to the public-path allowlist — because the real /crl route is NOT inside the /api/v1 OpenAPI block; this task does NOT claim a single endpoint is both swaggered-under-/api/v1 AND public. The PUBLIC raw /krl/:caId.bin bytes-serving route is owned solely by SSH-22, not here.

**Epic:** SSH API Surface (tRPC + REST/OpenAPI + Automation)
**Logical deps:** SSH-17
**Touchpoints:** backend/src/rest/routes/ssh.routes.ts, backend/src/rest/index.ts, backend/src/server.ts, backend/src/rest/schemas/openapi-schemas.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Authenticated SSH CRUD operations are callable over REST under /api/v1/ssh and documented in the same Swagger UI at /api/docs as existing endpoints with the standard {error:{code,message}} shape
- [x] #2 Public GET /ssh/cas/:id/trusted-user-ca-keys returns exactly the bytes for sshd's TrustedUserCAKeys, and /cert-authority?pattern=*.example.com returns a ready-to-paste '@cert-authority' known_hosts line, both reachable without OIDC via the public-path allowlist
- [x] #3 Public GET /ssh/hosts/:id/sshd-config returns a downloadable ready-to-paste sshd_config drop-in; creating an SSH CA via REST and via tRPC produces identical ssh_cas records
- [x] #4 This task does not implement the public raw /krl bytes route (owned by SSH-22) and does not claim the public download routes are inside the /api/v1 Swagger block
<!-- AC:END -->
