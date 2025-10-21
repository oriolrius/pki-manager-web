---
id: task-020
title: Extend certificate issuance for code signing certificates
status: To Do
assignee: []
created_date: '2025-10-21 15:50'
labels:
  - backend
  - certificate
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the certificate issuance endpoint to support code signing certificates with appropriate key usage, EKU, validation, and enhanced audit logging.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Code signing certificate type supported
- [ ] #2 Organization validation enforced
- [ ] #3 Key Usage set: Digital Signature
- [ ] #4 Extended Key Usage set: Code Signing
- [ ] #5 Minimum key strength enforced (RSA-3072 or ECDSA-P256)
- [ ] #6 Maximum validity of 3 years enforced
- [ ] #7 Enhanced audit logging for code signing certs
- [ ] #8 Additional verification requirements documented
<!-- AC:END -->
