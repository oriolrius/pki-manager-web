---
id: TASK-107
title: Create RBAC e2e tests for admin role
status: To Do
assignee: []
created_date: '2026-02-13 07:49'
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
- [ ] #1 Test file tests/e2e-rbac.spec.ts exists with admin role tests
- [ ] #2 Tests login as testadmin user
- [ ] #3 Tests verify admin can create CA
- [ ] #4 Tests verify admin can issue certificate
- [ ] #5 Tests verify admin can revoke certificate
- [ ] #6 Tests verify admin can delete revoked certificate
- [ ] #7 Tests verify admin can revoke and delete CA
- [ ] #8 All admin tests pass against production deployment
<!-- AC:END -->
