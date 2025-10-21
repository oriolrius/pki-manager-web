---
id: task-011
title: Implement CA deletion backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 17:21'
labels:
  - backend
  - ca
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for permanently deleting a root CA. Validate prerequisites (no active certificates), delete from database, optionally destroy KMS key, preserve audit logs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ca.delete tRPC endpoint implemented
- [ ] #2 Validation: CA must be revoked or expired
- [ ] #3 Validation: No active certificates exist
- [ ] #4 CA record deleted from database
- [ ] #5 Optional KMS key destruction
- [ ] #6 Audit logs preserved (not deleted)
- [ ] #7 Audit entry created before deletion
- [ ] #8 Orphaned CRLs cleaned up
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Analyze requirements for CA deletion
2. Implement ca.delete tRPC endpoint with input validation
3. Validate CA must be revoked or expired
4. Validate no active certificates exist
5. Create audit entry before deletion
6. Delete CA record from database
7. Optional KMS key destruction
8. Ensure audit logs are preserved
9. Clean up orphaned CRLs
<!-- SECTION:PLAN:END -->
