---
id: TASK-090
title: Create backend auth middleware for tRPC
status: To Do
assignee: []
created_date: '2026-02-05 14:29'
labels:
  - oidc
  - backend
  - trpc
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create tRPC middleware that validates JWT tokens from Authorization header using JWKS. Extracts user info and roles from token claims. Reference: decision-009.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Middleware extracts Bearer token from Authorization header
- [ ] #2 JWT signature is validated against JWKS
- [ ] #3 Token issuer and audience claims are verified
- [ ] #4 User sub, email, name, and roles are extracted to context
- [ ] #5 Returns UNAUTHORIZED error for missing or invalid tokens
- [ ] #6 Roles are extracted from configurable claim path
<!-- AC:END -->
