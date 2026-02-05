---
id: TASK-089
title: Create backend OIDC configuration module
status: To Do
assignee: []
created_date: '2026-02-05 14:29'
updated_date: '2026-02-05 14:30'
labels:
  - oidc
  - backend
dependencies:
  - TASK-088
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a configuration module that reads OIDC settings from environment variables and initializes the JWKS client. Must be provider-agnostic using standard OIDC discovery. Reference: decision-009.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 OIDC config reads from OIDC_ISSUER, OIDC_AUDIENCE, OIDC_ROLES_CLAIM env vars
- [ ] #2 JWKS client is created using jose createRemoteJWKSet
- [ ] #3 Configuration validates required environment variables on startup
- [ ] #4 Works with Keycloak discovery endpoint
<!-- AC:END -->
