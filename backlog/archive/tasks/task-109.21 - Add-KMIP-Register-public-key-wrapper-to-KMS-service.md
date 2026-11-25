---
id: TASK-109.21
title: Add KMIP Register public-key wrapper to KMS service
status: Done
assignee: []
created_date: '2026-05-05 16:55'
updated_date: '2026-05-05 17:48'
labels:
  - backend
  - kms
dependencies: []
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend backend/src/kms/service.ts with importPublicKey(pem) using KMIP Register operation. Required by external /sign flow because cert-manager submits CSRs - public key originates outside KMS and must be registered before kmsService.signCertificate can reference it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 kmsService.importPublicKey(pemOrDer, tags?, entityId?) returns publicKeyId
- [ ] #2 Supports RSA and ECDSA public keys
- [ ] #3 Tags applied for cleanup (e.g. cert id) so destroyKey reaches imported key
- [ ] #4 Unit-test against KMS test instance or mock client
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Not needed: backend/src/kms/client.ts certify() already accepts CSR via KMIP CertificateRequest tag. Cosmian KMS handles CSR-based signing natively. /sign in external.routes.ts can call kms.signCertificate({csr, issuerPrivateKeyId, issuerCertificateId, ...}) directly.

Reopened understanding: KMIP Register wrapper still desirable for production (so KMS retains private key + audit). For e2e and simple deployments, env-based file source is the working path (see task-109.05).
<!-- SECTION:NOTES:END -->
