---
id: TASK-092
title: Update backend environment with OIDC configuration
status: In Progress
assignee:
  - '@myself'
created_date: '2026-02-05 14:29'
updated_date: '2026-02-05 15:22'
labels:
  - oidc
  - backend
  - config
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add OIDC environment variables to .env.example and document them. Configure for Keycloak development environment.

Reference: [decision-009](../decisions/decision-009%20-%20OIDC-Authentication-Implementation.md)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 OIDC_ISSUER variable added to .env.example
- [ ] #2 OIDC_AUDIENCE variable added to .env.example
- [ ] #3 OIDC_ROLES_CLAIM variable added to .env.example with Keycloak default
- [ ] #4 Environment variables are documented with examples for different providers
<!-- AC:END -->
