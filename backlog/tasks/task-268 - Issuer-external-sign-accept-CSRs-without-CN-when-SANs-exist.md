---
id: TASK-268
title: 'Issuer/external sign: accept CSRs without CN when SANs exist'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-24T10:19:00Z'
updated_date: '2026-11-24T14:42:00Z'
labels:
  - k8s
dependencies: []
ordinal: 88014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
cert-manager ingress-shim creates Certificates with no commonName; PKI Manager rejects them with 400 INVALID_CSR (CSR subject must include CN), so Ingress annotations need cert-manager.io/common-name (docs k8s guide, 2026-11-24). RFC 5280 allows an empty subject with SANs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An Ingress with only the issuer annotations gets a certificate
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GitHub: https://github.com/oriolrius/pki-manager-web/issues/25
<!-- SECTION:NOTES:END -->
