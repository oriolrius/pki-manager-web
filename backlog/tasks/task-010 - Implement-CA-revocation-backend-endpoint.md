---
id: task-010
title: Implement CA revocation backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:49'
updated_date: '2025-10-21 17:19'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Analyze requirements for CA revocation
2. Implement ca.revoke tRPC endpoint with input validation
3. Validate CA exists and is not already revoked
4. Update CA status to revoked in database
5. Store revocation date and reason
6. Generate CRL including revoked CA
7. Create audit log entry
8. Implement optional cascade revocation to certificates
9. Add validation to prevent re-revoking
<!-- SECTION:PLAN:END -->
