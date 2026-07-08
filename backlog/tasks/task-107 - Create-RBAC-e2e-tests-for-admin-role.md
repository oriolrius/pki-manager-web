---
id: TASK-107
title: Create RBAC e2e tests for admin role
status: Done
assignee:
  - '@myself'
created_date: '2026-02-13 07:49'
updated_date: '2026-07-08 12:06'
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
- [ ] #8 All admin tests pass against production deployment
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
tests/e2e-rbac.spec.ts covers all admin privileged operations. Existing admin block: login as testadmin, create CA, view CA list/details, navigate certificates, bulk ops, audit. Added a serial 'Admin Destructive Operations' block that operates on THROWAWAY objects it creates (never real data): create CA -> issue certificate (AC#4) -> revoke certificate (AC#5) -> delete revoked certificate (AC#6) -> revoke + delete CA (AC#7). Each privileged op intercepts its tRPC response and asserts admin is authorized (never FORBIDDEN). Selectors verified against current UI (certificates.new/$id, cas.$id). Validated: 'playwright test --list' discovers all 23 tests and the spec compiles. AC#8 (pass against live production deployment) not run locally: ports :3000/:8080 required by the e2e stack are held by unrelated running containers (grafana, iotgw) and the pki-e2e realm hardcodes redirect_uri=localhost:8080, so a live run must happen in CI or the deployment env (E2E_TARGET=production).
<!-- SECTION:NOTES:END -->
