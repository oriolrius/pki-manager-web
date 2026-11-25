---
id: TASK-089
title: Create backend OIDC configuration module
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 14:29'
updated_date: '2026-02-05 14:53'
labels:
  - oidc
  - backend
dependencies:
  - TASK-088
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a configuration module that reads OIDC settings from environment variables and initializes the JWKS client. Must be provider-agnostic using standard OIDC discovery.

Reference: [decision-009](../decisions/decision-009%20-%20OIDC-Authentication-Implementation.md)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 OIDC config reads from OIDC_ISSUER, OIDC_AUDIENCE, OIDC_ROLES_CLAIM env vars
- [x] #2 JWKS client is created using jose createRemoteJWKSet
- [x] #3 Configuration validates required environment variables on startup
- [x] #4 Works with Keycloak discovery endpoint
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Created backend/src/lib/oidc.ts with provider-agnostic OIDC configuration
- Reads OIDC_ISSUER, OIDC_AUDIENCE, OIDC_ROLES_CLAIM from env vars
- Uses jose createRemoteJWKSet for JWKS client with automatic caching
- Validates env vars on startup, throws if incomplete
- Uses OIDC discovery to get JWKS URI dynamically
- Includes extractRoles() helper for configurable claim path
- Created comprehensive test suite (13 tests, all passing)
- Verified with Keycloak at localhost:42997
<!-- SECTION:NOTES:END -->
