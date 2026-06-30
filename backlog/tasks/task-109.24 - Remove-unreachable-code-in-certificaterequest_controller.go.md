---
id: TASK-109.24
title: Remove unreachable code in certificaterequest_controller.go
status: Done
assignee:
  - '@myself'
created_date: '2026-06-29 10:51'
updated_date: '2026-06-29 12:47'
labels:
  - k8s
  - cleanup
dependencies: []
parent_task_id: TASK-109
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
certificaterequest_controller.go contains unreachable statements after `return ctrl.Result{}, lastErr` (around L198-199). Harmless at runtime but flagged by go vet and confusing to readers. Remove the dead code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No unreachable statements remain in k8s/issuer/internal/controllers/certificaterequest_controller.go
- [x] #2 make vet (go vet ./...) reports no issues
- [x] #3 make test still passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removed the two unreachable statements after `return ctrl.Result{}, lastErr` (logger.Info + a second return) in internal/controllers/certificaterequest_controller.go. logger is still used (lines 60, 88) so no unused-var fallout. Verified: go vet ./... clean (previously flagged :198 unreachable), go build ./... OK, go test ./... 3 passed in 4 packages.
<!-- SECTION:NOTES:END -->
