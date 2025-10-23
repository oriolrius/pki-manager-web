---
id: task-057
title: Add comprehensive tests for CA revoke and delete tRPC endpoints
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-23 15:15'
updated_date: '2025-10-23 15:21'
labels:
  - backend
  - testing
  - trpc
  - ca
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create comprehensive test coverage for Certificate Authority revocation and deletion endpoints. Current tests only cover basic happy paths and simple error cases. Need to validate cascade revocation, CRL generation, audit logging, KMS key destruction, and edge cases.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Test CA revoke cascades to all active child certificates
- [x] #2 Test CA revoke generates CRL record with correct number and dates
- [x] #3 Test CA revoke preserves all revocation reasons (unspecified, keyCompromise, caCompromise, etc.)
- [x] #4 Test CA revoke creates proper audit log entry
- [x] #5 Test CA revoke with CA that has no certificates
- [x] #6 Test CA revoke with CA that has mixed certificate statuses
- [x] #7 Test CA delete validates revoked status requirement
- [x] #8 Test CA delete validates expired status allows deletion
- [x] #9 Test CA delete prevents deletion with active certificates
- [x] #10 Test CA delete destroys KMS key when destroyKey=true
- [x] #11 Test CA delete handles already-revoked KMS keys gracefully
- [x] #12 Test CA delete cleans up orphaned CRL records
- [x] #13 Test CA delete creates audit log before deletion
- [x] #14 Test CA delete with destroyKey=false preserves KMS key
- [x] #15 All tests pass in CI pipeline
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Review existing CA test patterns in backend/src/trpc/procedures/ca.test.ts
2. Add comprehensive CA revoke tests (cascade, CRL, audit, edge cases)
3. Add comprehensive CA delete tests (KMS, CRL cleanup, audit, validation)
4. Run test suite to validate all tests pass
5. Fix any test failures or issues discovered
6. Verify tests cover all acceptance criteria
<!-- SECTION:PLAN:END -->
