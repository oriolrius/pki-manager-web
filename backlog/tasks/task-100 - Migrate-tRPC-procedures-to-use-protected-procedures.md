---
id: TASK-100
title: Migrate tRPC procedures to use protected procedures
status: To Do
assignee: []
created_date: '2026-02-05 14:30'
labels:
  - oidc
  - backend
  - trpc
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update existing tRPC procedures to use protectedProcedure or adminProcedure instead of publicProcedure where appropriate. Keep health and public endpoints as publicProcedure. Reference: decision-009.
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
