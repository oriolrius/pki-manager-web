---
id: TASK-109.10
title: 'Issuer reconciler: validate config and probe health'
status: Done
assignee: []
created_date: '2026-05-05 16:20'
updated_date: '2026-05-05 17:03'
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
Shared IssuerReconciler handles both Issuer and ClusterIssuer kinds via Kind discriminator. Loads auth Secret (ClusterIssuer uses controller's namespace), probes /health, validates CAID match. Ready condition: Verified / SecretMissing / Unreachable / CAIDMismatch with backoff requeue.
<!-- SECTION:NOTES:END -->
