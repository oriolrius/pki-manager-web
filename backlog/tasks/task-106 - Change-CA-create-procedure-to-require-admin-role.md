---
id: TASK-106
title: Change CA create procedure to require admin role
status: Done
assignee:
  - '@myself'
created_date: '2026-02-13 07:49'
updated_date: '2026-07-08 11:52'
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
- [x] #1 ca.create uses adminProcedure instead of protectedProcedure
- [x] #2 Admin user can create CA successfully
- [x] #3 Regular user gets 403 Forbidden when trying to create CA
- [x] #4 Existing unit tests pass or are updated accordingly
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Already implemented: ca.create uses adminProcedure (backend/src/trpc/procedures/ca.ts:109) with an explicit FORBIDDEN role-check safety net (skipped when OIDC disabled). Admin-create is covered by ca-create.test.ts; the regular-user 403 path is covered by auth.test.ts 'should reject user without admin role with FORBIDDEN'. Backend typecheck clean; auth middleware tests pass (11 passed, Keycloak/KMS-gated integration cases skip when services absent).
<!-- SECTION:NOTES:END -->
