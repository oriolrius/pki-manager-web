---
id: TASK-105
title: Add debug logging for auth token retrieval
status: To Do
assignee: []
created_date: '2026-02-13 07:49'
labels:
  - frontend
  - auth
  - debugging
dependencies: []
references:
  - frontend/src/lib/auth/token.ts
  - frontend/src/lib/trpc.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The frontend silently swallows errors when retrieving access tokens, making it impossible to diagnose "missing authorization header" errors in production.

Add console.debug/warn logging to token retrieval functions to help diagnose authentication issues.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Console shows debug log with storage key when looking for token
- [ ] #2 Console shows debug log when no token found in localStorage
- [ ] #3 Console shows warning with error details when token retrieval fails
- [ ] #4 Existing functionality remains unchanged (silent fallback to no auth)
<!-- AC:END -->
