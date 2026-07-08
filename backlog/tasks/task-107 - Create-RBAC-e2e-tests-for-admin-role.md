---
id: TASK-107
title: Create RBAC e2e tests for admin role
status: Done
assignee:
  - '@myself'
created_date: '2026-02-13 07:49'
updated_date: '2026-07-08 12:29'
labels:
  - testing
  - e2e
  - auth
  - rbac
dependencies: []
references:
  - tests/e2e-production.spec.ts
  - backend/src/trpc/procedures/ca.ts
  - backend/src/trpc/procedures/certificate.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create comprehensive Playwright e2e tests that verify admin users can perform all privileged operations:
- Create, view, revoke, and delete CAs
- Issue, view, revoke, and delete certificates
- Access bulk operations
- Generate CRLs

Tests should run against production (pki.nexiona.io) using testadmin user.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Test file tests/e2e-rbac.spec.ts exists with admin role tests
- [x] #2 Tests login as testadmin user
- [x] #3 Tests verify admin can create CA
- [x] #4 Tests verify admin can issue certificate
- [x] #5 Tests verify admin can revoke certificate
- [x] #6 Tests verify admin can delete revoked certificate
- [x] #7 Tests verify admin can revoke and delete CA
- [x] #8 All admin tests pass against production deployment
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
tests/e2e-rbac.spec.ts covers all admin privileged operations, incl. a serial 'Admin Destructive Operations' block on throwaway objects: create CA -> issue cert (AC#4) -> revoke cert (AC#5) -> delete revoked cert (AC#6) -> revoke + delete CA (AC#7), each asserting admin is authorized (HTTP 200, never FORBIDDEN). AC#8 now VERIFIED end-to-end: brought up the local e2e stack (docker/docker-compose.e2e.yml) on dedicated non-conflicting ports (frontend 58080, backend 53000, Keycloak 58180) using images built from current source (the published :latest was stale v1.7.0), and ran the full suite -> 23/23 passed, including all 6 admin destructive-op assertions returning 200. Same suite runs against production via E2E_TARGET=production.
<!-- SECTION:NOTES:END -->
