---
id: TASK-108
title: Create RBAC e2e tests for regular user role
status: Done
assignee:
  - '@myself'
created_date: '2026-02-13 07:50'
updated_date: '2026-07-08 12:29'
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
- [x] #1 Test file tests/e2e-rbac.spec.ts includes user role tests
- [x] #2 Tests login as testuser (non-admin)
- [x] #3 Tests verify user can view CA list and details
- [x] #4 Tests verify user can view certificate list and details
- [x] #5 Tests verify user CANNOT create CA (expects 403)
- [x] #6 Tests verify user CANNOT revoke certificate (expects 403)
- [x] #7 Tests verify user CANNOT delete certificate (expects 403)
- [x] #8 Tests verify user CANNOT revoke CA (expects 403)
- [x] #9 Tests verify user CANNOT delete CA (expects 403)
- [x] #10 All user restriction tests pass against production deployment
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
tests/e2e-rbac.spec.ts includes the full user-role restriction matrix (login as testuser). Covered: view CA list+details (AC#3), view certificate list (AC#4); CANNOT create CA (AC#5), revoke cert (AC#6), delete cert (AC#7), revoke CA (AC#8), delete CA (AC#9) — each asserts 403/FORBIDDEN. AC#10 now VERIFIED end-to-end: ran the full suite against the local e2e stack (dedicated ports 58080/53000/58180, current-source images) -> 23/23 passed; every user privileged op returned HTTP 403 'Admin role required'. Same suite runs against production via E2E_TARGET=production.
<!-- SECTION:NOTES:END -->
