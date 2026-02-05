---
id: TASK-095
title: Add OIDC callback route to frontend
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 14:29'
updated_date: '2026-02-05 15:27'
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
- [x] #1 Callback route created at frontend/src/routes/callback.tsx
- [x] #2 Route handles OIDC redirect with authorization code
- [x] #3 Successful auth redirects to stored returnUrl or home
- [x] #4 Auth errors are displayed to user
- [x] #5 Loading state shown during token exchange
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created /callback route:

- Handles OIDC redirect with authorization code
- Shows loading spinner during token exchange
- Redirects to stored returnUrl or home on success
- Displays error message with return button on failure
- Shows success checkmark before redirect
<!-- SECTION:NOTES:END -->
