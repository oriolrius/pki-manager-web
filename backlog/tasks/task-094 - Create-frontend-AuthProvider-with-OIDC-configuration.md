---
id: TASK-094
title: Create frontend AuthProvider with OIDC configuration
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 14:29'
updated_date: '2026-02-05 15:26'
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
- [x] #1 AuthProvider component created in frontend/src/lib/auth/
- [x] #2 OIDC configuration reads from VITE_OIDC_AUTHORITY and VITE_OIDC_CLIENT_ID
- [x] #3 Supports runtime configuration via /config.json
- [x] #4 AuthProvider wraps the app in __root.tsx
- [x] #5 useAuth hook is re-exported for easy access
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created OIDC AuthProvider:

- config.ts: Loads OIDC settings from env vars with runtime config override
- AuthProvider.tsx: Wraps app with react-oidc-context
- index.ts: Re-exports useAuth hook and utilities
- Updated __root.tsx to wrap app with AuthProvider
- Created frontend/.env.example with OIDC configuration
<!-- SECTION:NOTES:END -->
