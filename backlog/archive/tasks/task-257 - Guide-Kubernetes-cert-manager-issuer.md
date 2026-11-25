---
id: TASK-257
title: 'Guide: Kubernetes cert-manager issuer'
status: Done
assignee: []
created_date: '2026-11-24T09:15:00Z'
updated_date: '2026-11-24T10:26:00Z'
labels:
  - docs
milestone: m-1
dependencies:
  - TASK-254
  - TASK-251
ordinal: 77014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Real use case: install the external issuer with Helm, cluster token, issue a certificate for an Ingress, renewal.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A reader issues a certificate in a kind/k3d cluster by following the guide
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- docs/guides/k8s-issuer.md (site: guides/kubernetes): kind v0.31 / k8s 1.35, cert-manager 1.19.1, issuer image 64d0e19; ClusterIssuer Ready, Certificate Ready, Ingress, cmctl renew - all verified, cluster deleted.
- Found: chart default tag 0.1.0 not published and no Helm repo (k8s/issuer/docs/install.md fixed; TASK-262); ingress-shim Certificates have no CN and are rejected (TASK-268); cluster-issuer annotation cannot target an external issuer kind.
<!-- SECTION:NOTES:END -->
