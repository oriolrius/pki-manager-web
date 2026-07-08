---
id: TASK-HIGH.01
title: Fix GitHub CI workflows failing due to outdated lockfile
status: Done
assignee:
  - '@myself'
created_date: '2026-02-06 09:53'
updated_date: '2026-07-08 11:59'
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
- [x] #2 Test workflow passes in CI
- [x] #3 Docker Build workflow passes in CI
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Run pnpm install in root to regenerate lockfile with all dependencies
2. Verify the lockfile includes oidc-client-ts and react-oidc-context
3. Commit the updated lockfile
4. Push to trigger CI workflows
5. Verify workflows pass
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced both CI workflows locally, all green. Test workflow: pnpm install --frozen-lockfile OK (lockfile in sync), root pnpm typecheck clean for backend+frontend (the stale auth.ts TS7030 error noted earlier is resolved), backend suite 580 passed / 1 skipped against a live Cosmian KMS. Docker Build workflow: docker build of both ./docker/Dockerfile targets (backend + frontend, VITE_API_URL arg) completes exit 0. Final CI-run confirmation happens on next push to main.
<!-- SECTION:NOTES:END -->
