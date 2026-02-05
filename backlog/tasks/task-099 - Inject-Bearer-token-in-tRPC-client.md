---
id: TASK-099
title: Inject Bearer token in tRPC client
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 14:30'
updated_date: '2026-02-05 15:32'
labels:
  - oidc
  - frontend
  - trpc
dependencies:
  - TASK-094
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Modify tRPC client configuration to include Authorization header with Bearer token from OIDC context. Token should be injected in all requests.

Reference: [decision-009](../decisions/decision-009%20-%20OIDC-Authentication-Implementation.md)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 tRPC httpBatchLink includes Authorization header
- [x] #2 Bearer token is retrieved from auth context
- [x] #3 Requests without token still work for public endpoints
- [x] #4 Token is refreshed automatically via silent renewal
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added Bearer token injection to tRPC client:

- Created token.ts module to access token outside React
- httpBatchLink includes async headers function
- Token retrieved from UserManager storage
- Requests without token work (returns empty headers)
- Token refreshed via silent renewal (UserManager)
<!-- SECTION:NOTES:END -->
