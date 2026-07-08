---
id: TASK-105
title: Add debug logging for auth token retrieval
status: Done
assignee:
  - '@myself'
created_date: '2026-02-13 07:49'
updated_date: '2026-07-08 11:52'
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
- [x] #1 Console shows debug log with storage key when looking for token
- [x] #2 Console shows debug log when no token found in localStorage
- [x] #3 Console shows warning with error details when token retrieval fails
- [x] #4 Existing functionality remains unchanged (silent fallback to no auth)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Already implemented in frontend/src/lib/auth/token.ts: getManualAccessToken() logs the storage key (console.debug, line 56), logs when no token is in localStorage (line 59), and warns with error details on failure (console.warn, line 81); silent fallback to null is preserved. trpc.ts additionally logs header set/absent (lines 19/21). Frontend typecheck clean.
<!-- SECTION:NOTES:END -->
