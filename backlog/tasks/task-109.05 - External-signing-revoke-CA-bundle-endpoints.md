---
id: TASK-109.05
title: External signing/revoke/CA-bundle endpoints
status: To Do
assignee: []
created_date: '2026-05-05 16:20'
updated_date: '2026-05-05 16:21'
labels:
  - backend
  - api
dependencies:
  - TASK-109.04
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fastify REST routes consumed by controller. CSR validated, signed via Cosmian KMS, persisted with k8s metadata. Idempotent on request_uid.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 POST /api/v1/external/sign signs PEM CSR, returns cert + chain
- [ ] #2 POST /api/v1/external/revoke revokes by serial with reason code
- [ ] #3 GET /api/v1/external/ca-bundle returns CA chain PEM
- [ ] #4 Repeat sign with same request_uid returns cached cert
- [ ] #5 Issued certs visible in main /certificates UI
<!-- AC:END -->
