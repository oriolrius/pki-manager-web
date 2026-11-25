---
id: TASK-091
title: Add protected and admin procedure types to tRPC
status: Done
assignee:
  - '@myself'
created_date: '2026-02-05 14:29'
updated_date: '2026-02-05 15:10'
labels:
  - oidc
  - backend
  - trpc
dependencies:
  - TASK-090
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create protectedProcedure and adminProcedure that use the auth middleware. Update tRPC context type to include optional user.

Reference: [decision-009](../decisions/decision-009%20-%20OIDC-Authentication-Implementation.md)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 protectedProcedure requires valid JWT token
- [x] #2 adminProcedure requires admin role in addition to valid token
- [x] #3 Context type includes optional user with sub, email, name, roles
- [x] #4 Procedures are exported from trpc/init.ts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Update context.ts to include optional user type
2. Update init.ts to add protectedProcedure using auth middleware
3. Add adminProcedure that requires admin role
4. Export both procedures from init.ts
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added protected and admin procedure types to tRPC:

- Created `ContextUser` interface in context.ts with sub, email?, name?, roles
- Added `protectedProcedure` that validates JWT token via authMiddleware
- Added `adminProcedure` that extends protectedProcedure with admin role check
- Both procedures exported from trpc/init.ts with JSDoc examples
<!-- SECTION:NOTES:END -->
