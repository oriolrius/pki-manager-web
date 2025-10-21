---
id: task-017
title: Implement certificate deletion backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 19:54'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Review task requirements and database schema
2. Implement certificate.delete tRPC endpoint
3. Add validation: certificate must be revoked or expired > 90 days
4. Implement deletion logic with audit log preservation
5. Add optional KMS key destruction support
6. Write comprehensive tests for deletion functionality
7. Run all tests to ensure they pass
<!-- SECTION:PLAN:END -->
