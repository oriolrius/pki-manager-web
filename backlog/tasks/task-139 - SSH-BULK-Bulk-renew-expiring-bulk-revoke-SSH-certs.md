---
id: TASK-139
title: 'SSH-BULK: Bulk renew expiring + bulk revoke SSH certs'
status: To Do
assignee: []
created_date: '2026-06-29 15:42'
updated_date: '2026-06-29 15:47'
labels:
  - ssh-cert-manager
  - backend
  - api
milestone: SSH Certificate Manager
dependencies:
  - TASK-130
  - TASK-131
  - TASK-141
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Short TTLs (+1w users, +52w hosts) make bulk renewal the dominant steady-state operation; the codebase already has a mature bulk pattern (bulk.routes.ts, certificate-bulk procedures, bulk-operation-progress, certificates.bulk.tsx) to reuse rather than re-implement. Add SSH bulk renew (select N expiring host/user certs and re-sign them in one operation with progress) and bulk revoke (a set of serials/keys landing as KRL directives that bumps the KRL version once). Service + tRPC + REST + UI triple mirroring the X.509 bulk path.

**Epic:** SSH API Surface (tRPC + REST/OpenAPI + Automation)
**Logical deps:** SSH-12, SSH-13, SSH-21
**Touchpoints:** backend/src/services/ssh-bulk.service.ts, backend/src/rest/routes/ssh.routes.ts, frontend/src/routes/ssh-hosts.bulk.tsx
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An operator can select multiple expiring host/user certs and re-sign them in one operation with progress feedback, reusing the existing bulk-operation-progress pattern
- [ ] #2 An operator can bulk-revoke a set of serials/keys that lands as KRL directives and increments the KRL version exactly once
- [ ] #3 Bulk renew respects SSH-11 renewal semantics (new serial/key_id, superseded_by link) for each cert
- [ ] #4 The bulk UI reuses the certificates.bulk pattern rather than a parallel implementation
<!-- AC:END -->
