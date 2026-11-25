---
id: TASK-135
title: 'SSH-17: tRPC sub-routers (ssh.ca/host/user/principal) wired into router.ts'
status: Done
assignee: []
created_date: '2026-06-29 15:42'
updated_date: '2026-06-29 18:07'
labels:
  - ssh-cert-manager
  - backend
  - api
milestone: SSH Certificate Manager
dependencies:
  - TASK-127
  - TASK-128
  - TASK-130
  - TASK-131
  - TASK-132
  - TASK-134
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add procedures/ssh-ca.ts, ssh-host.ts, ssh-user.ts, ssh-principal.ts following procedures/certificate.ts/crl.ts: protected procedures for issuance/reads, admin procedures for CA create/import/rotate/revoke, Zod input from ssh-schemas.ts, ctx { db, ipAddress: ctx.req.ip }, a mapServiceError helper. Compose an `ssh` namespace router in trpc/router.ts alongside the existing routers. (The ssh.krl sub-router is added with SSH-21.) NOTE the admin gate is only effective with OIDC enabled; the fail-closed behaviour for the OIDC-disabled posture is added by SSH-34 and these procedures must respect it.

**Epic:** SSH API Surface (tRPC + REST/OpenAPI + Automation)
**Logical deps:** SSH-10, SSH-IMPORT, SSH-12, SSH-13, SSH-14, SSH-16
**Touchpoints:** backend/src/trpc/procedures/ssh-ca.ts, backend/src/trpc/procedures/ssh-host.ts, backend/src/trpc/procedures/ssh-user.ts, backend/src/trpc/procedures/ssh-principal.ts, backend/src/trpc/router.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The frontend can call trpc.ssh.ca.*, ssh.host.*, ssh.user.*, ssh.principal.* with full TypeScript inference
- [x] #2 CA create/import/rotate/revoke use adminProcedure; issuance and reads use protectedProcedure; service errors map to correct tRPC codes (NOT_FOUND, BAD_REQUEST, FORBIDDEN, INTERNAL_SERVER_ERROR)
- [x] #3 appRouter exposes a single ssh namespace and the existing routers are unchanged
- [x] #4 The procedures honour the SSH-34 fail-closed guard so they are not silently open when OIDC is disabled
<!-- AC:END -->
