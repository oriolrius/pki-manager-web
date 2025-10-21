---
id: task-016
title: Implement certificate revocation backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 19:51'
labels:
  - backend
  - certificate
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for revoking certificates. Update certificate status, record revocation reason, add to CA's revocation list, optionally generate CRL, and create audit log entry.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 certificate.revoke endpoint implemented
- [ ] #2 Input validation for revocation reason
- [ ] #3 Certificate status updated to 'revoked'
- [ ] #4 Revocation date and reason stored
- [ ] #5 Revocation reason details stored
- [ ] #6 Certificate added to CA's revocation list
- [ ] #7 Optional immediate CRL generation
- [ ] #8 Audit log entry with full context
- [ ] #9 Validation: cannot revoke already revoked certificate
- [ ] #10 Effective date validation (between issued and now)

- [ ] #11 Tests written to validate revocation functionality
- [ ] #12 All tests pass
<!-- AC:END -->
