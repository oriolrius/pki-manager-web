---
id: TASK-108
title: Create RBAC e2e tests for regular user role
status: To Do
assignee: []
created_date: '2026-02-13 07:50'
labels:
  - testing
  - e2e
  - auth
  - rbac
dependencies:
  - TASK-106
references:
  - tests/e2e-production.spec.ts
  - backend/src/trpc/init.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create comprehensive Playwright e2e tests that verify regular users (without admin role) have limited access:
- Can view CAs and certificates
- Can issue and download certificates
- CANNOT create CAs (after admin role requirement is added)
- CANNOT revoke or delete CAs/certificates

Tests should run against production (pki.nexiona.io) using testuser account.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Test file tests/e2e-rbac.spec.ts includes user role tests
- [ ] #2 Tests login as testuser (non-admin)
- [ ] #3 Tests verify user can view CA list and details
- [ ] #4 Tests verify user can view certificate list and details
- [ ] #5 Tests verify user CANNOT create CA (expects 403)
- [ ] #6 Tests verify user CANNOT revoke certificate (expects 403)
- [ ] #7 Tests verify user CANNOT delete certificate (expects 403)
- [ ] #8 Tests verify user CANNOT revoke CA (expects 403)
- [ ] #9 Tests verify user CANNOT delete CA (expects 403)
- [ ] #10 All user restriction tests pass against production deployment
<!-- AC:END -->
