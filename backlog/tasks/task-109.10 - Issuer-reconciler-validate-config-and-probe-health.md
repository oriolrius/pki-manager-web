---
id: TASK-109.10
title: 'Issuer reconciler: validate config and probe health'
status: To Do
assignee: []
created_date: '2026-05-05 16:20'
updated_date: '2026-05-05 16:23'
labels:
  - controller
dependencies:
  - TASK-109.09
  - TASK-109.05
documentation:
  - >-
    https://github.com/cert-manager/sample-external-issuer/blob/main/internal/controllers/issuer_controller.go
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reconcile Issuer/ClusterIssuer: load auth secret, call /external/health, set Ready condition with backoff.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Ready=True when /external/health returns 200
- [ ] #2 Ready=False with reason when secret missing/token invalid/API unreachable
- [ ] #3 Exponential backoff on transient errors
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Pattern from sample-external-issuer issuer_controller.go: shared reconciler for Issuer + ClusterIssuer via IssuerInterface. Set Ready condition with reasons (NotFound, SecretMissing, Unreachable, Verified).
<!-- SECTION:NOTES:END -->
