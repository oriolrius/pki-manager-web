---
id: TASK-099
title: Inject Bearer token in tRPC client
status: In Progress
assignee:
  - '@myself'
created_date: '2026-02-05 14:30'
updated_date: '2026-02-05 15:31'
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
- [ ] #1 tRPC httpBatchLink includes Authorization header
- [ ] #2 Bearer token is retrieved from auth context
- [ ] #3 Requests without token still work for public endpoints
- [ ] #4 Token is refreshed automatically via silent renewal
<!-- AC:END -->
