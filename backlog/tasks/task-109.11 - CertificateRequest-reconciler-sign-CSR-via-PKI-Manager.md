---
id: TASK-109.11
title: 'CertificateRequest reconciler: sign CSR via PKI Manager'
status: Done
assignee: []
created_date: '2026-05-05 16:20'
updated_date: '2026-05-05 17:48'
labels:
  - controller
dependencies:
  - TASK-109.10
  - TASK-109.12
documentation:
  - >-
    https://github.com/cert-manager/sample-external-issuer/blob/main/internal/controllers/certificaterequest_controller.go
  - 'https://cert-manager.io/docs/usage/certificaterequest/'
  - 'https://cert-manager.io/docs/concepts/certificaterequest/#approval'
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Watch cert-manager CertificateRequest matching our group. Require Approved condition (cert-manager 1.16+). Submit CSR to /external/sign with request UID, populate status.certificate and status.ca.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Only Approved CertificateRequests signed
- [ ] #2 Issued cert in status.certificate, chain in status.ca
- [ ] #3 Idempotent via request_uid
- [ ] #4 Failed=True on permanent errors with message
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CertificateRequestReconciler implemented. Filters by issuerRef.group=pki-manager.issuer.io. Honors Denied (final), requires Approved (cert-manager 1.16+) before signing. Idempotent via CR.UID as request_uid. Populates status.certificate + status.ca. Ready condition with Reason=Issued/Failed/Pending. Events recorded.

Bug found in e2e: Status().Update raced with cert-manager controllers causing 131 cascading CR creations. Fixed: status update retries up to 5x with 100ms backoff on apierrors.IsConflict. Verified single CR succeeds on first retry path.
<!-- SECTION:NOTES:END -->
