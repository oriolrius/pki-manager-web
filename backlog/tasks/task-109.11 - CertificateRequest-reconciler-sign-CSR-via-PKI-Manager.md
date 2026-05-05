---
id: TASK-109.11
title: 'CertificateRequest reconciler: sign CSR via PKI Manager'
status: To Do
assignee: []
created_date: '2026-05-05 16:20'
updated_date: '2026-05-05 16:23'
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
Follow sample certificaterequest_controller.go. Required handling: skip if Denied, require Approved (cert-manager 1.16+), set Ready with cert+ca, never re-sign once Ready=True. Use k8s.io/utils/clock for testability.
<!-- SECTION:NOTES:END -->
