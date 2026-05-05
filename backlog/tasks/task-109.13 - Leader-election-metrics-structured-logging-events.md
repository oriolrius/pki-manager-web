---
id: TASK-109.13
title: 'Leader election, metrics, structured logging, events'
status: To Do
assignee: []
created_date: '2026-05-05 16:21'
updated_date: '2026-05-05 16:23'
labels:
  - controller
  - observability
dependencies:
  - TASK-109.11
documentation:
  - 'https://book.kubebuilder.io/reference/metrics.html'
  - >-
    https://github.com/kubernetes-sigs/controller-runtime/blob/main/pkg/manager/manager.go
parent_task_id: TASK-109
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
controller-runtime leader election (lease). Prom metrics: certificate_requests_total, sign_duration_seconds, errors_total. K8s events. slog.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Leader election enabled in Manager options
- [ ] #2 /metrics exposes custom metrics
- [ ] #3 Events recorded on Issuer and CertificateRequest
- [ ] #4 Logs structured (slog) with traceID, namespace, name
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Use controller-runtime built-in /metrics. Follow Prometheus naming: certmanager_pkimanager_sign_total, _duration_seconds. EventRecorder from Manager.GetEventRecorderFor().
<!-- SECTION:NOTES:END -->
