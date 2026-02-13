---
id: TASK-106
title: Change CA create procedure to require admin role
status: To Do
assignee: []
created_date: '2026-02-13 07:49'
labels:
  - backend
  - auth
  - security
dependencies: []
references:
  - 'backend/src/trpc/procedures/ca.ts:108'
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently `ca.create` uses `protectedProcedure` which allows any authenticated user to create CAs. This should be changed to `adminProcedure` to restrict CA creation to administrators only.

This is a one-line change in the backend procedure definition.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ca.create uses adminProcedure instead of protectedProcedure
- [ ] #2 Admin user can create CA successfully
- [ ] #3 Regular user gets 403 Forbidden when trying to create CA
- [ ] #4 Existing unit tests pass or are updated accordingly
<!-- AC:END -->
