---
id: task-017
title: Implement certificate deletion backend endpoint
status: To Do
assignee: []
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 19:50'
labels:
  - backend
  - certificate
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for permanently deleting certificate records. Validate prerequisites, delete from database, optionally destroy KMS key, preserve audit logs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 certificate.delete endpoint implemented
- [ ] #2 Validation: certificate must be revoked or expired > 90 days
- [ ] #3 Certificate record deleted from database
- [ ] #4 Optional KMS key destruction
- [ ] #5 Audit logs preserved
- [ ] #6 Audit entry created before deletion
- [ ] #7 Optional removal from CRL
- [ ] #8 Validation prevents deleting active certificates

- [ ] #9 Tests written to validate deletion functionality
- [ ] #10 All tests pass
<!-- AC:END -->
