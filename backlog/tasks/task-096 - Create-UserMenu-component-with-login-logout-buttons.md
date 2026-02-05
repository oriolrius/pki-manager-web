---
id: TASK-096
title: Create UserMenu component with login/logout buttons
status: To Do
assignee: []
created_date: '2026-02-05 14:30'
updated_date: '2026-02-05 14:37'
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
- [ ] #1 UserMenu shows Login button when not authenticated
- [ ] #2 Login button triggers signinRedirect to OIDC provider
- [ ] #3 UserMenu shows user name/email when authenticated
- [ ] #4 Logout button triggers signoutRedirect to OIDC provider
- [ ] #5 Account link opens provider account management page
- [ ] #6 Component added to navigation in __root.tsx
<!-- AC:END -->
