---
id: TASK-109.05
title: External signing/revoke/CA-bundle endpoints
status: In Progress
assignee: []
created_date: '2026-05-05 16:20'
updated_date: '2026-05-05 16:55'
labels:
  - backend
  - api
dependencies:
  - TASK-109.21
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
REST scaffold complete: /health, /ca-bundle, /revoke fully working with cluster auth + audit + idempotency. /sign returns 501 NOT_IMPLEMENTED until Cosmian KMS public-key import (KMIP Register) added. Path forward documented inline in external.routes.ts TODO and audit-logged on calls.

Reclassified: 501 stub is intentional placeholder. Real CSR signing depends on new task-109.21 (KMS importPublicKey wrapper). Once that lands, complete /sign flow: parse CSR -> verify sig -> kms.importPublicKey -> kms.signCertificate -> persist with k8s metadata -> return PEM + chain.
<!-- SECTION:NOTES:END -->
