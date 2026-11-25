---
id: TASK-090
title: Create backend auth middleware for tRPC
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 14:29'
updated_date: '2026-02-05 15:00'
labels:
  - oidc
  - backend
  - trpc
dependencies:
  - TASK-089
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create tRPC middleware that validates JWT tokens from Authorization header using JWKS. Extracts user info and roles from token claims.

Reference: [decision-009](../decisions/decision-009%20-%20OIDC-Authentication-Implementation.md)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Middleware extracts Bearer token from Authorization header
- [x] #2 JWT signature is validated against JWKS
- [x] #3 Token issuer and audience claims are verified
- [x] #4 User sub, email, name, and roles are extracted to context
- [x] #5 Returns UNAUTHORIZED error for missing or invalid tokens
- [x] #6 Roles are extracted from configurable claim path
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Created backend/src/trpc/middleware/auth.ts with authMiddlewareHandler
- Extracts Bearer token from Authorization header
- Validates JWT signature against JWKS using jose library
- Verifies issuer claim, checks audience/azp for Keycloak compatibility
- Extracts user sub (with fallback to preferred_username), email, name, roles
- Returns UNAUTHORIZED for missing/invalid tokens, FORBIDDEN for missing roles
- Roles extracted from configurable claim path (realm_access.roles for Keycloak)
- Created comprehensive test suite (9 tests, all passing)
- Verified with real Keycloak tokens
<!-- SECTION:NOTES:END -->
