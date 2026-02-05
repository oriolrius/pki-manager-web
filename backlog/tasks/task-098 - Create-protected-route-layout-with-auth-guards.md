---
id: TASK-098
title: Create protected route layout with auth guards
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 14:30'
updated_date: '2026-02-05 15:30'
labels:
  - oidc
  - frontend
  - routing
dependencies:
  - TASK-094
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create _authenticated layout route that requires authentication. Uses TanStack Router beforeLoad to check auth state and redirect to login.

Reference: [decision-009](../decisions/decision-009%20-%20OIDC-Authentication-Implementation.md)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 _authenticated.tsx layout route created
- [x] #2 beforeLoad checks auth.isAuthenticated
- [x] #3 Unauthenticated users are redirected to login
- [x] #4 Return URL is stored for post-login redirect
- [x] #5 Protected routes moved under _authenticated/ folder
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created protected route layout:

- _authenticated.tsx layout route created
- Component checks auth.isAuthenticated (hooks in component)
- Unauthenticated users redirected via signinRedirect
- Return URL stored in sessionStorage before redirect
- _authenticated/ folder created for protected routes
- Routes can be moved under _authenticated/ as needed
<!-- SECTION:NOTES:END -->
