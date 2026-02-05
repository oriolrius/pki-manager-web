---
id: TASK-007
title: Create JWT validation utility for Keycloak tokens
status: To Do
assignee: []
created_date: '2026-02-05 12:00'
labels:
  - keycloak
  - backend
  - authentication
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a utility module in the backend to validate JWT tokens issued by Keycloak. This will be the foundation for protecting API endpoints.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Module created at backend/src/auth/jwt.ts
- [ ] #2 Fetches JWKS from Keycloak and caches signing keys
- [ ] #3 Validates JWT signature using cached JWKS
- [ ] #4 Validates token claims: issuer (iss), audience (aud), expiration (exp)
- [ ] #5 Extracts user info and roles from token claims
- [ ] #6 Exports verifyToken function that returns decoded payload or throws
- [ ] #7 Handles key rotation by refreshing JWKS when kid not found
- [ ] #8 Uses jose or jsonwebtoken library for JWT operations
<!-- AC:END -->
