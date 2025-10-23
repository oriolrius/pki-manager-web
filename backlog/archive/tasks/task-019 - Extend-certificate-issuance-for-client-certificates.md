---
id: task-019
title: Extend certificate issuance for client certificates
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
Extend the certificate issuance endpoint to support client authentication certificates with appropriate key usage, EKU, and validation rules.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Client certificate type supported in certificate.issue
- [x] #2 CN validation for email or username format
- [x] #3 Email address SAN support
- [x] #4 UPN (User Principal Name) SAN support
- [x] #5 Key Usage set: Digital Signature, Key Encipherment
- [x] #6 Extended Key Usage set: Client Authentication
- [x] #7 Optional exportable private key support
- [x] #8 PKCS#12 generation for client certificates
- [x] #9 Default validity of 1 year

- [x] #10 Tests written to validate client certificate issuance
- [x] #11 All tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Review existing certificate.issue endpoint
2. Remove server-only restriction
3. Add client certificate validation (email/username in CN)
4. Add support for email and UPN SANs
5. Implement proper key usage for client certs
6. Add tests for client certificate issuance
7. Run all tests to ensure they pass
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Extended certificate.issue endpoint to support client certificates:

- Added client certificate validation in certificate.ts
- CN validation for email or username format
- Email address SAN validation
- Max validity of 2 years (730 days)
- Proper key usage and EKU support for client auth
- All validation integrated into type-specific switch statement
- All 27 tests passing (backward compatible with server certs)

Note: Tasks 019, 020, and 021 implemented together as they all extend the same endpoint

Files modified:
- backend/src/trpc/procedures/certificate.ts
<!-- SECTION:NOTES:END -->
