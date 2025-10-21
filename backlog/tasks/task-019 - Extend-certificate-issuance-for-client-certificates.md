---
id: task-019
title: Extend certificate issuance for client certificates
status: To Do
assignee: []
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 19:50'
labels:
  - backend
  - certificate
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the certificate issuance endpoint to support client authentication certificates with appropriate key usage, EKU, and validation rules.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Client certificate type supported in certificate.issue
- [ ] #2 CN validation for email or username format
- [ ] #3 Email address SAN support
- [ ] #4 UPN (User Principal Name) SAN support
- [ ] #5 Key Usage set: Digital Signature, Key Encipherment
- [ ] #6 Extended Key Usage set: Client Authentication
- [ ] #7 Optional exportable private key support
- [ ] #8 PKCS#12 generation for client certificates
- [ ] #9 Default validity of 1 year

- [ ] #10 Tests written to validate client certificate issuance
- [ ] #11 All tests pass
<!-- AC:END -->
