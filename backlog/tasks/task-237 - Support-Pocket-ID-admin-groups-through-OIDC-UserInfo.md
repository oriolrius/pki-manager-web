---
id: TASK-237
title: Support Pocket ID admin groups through OIDC UserInfo
status: Done
assignee:
  - '@codex'
created_date: '2026-10-21T21:38:00Z'
updated_date: '2026-10-21T21:44:00Z'
labels: []
dependencies: []
ordinal: 64014
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Opt-in UserInfo roles validate subject and fail closed
- [x] #2 Preserve default JWT roles and document Pocket ID configuration
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Implement opt-in role lookup after JWT validation; test success, revocation and failures; document configuration and open PR
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented opt-in OIDC_ROLES_SOURCE=userinfo in shared JWT authentication, same-subject verification, same-origin HTTPS endpoint restriction, timeout and redirect rejection. Added Docker configuration and Pocket ID deployment instructions. 18 focused tests pass; strict typecheck and production build pass. Existing lint startup fails due to AJV/eslintrc incompatibility. Push denied HTTP 403; PR API also Forbidden. No live Pocket ID instance tested.

Final backend suite completed under Node 22 with KMS running: 71 files passed, 757 tests reported passed, 1 skipped. Existing Keycloak integration cases return early without Keycloak and are not live-login evidence. GitHub createPullRequest explicitly rejected: Resource not accessible by integration. PR description saved at /workspace/pocket-id-pr.md.
<!-- SECTION:NOTES:END -->
