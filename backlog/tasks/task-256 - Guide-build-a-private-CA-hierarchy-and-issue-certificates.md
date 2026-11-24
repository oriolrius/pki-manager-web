---
id: TASK-256
title: 'Guide: build a private CA hierarchy and issue certificates'
status: To Do
assignee: []
created_date: '2026-11-24T09:15:00Z'
labels:
  - docs
milestone: m-1
dependencies:
  - TASK-254
  - TASK-251
ordinal: 76014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Real use case: root CA, intermediate CA, server and client certificates with SANs, download formats (PEM, PKCS#12, JKS), renew, revoke, CRL distribution, bulk issuance, expiry monitoring.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each step has a screenshot and the matching openssl check of the result
- [ ] #2 Revocation is shown end to end: revoke, new CRL, client rejects the certificate
<!-- AC:END -->
