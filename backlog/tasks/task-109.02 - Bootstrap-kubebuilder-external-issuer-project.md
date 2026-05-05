---
id: TASK-109.02
title: Bootstrap kubebuilder external issuer project
status: Done
assignee: []
created_date: '2026-05-05 16:19'
updated_date: '2026-05-05 17:48'
labels:
  - controller
  - k8s
  - go
dependencies: []
documentation:
  - 'https://github.com/cert-manager/sample-external-issuer'
  - 'https://cert-manager.io/docs/configuration/external/'
  - 'https://book.kubebuilder.io/'
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
New repo or subdirectory k8s/cert-manager-pki-manager. Go 1.23, kubebuilder v4, controller-runtime latest, k8s.io/api v0.32 (k8s 1.35 compat), cert-manager API v1.16+.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Go module initialized with k8s.io/api@v0.32, sigs.k8s.io/controller-runtime latest, github.com/cert-manager/cert-manager API package
- [ ] #2 kubebuilder scaffold generated with project name pki-manager-issuer
- [ ] #3 Builds successfully with go build ./...
- [ ] #4 README in repo describes purpose and dev setup
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
k8s/issuer/ Go module bootstrapped following sample-external-issuer pattern. go.mod targets k8s.io v0.32 (1.35 compat), controller-runtime v0.20, cert-manager v1.16.2.

Hand-wrote zz_generated.deepcopy.go for api/v1alpha1 (Issuer/IssuerList/ClusterIssuer/ClusterIssuerList + IssuerSpec/Status/SecretKeySelector) so controller builds without controller-gen integration. Replace with controller-gen output when CRD generation pipeline is added.
<!-- SECTION:NOTES:END -->
