---
id: TASK-109.20
title: Security review and hardening
status: To Do
assignee: []
created_date: '2026-05-05 16:21'
updated_date: '2026-05-05 16:23'
labels:
  - security
dependencies:
  - TASK-109.18
documentation:
  - 'https://kubernetes.io/docs/concepts/security/'
  - 'https://owasp.org/www-project-kubernetes-top-ten/'
  - 'https://www.cisecurity.org/benchmark/kubernetes'
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Threat model: token theft, MITM, CA compromise blast radius. Verify TLS, NetworkPolicy egress-only, RBAC scoped, audit logs of every external sign with cluster id, request UID, subject CN, serial.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 TLS enforced on /external endpoints
- [ ] #2 NetworkPolicy restricts controller egress to PKI Manager API only
- [ ] #3 Audit log entry per sign/revoke with cluster + requester metadata
- [ ] #4 Threat model doc in docs/
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Run threat model with STRIDE. Validate against CIS Kubernetes Benchmark and OWASP K8s Top 10.
<!-- SECTION:NOTES:END -->
