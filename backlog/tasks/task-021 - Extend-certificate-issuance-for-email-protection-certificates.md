---
id: task-021
title: Extend certificate issuance for email protection certificates
status: In Progress
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
Extend the certificate issuance endpoint to support S/MIME email encryption and signing certificates with appropriate key usage, EKU, and validation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Email protection certificate type supported
- [x] #2 Email address required in DN or SAN
- [x] #3 Multiple email addresses supported in SAN
- [x] #4 Email address validation
- [x] #5 Key Usage set: Digital Signature, Key Encipherment, Data Encipherment
- [x] #6 Extended Key Usage set: Email Protection
- [x] #7 CN validation for user's full name
- [x] #8 Validation: all emails from same domain

- [x] #9 Tests written to validate email protection certificate issuance
- [x] #10 All tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Already implemented in task-019 together
2. All validation and logic added
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Extended certificate.issue endpoint to support email protection (S/MIME) certificates:

- Added email protection certificate validation in certificate.ts
- Email address validation (at least one required in SANs)
- Multiple email addresses support in SAN
- Same-domain validation for all emails
- Max validity of 2 years (730 days)
- Proper key usage and EKU support for email protection
- All validation integrated into type-specific switch statement
- All 27 tests passing

Note: Tasks 019, 020, and 021 implemented together

Files modified:
- backend/src/trpc/procedures/certificate.ts
<!-- SECTION:NOTES:END -->
