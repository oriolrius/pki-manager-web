---
id: TASK-HIGH.01
title: Fix GitHub CI workflows failing due to outdated lockfile
status: In Progress
assignee:
  - '@myself'
created_date: '2026-02-06 09:53'
updated_date: '2026-02-06 09:53'
labels:
  - ci
  - bug
dependencies: []
parent_task_id: TASK-HIGH
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GitHub CI workflows (Test and Docker Build) are failing because pnpm-lock.yaml is out of date with frontend/package.json. The lockfile is missing oidc-client-ts and react-oidc-context dependencies that were added to the frontend.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 pnpm-lock.yaml is updated with all frontend dependencies
- [ ] #2 Test workflow passes in CI
- [ ] #3 Docker Build workflow passes in CI
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Run pnpm install in root to regenerate lockfile with all dependencies
2. Verify the lockfile includes oidc-client-ts and react-oidc-context
3. Commit the updated lockfile
4. Push to trigger CI workflows
5. Verify workflows pass
<!-- SECTION:PLAN:END -->
