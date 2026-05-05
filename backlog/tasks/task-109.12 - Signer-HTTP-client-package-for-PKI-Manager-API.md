---
id: TASK-109.12
title: Signer HTTP client package for PKI Manager API
status: To Do
assignee: []
created_date: '2026-05-05 16:21'
updated_date: '2026-05-05 16:23'
labels:
  - controller
dependencies:
  - TASK-109.02
  - TASK-109.01
documentation:
  - >-
    https://github.com/cert-manager/sample-external-issuer/tree/main/internal/issuer/signer
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Internal Go pkg wrapping /external/* endpoints. Typed types, retry+backoff, context-aware, slog. Unit-tested with httptest.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sign/Revoke/CABundle/Health methods implemented
- [ ] #2 Configurable timeout and retry policy
- [ ] #3 Unit tests cover success, 4xx, 5xx, network error
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow signer interface pattern from sample (HealthChecker + Signer interfaces). Inject via factory for testability. Use net/http with Retry-After honoring middleware.
<!-- SECTION:NOTES:END -->
