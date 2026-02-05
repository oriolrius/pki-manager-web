---
id: TASK-101
title: Add OIDC integration tests with Keycloak
status: In Progress
assignee:
  - '@myself'
created_date: '2026-02-05 14:30'
updated_date: '2026-02-05 15:45'
labels:
  - oidc
  - backend
  - testing
dependencies:
  - TASK-091
  - TASK-099
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create integration tests that verify the full authentication flow using the Keycloak development environment. Tests should cover login, token validation, protected endpoints, and logout.

Reference: [decision-009](../decisions/decision-009%20-%20OIDC-Authentication-Implementation.md)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Test verifies JWT validation against Keycloak JWKS
- [x] #2 Test verifies protected procedure rejects requests without token
- [x] #3 Test verifies protected procedure accepts valid token
- [x] #4 Test verifies admin procedure requires admin role
- [x] #5 Test verifies role extraction from realm_access.roles
- [x] #6 Tests run against local Keycloak instance
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reviewed existing auth.test.ts middleware tests
2. Added Admin Role Middleware Integration Tests describe block
3. Added simulateAdminProcedure helper that chains auth + admin role check
4. Added test: reject user without admin role with FORBIDDEN
5. Added test: allow admin user to access admin procedure
6. Verified all 11 tests pass against local Keycloak
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Changes

Enhanced `backend/src/trpc/middleware/auth.test.ts` with new test suite:

### Admin Role Middleware Integration Tests
- Added `simulateAdminProcedure` helper to test auth + admin role middleware chain
- Test: non-admin user receives FORBIDDEN error when accessing admin procedure
- Test: admin user can successfully access admin procedure

### Test Coverage
- JWT validation against Keycloak JWKS
- Protected procedure rejects missing/invalid tokens
- Protected procedure accepts valid tokens
- Admin procedure requires admin role (FORBIDDEN for non-admins)
- Role extraction from realm_access.roles
- All tests run against local Keycloak instance (skip if unavailable)
<!-- SECTION:NOTES:END -->
