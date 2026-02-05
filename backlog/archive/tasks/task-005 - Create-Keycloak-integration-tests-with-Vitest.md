---
id: TASK-005
title: Create Keycloak integration tests with Vitest
status: To Do
assignee: []
created_date: '2026-02-05 11:53'
updated_date: '2026-02-05 11:54'
labels:
  - keycloak
  - testing
  - vitest
dependencies:
  - TASK-001
  - TASK-002
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create integration tests that verify the Keycloak development environment works correctly. Tests should validate OAuth2 flows and token validation work as expected.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Test file created at backend/src/auth/keycloak.integration.test.ts
- [ ] #2 Test verifies Client Credentials flow returns valid JWT access token
- [ ] #3 Test verifies access token contains expected claims (iss, aud, exp, sub)
- [ ] #4 Test verifies token can be validated against JWKS endpoint
- [ ] #5 Test verifies invalid client credentials are rejected with 401
- [ ] #6 Test verifies expired tokens are properly rejected
- [ ] #7 Tests skip gracefully if Keycloak is not running (describe.skipIf pattern)
- [ ] #8 Tests use environment variables for Keycloak URL and credentials
<!-- AC:END -->
