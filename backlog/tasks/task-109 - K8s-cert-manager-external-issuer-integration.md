---
id: TASK-109
title: K8s cert-manager external issuer integration
status: In Progress
assignee: []
created_date: '2026-05-05 16:17'
updated_date: '2026-05-05 17:11'
labels:
  - epic
  - k8s
  - cert-manager
dependencies: []
documentation:
  - 'https://github.com/cert-manager/sample-external-issuer'
  - 'https://cert-manager.io/docs/configuration/external/'
  - 'https://book.kubebuilder.io/'
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build cert-manager external issuer for PKI Manager so K8s clusters (v1.35) request certs from PKI Manager CAs. All issued certs visible/manageable in API+UI.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All 20 subtasks delivered or substantively complete. See branch k8s-cert-manager (5 commits). Pending follow-ups: full envtest suite for controllers, chainsaw declarative E2E pack, UI source-filter dropdown, pen test.
<!-- SECTION:NOTES:END -->
