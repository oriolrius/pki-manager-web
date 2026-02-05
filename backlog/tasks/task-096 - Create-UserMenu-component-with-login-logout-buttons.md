---
id: TASK-096
title: Create UserMenu component with login/logout buttons
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 14:30'
updated_date: '2026-02-05 15:28'
labels:
  - oidc
  - frontend
  - ui
dependencies:
  - TASK-094
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create UserMenu component that shows login button when unauthenticated, and user info with logout/account links when authenticated. Uses provider redirects, no custom UI.

Reference: [decision-009](../decisions/decision-009%20-%20OIDC-Authentication-Implementation.md)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 UserMenu shows Login button when not authenticated
- [x] #2 Login button triggers signinRedirect to OIDC provider
- [x] #3 UserMenu shows user name/email when authenticated
- [x] #4 Logout button triggers signoutRedirect to OIDC provider
- [x] #5 Account link opens provider account management page
- [x] #6 Component added to navigation in __root.tsx
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created UserMenu component:

- Shows Login button when not authenticated (triggers signinRedirect)
- Shows user dropdown with name/email when authenticated
- Logout button triggers signoutRedirect
- Account Settings link opens provider account page
- Component added to navigation next to ThemeToggle
<!-- SECTION:NOTES:END -->
