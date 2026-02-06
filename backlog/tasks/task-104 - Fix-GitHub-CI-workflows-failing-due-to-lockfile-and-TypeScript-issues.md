---
id: TASK-104
title: Fix GitHub CI workflows failing due to lockfile and TypeScript issues
status: In Progress
assignee:
  - '@myself'
created_date: '2026-02-06 10:05'
updated_date: '2026-02-06 10:05'
labels:
  - ci
  - bug
dependencies: []
parent_task_id: TASK-HIGH
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GitHub CI workflows (Test and Docker Build) were failing due to: 1. Outdated pnpm-lock.yaml missing oidc-client-ts and react-oidc-context dependencies 2. TypeScript errors in auth middleware (TS7030: Not all code paths return a value) 3. Auth middleware throwing errors when OIDC disabled instead of skipping
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pnpm-lock.yaml is updated with all frontend dependencies
- [ ] #2 TypeScript build passes without errors
- [ ] #3 Tests pass when OIDC is disabled
- [ ] #4 CI workflows pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Run pnpm install to update lockfile
2. Fix TypeScript errors in REST auth middleware (explicit returns)
3. Fix tRPC auth middleware to skip auth when OIDC disabled
4. Fix admin role middleware to skip check when OIDC disabled
5. Update auth tests to reflect new behavior
6. Commit and push to trigger CI
<!-- SECTION:PLAN:END -->
