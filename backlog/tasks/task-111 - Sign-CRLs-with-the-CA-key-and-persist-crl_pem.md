---
id: TASK-111
title: Sign CRLs with the CA key and persist crl_pem
status: To Do
assignee: []
created_date: '2026-06-29 14:03'
updated_date: '2026-06-29 14:04'
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
- [ ] #1 crl.service produces a signed X.509 v2 CRL whose signature verifies against the issuing CA cert
- [ ] #2 CRL contains a monotonic crlNumber, thisUpdate/nextUpdate, and one revokedCertificate entry per revoked cert (correct serial, revocation date, reason code)
- [ ] #3 openssl crl -in <crl> -noout -text parses it and openssl verifies the signature against the CA
<!-- AC:END -->
