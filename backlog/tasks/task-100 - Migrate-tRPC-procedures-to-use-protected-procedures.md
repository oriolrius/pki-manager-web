---
id: TASK-100
title: Migrate tRPC procedures to use protected procedures
status: In Progress
assignee:
  - '@myself'
created_date: '2026-02-05 14:30'
updated_date: '2026-02-05 15:33'
labels:
  - oidc
  - backend
  - trpc
dependencies:
  - TASK-091
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update existing tRPC procedures to use protectedProcedure or adminProcedure instead of publicProcedure where appropriate. Keep health and public endpoints as publicProcedure.

Reference: [decision-009](../decisions/decision-009%20-%20OIDC-Authentication-Implementation.md)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CA management procedures use protectedProcedure
- [ ] #2 Certificate procedures use protectedProcedure
- [ ] #3 Audit log procedures use protectedProcedure
- [ ] #4 Health endpoint remains publicProcedure
- [ ] #5 Destructive operations (revoke, delete) use adminProcedure
- [ ] #6 User info is available in procedure context
<!-- AC:END -->
