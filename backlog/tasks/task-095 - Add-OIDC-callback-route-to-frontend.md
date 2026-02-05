---
id: TASK-095
title: Add OIDC callback route to frontend
status: In Progress
assignee:
  - '@myself'
created_date: '2026-02-05 14:29'
updated_date: '2026-02-05 15:26'
labels:
  - oidc
  - frontend
  - routing
dependencies:
  - TASK-094
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create /callback route to handle OIDC authorization code exchange after provider redirects back. Should redirect user to original destination after successful auth.

Reference: [decision-009](../decisions/decision-009%20-%20OIDC-Authentication-Implementation.md)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Callback route created at frontend/src/routes/callback.tsx
- [ ] #2 Route handles OIDC redirect with authorization code
- [ ] #3 Successful auth redirects to stored returnUrl or home
- [ ] #4 Auth errors are displayed to user
- [ ] #5 Loading state shown during token exchange
<!-- AC:END -->
