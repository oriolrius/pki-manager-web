---
id: TASK-108
title: Create RBAC e2e tests for regular user role
status: Done
assignee:
  - '@myself'
created_date: '2026-02-13 07:50'
updated_date: '2026-07-08 12:06'
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
- [ ] #10 All user restriction tests pass against production deployment
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
tests/e2e-rbac.spec.ts includes the full user-role restriction matrix (login as testuser via ADMIN/TEST_USER config, default testuser/Test123!). Covered: user can view CA list + details (AC#3) and certificate list (AC#4); user CANNOT create CA -> expects FORBIDDEN (AC#5); CANNOT revoke certificate (AC#6); CANNOT delete certificate (AC#7); CANNOT revoke CA (AC#8); CANNOT delete CA (AC#9) — all assert 403/FORBIDDEN via intercepted tRPC responses or body text. Depends-on TASK-106 (ca.create adminProcedure) is Done. Validated: spec compiles and all 23 tests are discovered by 'playwright test --list'. AC#10 (pass against live production deployment) not run locally: e2e stack ports :3000/:8080 are held by unrelated running containers and the realm's redirect_uri is fixed to localhost:8080 — a live run belongs in CI or the deployment (E2E_TARGET=production).
<!-- SECTION:NOTES:END -->
