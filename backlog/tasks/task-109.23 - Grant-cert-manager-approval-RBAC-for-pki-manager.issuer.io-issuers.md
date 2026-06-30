---
id: TASK-109.23
title: Grant cert-manager approval RBAC for pki-manager.issuer.io issuers
status: Done
assignee:
  - '@myself'
created_date: '2026-06-29 10:51'
updated_date: '2026-06-29 13:25'
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
- [x] #1 Helm chart templates a ClusterRole with verb 'approve' on resource 'signers.cert-manager.io' scoped to the pki-manager.issuer.io issuer/clusterissuer signer names, bound to the controller ServiceAccount
- [x] #2 A freshly applied Certificate in the in-cluster e2e is issued with no manual 'kubectl patch ... Approved' step
- [x] #3 docs/install.md documents the approval model and any RBAC the cluster operator must grant
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented approver RBAC in the Helm chart:
- New template deploy/helm/pki-manager-issuer/templates/approver-rbac.yaml (gated by approver.enabled, default true): ClusterRole granting `approve` on signers.cert-manager.io for resourceNames issuers.pki-manager.issuer.io/* and clusterissuers.pki-manager.issuer.io/*, plus a ClusterRoleBinding to the CERT-MANAGER controller ServiceAccount (its internal approver — not our controller SA).
- values.yaml: approver.enabled + approver.certManagerServiceAccount.{name,namespace} (defaults cert-manager/cert-manager).
- Validated: `helm lint` clean; `helm template` renders the ClusterRole+Binding when enabled and nothing when approver.enabled=false.
- e2e in-cluster README: removed the manual `kubectl patch ... Approved` step (chart now auto-approves).
- docs/install.md: added "Approval (cert-manager 1.16+)" section + override values + troubleshooting row (AC#3).

AC status: #1 done (chart RBAC, verified by helm render). #3 done (docs). #2 implemented (manual patch removed) but NOT verified end-to-end here — needs a `make e2e-in-cluster` kind run (not runnable in this environment). Left unchecked until that run confirms a Certificate issues without the manual patch.

Verified end-to-end in kind (2026-06-29): a Certificate referencing the ClusterIssuer was issued with NO manual approval — CertificateRequest Approved=True (reason cert-manager.io, i.e. the approver, enabled by the chart approver RBAC), Ready=True/Issued. cert-manager controller SA was cert-manager/cert-manager (chart defaults matched).
<!-- SECTION:NOTES:END -->
