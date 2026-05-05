---
id: TASK-109.09
title: Define PKIManagerIssuer + PKIManagerClusterIssuer CRDs
status: To Do
assignee: []
created_date: '2026-05-05 16:20'
updated_date: '2026-05-05 16:23'
labels:
  - controller
  - k8s
dependencies:
  - TASK-109.02
documentation:
  - >-
    https://github.com/cert-manager/sample-external-issuer/tree/main/api/v1alpha1
  - 'https://kubernetes.io/docs/reference/using-api/cel/'
  - 'https://book.kubebuilder.io/reference/markers/crd-validation.html'
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two CRDs (Issuer namespaced, ClusterIssuer cluster-scoped). Spec: url, caBundle, authSecretRef, caId. CEL validation (k8s 1.30+). Status with conditions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CRDs generated via controller-gen kubebuilder markers
- [ ] #2 CEL validation rejects invalid url/empty caId
- [ ] #3 Status subresource enabled with metav1.Condition
- [ ] #4 Issuer and ClusterIssuer share spec via interface
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Mirror sample-external-issuer api/v1alpha1 Issuer/ClusterIssuer types. Add CEL x-kubernetes-validations for url and caId per K8s 1.30+ stable rules.
<!-- SECTION:NOTES:END -->
