---
id: TASK-109.05
title: External signing/revoke/CA-bundle endpoints
status: Done
assignee: []
created_date: '2026-05-05 16:20'
updated_date: '2026-05-05 16:57'
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
Full CSR signing implemented. Cosmian KMS supports CSR-based certify natively via KMIP CertificateRequest tag (no import-public-key wrapper needed). Endpoint parses + verifies CSR with node-forge, extracts subject + SANs, calls kms.signCertificate({csr, ...}), persists with source_type=k8s + k8s metadata + request_uid. /health, /ca-bundle, /sign, /revoke all complete with audit logging.
<!-- SECTION:NOTES:END -->
