---
id: TASK-109.17
title: Local kind-based E2E test suite
status: To Do
assignee: []
created_date: '2026-05-05 16:21'
updated_date: '2026-05-05 16:23'
labels:
  - testing
  - e2e
  - kind
dependencies:
  - TASK-109.15
  - TASK-109.16
documentation:
  - 'https://kind.sigs.k8s.io/docs/user/quick-start/'
  - 'https://github.com/kyverno/chainsaw'
  - 'https://cert-manager.io/docs/installation/kubectl/'
  - 'https://github.com/cert-manager/sample-external-issuer/blob/main/Makefile'
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Local-runnable E2E: kind cluster with k8s 1.35 (kindest/node:v1.35.x), install cert-manager 1.16+, deploy our Helm chart, run PKI Manager backend (docker compose), register cluster via API, apply Issuer + Certificate, assert resulting Secret has valid cert chain matching CA bundle. Single command: make e2e-local. Should also cover revoke-on-delete and cluster token rotation. Use chainsaw or kuttl declarative tests where possible.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 make e2e-local spins up kind 1.35, cert-manager, PKI Manager, controller and runs full suite
- [ ] #2 Test issues cert via Certificate resource and validates chain against PKI Manager CA bundle
- [ ] #3 Test covers ClusterIssuer + namespaced Issuer
- [ ] #4 Test covers revoke-on-delete path
- [ ] #5 Test covers token rotation (revoke old, rotate, expect Issuer Ready=False then True)
- [ ] #6 Suite runs in <10 min on developer laptop
- [ ] #7 CI workflow runs same suite via GH Actions on PRs
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reuse sample-external-issuer Makefile e2e targets as starting point. Use chainsaw (preferred over kuttl, more active) for declarative test cases. Pin kindest/node digest for reproducibility.
<!-- SECTION:NOTES:END -->
