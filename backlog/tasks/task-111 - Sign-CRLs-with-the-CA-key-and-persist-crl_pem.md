---
id: TASK-111
title: Sign CRLs with the CA key and persist crl_pem
status: Done
assignee:
  - '@myself'
created_date: '2026-06-29 14:03'
updated_date: '2026-06-29 14:46'
labels:
  - crl
  - backend
milestone: CRL Signing & Distribution
dependencies:
  - TASK-110
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the placeholder in crl.service.ts so it produces a signed, valid X.509 v2 CRL using the approach chosen in the investigation task, and stores the PEM in crls.crl_pem.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 crl.service produces a signed X.509 v2 CRL whose signature verifies against the issuing CA cert
- [x] #2 CRL contains a monotonic crlNumber, thisUpdate/nextUpdate, and one revokedCertificate entry per revoked cert (correct serial, revocation date, reason code)
- [x] #3 openssl crl -in <crl> -noout -text parses it and openssl verifies the signature against the CA
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
crypto/crl.ts rewritten: real RFC 5280 X.509 v2 CRL (crlNumber + AKI ext, per-entry reason codes, UTCTime/GeneralizedTime), signed with node crypto (RSA PKCS#1v1.5 + ECDSA DER). crl.service exports the CA key (resolving the real private-key id via the cert PrivateKeyLink when kmsKeyId==certId) and persists crl_pem. Verified by unit tests (src/crypto/crl.test.ts), integration (crl-revocation.test.ts) and openssl (spike-crl-sign.ts).
<!-- SECTION:NOTES:END -->
