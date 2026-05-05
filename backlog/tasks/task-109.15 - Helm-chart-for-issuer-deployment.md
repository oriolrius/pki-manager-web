---
id: TASK-109.15
title: Helm chart for issuer deployment
status: To Do
assignee: []
created_date: '2026-05-05 16:21'
updated_date: '2026-05-05 16:23'
labels:
  - deployment
  - helm
dependencies:
  - TASK-109.13
documentation:
  - 'https://helm.sh/docs/chart_best_practices/custom_resource_definitions/'
  - >-
    https://github.com/cert-manager/cert-manager/tree/master/deploy/charts/cert-manager
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Chart packaging CRDs (crds/ dir), Deployment, SA, RBAC, ServiceMonitor (optional), NetworkPolicy. values.yaml with image, resources, leaderElection toggle, affinity, tolerations.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 helm install --dry-run renders valid manifests on k8s 1.35
- [ ] #2 CRDs installed before controller via crds/ dir
- [ ] #3 RBAC limited to needed verbs on cert-manager.io and our group
- [ ] #4 Optional ServiceMonitor for Prometheus Operator
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow Helm CRD best practice: ship CRDs in crds/ dir (install-only, no upgrade). Mirror cert-manager chart structure for RBAC, ServiceAccount, NetworkPolicy templates.
<!-- SECTION:NOTES:END -->
