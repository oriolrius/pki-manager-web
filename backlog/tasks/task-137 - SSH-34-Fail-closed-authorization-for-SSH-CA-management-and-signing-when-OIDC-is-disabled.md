---
id: TASK-137
title: >-
  SSH-34: Fail-closed authorization for SSH CA management and signing when OIDC
  is disabled
status: To Do
assignee: []
created_date: '2026-06-29 15:42'
labels:
  - ssh-cert-manager
  - backend
  - api
  - security
milestone: SSH Certificate Manager
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
adminRoleMiddleware (init.ts:69-71) returns next() with NO role check whenever OIDC is disabled — the documented default unauthenticated posture. Without a guard, any unauthenticated caller can create/import/rotate/revoke SSH CAs and issue host/user certs: a full CA-forgery and fleet-access primitive. Add a fail-closed guard: when OIDC is disabled and no explicit opt-in is set, refuse SSH CA-management and signing endpoints (tRPC + REST). An explicit env flag (e.g. ALLOW_UNAUTHENTICATED_SSH_CA=true) enables them for local dev only, with a prominent startup warning. Document this alongside the existing 'OIDC optional' note.

**Epic:** SSH API Surface (tRPC + REST/OpenAPI + Automation)
**Logical deps:** SSH-17
**Touchpoints:** backend/src/trpc/init.ts, backend/src/rest/routes/ssh.routes.ts, backend/src/lib/oidc.ts, backend/CLAUDE.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With OIDC disabled and no opt-in, an unauthenticated request to create/import/rotate/revoke an SSH CA or issue an SSH cert is rejected (fail closed) over both tRPC and REST
- [ ] #2 An explicit env opt-in enables unauthenticated SSH CA ops for local dev only, and the server logs a prominent warning at startup when it is set
- [ ] #3 The behaviour is documented next to the 'OIDC optional' note so operators cannot accidentally run SSH issuance unauthenticated in production
- [ ] #4 A test asserts the unauthenticated-create rejection holds unless the opt-in is set
<!-- AC:END -->
