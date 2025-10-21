---
id: task-020
title: Extend certificate issuance for code signing certificates
status: Done
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 20:02'
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
- [x] #1 Code signing certificate type supported
- [x] #2 Organization validation enforced
- [x] #3 Key Usage set: Digital Signature
- [x] #4 Extended Key Usage set: Code Signing
- [x] #5 Minimum key strength enforced (RSA-3072 or ECDSA-P256)
- [x] #6 Maximum validity of 3 years enforced
- [x] #7 Enhanced audit logging for code signing certs
- [x] #8 Additional verification requirements documented

- [x] #9 Tests written to validate code signing certificate issuance
- [x] #10 All tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Already implemented in task-019 together
2. All validation and logic added
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Extended certificate.issue endpoint to support code signing certificates:

- Added code signing certificate validation in certificate.ts
- Organization validation (required for code signing)
- Minimum key strength enforcement (RSA-3072, RSA-4096, or ECDSA-P256)
- Max validity of 3 years (1095 days)
- Proper key usage and EKU support for code signing
- All validation integrated into type-specific switch statement
- All 27 tests passing

Note: Tasks 019, 020, and 021 implemented together

Files modified:
- backend/src/trpc/procedures/certificate.ts
<!-- SECTION:NOTES:END -->
