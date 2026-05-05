---
id: TASK-109.18
title: 'Documentation: install, register cluster, usage examples'
status: To Do
assignee: []
created_date: '2026-05-05 16:21'
updated_date: '2026-05-05 16:23'
labels:
  - docs
dependencies:
  - TASK-109.17
documentation:
  - 'https://cert-manager.io/docs/configuration/external/'
parent_task_id: TASK-109
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Markdown docs: Helm install, register cluster in UI, create Issuer with token Secret, example Certificate for Ingress TLS, troubleshooting.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Install guide covers Helm install + CRD ordering
- [ ] #2 End-to-end walkthrough produces working Ingress TLS cert
- [ ] #3 Troubleshooting section covers token, RBAC, network errors
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Mirror cert-manager external issuer docs structure: Quickstart, Configuration, Examples, Troubleshooting. Cross-link from PKI Manager UI Clusters page.
<!-- SECTION:NOTES:END -->
