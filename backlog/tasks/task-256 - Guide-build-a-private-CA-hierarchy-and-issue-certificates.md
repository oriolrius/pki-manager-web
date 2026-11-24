---
id: TASK-256
title: 'Guide: build a private CA hierarchy and issue certificates'
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
ordinal: 76014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Real use case: root CA (PKI Manager creates root CAs only; no intermediate/subordinate CA exists in the product), server and client certificates with SANs, download formats (PEM, PKCS#12, JKS), renew, revoke, CRL distribution, bulk issuance, expiry monitoring.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each step has a screenshot and the matching openssl check of the result
- [x] #2 Revocation is shown end to end: revoke, new CRL, client rejects the certificate
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- docs/guides/private-ca.md: 9 steps, 19 screenshots, 1 screencast; every step has the real openssl/keytool/curl check.
- Revocation end to end: UI revoke, CRL from the URL in the cert lists the serial, openssl verify -crl_check / s_client / curl --crlfile report "certificate revoked".
- Product findings filed: TASK-264 (no CRL before first revocation), TASK-265 (renew ignores key reuse), TASK-266 (CA form key usage text), TASK-267 (export password in URLs).
<!-- SECTION:NOTES:END -->
