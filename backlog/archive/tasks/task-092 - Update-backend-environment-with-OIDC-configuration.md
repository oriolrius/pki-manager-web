---
id: TASK-092
title: Update backend environment with OIDC configuration
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 14:29'
updated_date: '2026-02-05 15:23'
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
- [x] #1 OIDC_ISSUER variable added to .env.example
- [x] #2 OIDC_AUDIENCE variable added to .env.example
- [x] #3 OIDC_ROLES_CLAIM variable added to .env.example with Keycloak default
- [x] #4 Environment variables are documented with examples for different providers
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added OIDC environment variables to .env.example:

- OIDC_ISSUER with examples for Keycloak, Auth0, Okta, Azure AD
- OIDC_AUDIENCE for client_id configuration
- OIDC_ROLES_CLAIM with provider-specific claim paths
- Documentation explaining each variable and provider differences
<!-- SECTION:NOTES:END -->
