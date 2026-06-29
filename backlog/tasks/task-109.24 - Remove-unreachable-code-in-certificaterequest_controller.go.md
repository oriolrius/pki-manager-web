---
id: TASK-109.24
title: Remove unreachable code in certificaterequest_controller.go
status: To Do
assignee: []
created_date: '2026-06-29 10:51'
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
- [ ] #1 No unreachable statements remain in k8s/issuer/internal/controllers/certificaterequest_controller.go
- [ ] #2 make vet (go vet ./...) reports no issues
- [ ] #3 make test still passes
<!-- AC:END -->
