---
id: task-010
title: Implement CA revocation backend endpoint
status: To Do
assignee: []
created_date: '2025-10-21 15:49'
labels:
  - backend
  - ca
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for revoking a root CA. Update CA status, generate CRL, log operation, and optionally cascade revocation to issued certificates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ca.revoke tRPC endpoint implemented
- [ ] #2 Input validation for revocation reason
- [ ] #3 CA status updated to 'revoked'
- [ ] #4 Revocation date and reason stored
- [ ] #5 CRL generated including revoked CA
- [ ] #6 Audit log entry created
- [ ] #7 Optional cascade revocation to certificates
- [ ] #8 Validation prevents re-revoking revoked CA
<!-- AC:END -->
