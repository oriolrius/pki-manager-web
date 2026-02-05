---
id: TASK-094
title: Create frontend AuthProvider with OIDC configuration
status: To Do
assignee: []
created_date: '2026-02-05 14:29'
updated_date: '2026-02-05 14:37'
labels:
  - oidc
  - frontend
  - react
dependencies:
  - TASK-093
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create AuthProvider component that wraps the app with react-oidc-context. Configuration should be loaded from environment variables or runtime config.

Reference: [decision-009](../decisions/decision-009%20-%20OIDC-Authentication-Implementation.md)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 AuthProvider component created in frontend/src/lib/auth/
- [ ] #2 OIDC configuration reads from VITE_OIDC_AUTHORITY and VITE_OIDC_CLIENT_ID
- [ ] #3 Supports runtime configuration via /config.json
- [ ] #4 AuthProvider wraps the app in __root.tsx
- [ ] #5 useAuth hook is re-exported for easy access
<!-- AC:END -->
