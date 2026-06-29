---
id: TASK-109.23
title: Grant cert-manager approval RBAC for pki-manager.issuer.io issuers
status: To Do
assignee: []
created_date: '2026-06-29 10:51'
labels:
  - k8s
  - cert-manager
  - helm
dependencies: []
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
cert-manager 1.16+ requires every CertificateRequest to be Approved before an external issuer may sign it. The built-in approver only auto-approves first-party (cert-manager.io) issuers, so requests targeting our external group pki-manager.issuer.io are never auto-approved. The in-cluster e2e currently works around this by patching the Approved condition by hand (k8s/issuer/test/e2e/in-cluster/README.md:77-81).

Provide a supported approval path: add a ClusterRole granting the approve verb on signers.cert-manager.io scoped to our issuer signer names, bound to the controller ServiceAccount (templated in the Helm chart), or document the operator-managed approval model. Remove the manual kubectl patch from the e2e flow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Helm chart templates a ClusterRole with verb 'approve' on resource 'signers.cert-manager.io' scoped to the pki-manager.issuer.io issuer/clusterissuer signer names, bound to the controller ServiceAccount
- [ ] #2 A freshly applied Certificate in the in-cluster e2e is issued with no manual 'kubectl patch ... Approved' step
- [ ] #3 docs/install.md documents the approval model and any RBAC the cluster operator must grant
<!-- AC:END -->
