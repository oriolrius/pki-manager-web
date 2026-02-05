---
id: TASK-098
title: Create protected route layout with auth guards
status: In Progress
assignee:
  - '@myself'
created_date: '2026-02-05 14:30'
updated_date: '2026-02-05 15:29'
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
- [ ] #1 _authenticated.tsx layout route created
- [ ] #2 beforeLoad checks auth.isAuthenticated
- [ ] #3 Unauthenticated users are redirected to login
- [ ] #4 Return URL is stored for post-login redirect
- [ ] #5 Protected routes moved under _authenticated/ folder
<!-- AC:END -->
