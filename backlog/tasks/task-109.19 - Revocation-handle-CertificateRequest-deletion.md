---
id: TASK-109.19
title: 'Revocation: handle CertificateRequest deletion'
status: Done
assignee: []
created_date: '2026-05-05 16:21'
updated_date: '2026-05-05 17:11'
labels:
  - controller
  - security
dependencies:
  - TASK-109.11
documentation:
  - 'https://book.kubebuilder.io/reference/using-finalizers.html'
parent_task_id: TASK-109
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Finalizer on CertificateRequest: on delete call /external/revoke with serial. Configurable via Issuer spec (revokeOnDelete bool, default false).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Finalizer added when revokeOnDelete=true
- [ ] #2 Revoke API called on deletion before finalizer removed
- [ ] #3 Revoked certs marked revoked in PKI Manager UI
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Finalizer pki-manager.issuer.io/revoke-on-delete added when spec.revokeOnDelete=true. Serial number captured as annotation on CR at sign time. handleRevoke() reads serial, calls signer.Revoke, removes finalizer. Metric revoke_total{result} recorded.
<!-- SECTION:NOTES:END -->
