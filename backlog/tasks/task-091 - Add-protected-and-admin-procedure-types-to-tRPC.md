---
id: TASK-091
title: Add protected and admin procedure types to tRPC
status: To Do
assignee: []
created_date: '2026-02-05 14:29'
updated_date: '2026-02-05 14:37'
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
- [ ] #1 protectedProcedure requires valid JWT token
- [ ] #2 adminProcedure requires admin role in addition to valid token
- [ ] #3 Context type includes optional user with sub, email, name, roles
- [ ] #4 Procedures are exported from trpc/init.ts
<!-- AC:END -->
