---
id: TASK-092
title: Update backend environment with OIDC configuration
status: To Do
assignee: []
created_date: '2026-02-05 14:29'
labels:
  - oidc
  - backend
  - config
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add OIDC environment variables to .env.example and document them. Configure for Keycloak development environment. Reference: decision-009.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 OIDC_ISSUER variable added to .env.example
- [ ] #2 OIDC_AUDIENCE variable added to .env.example
- [ ] #3 OIDC_ROLES_CLAIM variable added to .env.example with Keycloak default
- [ ] #4 Environment variables are documented with examples for different providers
<!-- AC:END -->
