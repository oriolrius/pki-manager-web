---
id: task-057
title: Add comprehensive tests for CA revoke and delete tRPC endpoints
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-23 15:15'
updated_date: '2025-10-23 15:15'
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
- [ ] #1 Test CA revoke cascades to all active child certificates
- [ ] #2 Test CA revoke generates CRL record with correct number and dates
- [ ] #3 Test CA revoke preserves all revocation reasons (unspecified, keyCompromise, caCompromise, etc.)
- [ ] #4 Test CA revoke creates proper audit log entry
- [ ] #5 Test CA revoke with CA that has no certificates
- [ ] #6 Test CA revoke with CA that has mixed certificate statuses
- [ ] #7 Test CA delete validates revoked status requirement
- [ ] #8 Test CA delete validates expired status allows deletion
- [ ] #9 Test CA delete prevents deletion with active certificates
- [ ] #10 Test CA delete destroys KMS key when destroyKey=true
- [ ] #11 Test CA delete handles already-revoked KMS keys gracefully
- [ ] #12 Test CA delete cleans up orphaned CRL records
- [ ] #13 Test CA delete creates audit log before deletion
- [ ] #14 Test CA delete with destroyKey=false preserves KMS key
- [ ] #15 All tests pass in CI pipeline
<!-- AC:END -->
