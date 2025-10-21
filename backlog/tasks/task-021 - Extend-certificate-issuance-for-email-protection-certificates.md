---
id: task-021
title: Extend certificate issuance for email protection certificates
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
Extend the certificate issuance endpoint to support S/MIME email encryption and signing certificates with appropriate key usage, EKU, and validation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Email protection certificate type supported
- [ ] #2 Email address required in DN or SAN
- [ ] #3 Multiple email addresses supported in SAN
- [ ] #4 Email address validation
- [ ] #5 Key Usage set: Digital Signature, Key Encipherment, Data Encipherment
- [ ] #6 Extended Key Usage set: Email Protection
- [ ] #7 CN validation for user's full name
- [ ] #8 Validation: all emails from same domain

- [ ] #9 Tests written to validate email protection certificate issuance
- [ ] #10 All tests pass
<!-- AC:END -->
