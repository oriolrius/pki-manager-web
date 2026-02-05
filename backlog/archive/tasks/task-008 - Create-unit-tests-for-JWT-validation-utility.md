---
id: TASK-008
title: Create unit tests for JWT validation utility
status: To Do
assignee: []
created_date: '2026-02-05 11:54'
updated_date: '2026-02-05 11:54'
labels:
  - keycloak
  - backend
  - testing
  - vitest
dependencies:
  - TASK-007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create comprehensive unit tests for the JWT validation utility using Vitest. Tests should cover both success and failure scenarios with mocked JWKS.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Test file created at backend/src/auth/jwt.test.ts
- [ ] #2 Tests valid token verification succeeds
- [ ] #3 Tests expired token throws appropriate error
- [ ] #4 Tests invalid signature throws appropriate error
- [ ] #5 Tests wrong issuer throws appropriate error
- [ ] #6 Tests missing required claims throws appropriate error
- [ ] #7 Tests JWKS caching works (second call uses cache)
- [ ] #8 Tests JWKS refresh on unknown kid
- [ ] #9 Uses vi.mock to mock fetch calls for JWKS endpoint
<!-- AC:END -->
