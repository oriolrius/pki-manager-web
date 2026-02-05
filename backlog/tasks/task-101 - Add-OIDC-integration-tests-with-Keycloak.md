---
id: TASK-101
title: Add OIDC integration tests with Keycloak
status: To Do
assignee: []
created_date: '2026-02-05 14:30'
updated_date: '2026-02-05 14:38'
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
- [ ] #1 Test verifies JWT validation against Keycloak JWKS
- [ ] #2 Test verifies protected procedure rejects requests without token
- [ ] #3 Test verifies protected procedure accepts valid token
- [ ] #4 Test verifies admin procedure requires admin role
- [ ] #5 Test verifies role extraction from realm_access.roles
- [ ] #6 Tests run against local Keycloak instance
<!-- AC:END -->
