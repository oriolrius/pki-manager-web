---
id: task-010
title: Implement CA revocation backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:49'
updated_date: '2025-10-21 17:21'
labels:
  - backend
  - ca
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for revoking a root CA. Update CA status, generate CRL, log operation, and optionally cascade revocation to issued certificates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ca.revoke tRPC endpoint implemented
- [x] #2 Input validation for revocation reason
- [x] #3 CA status updated to 'revoked'
- [x] #4 Revocation date and reason stored
- [x] #5 CRL generated including revoked CA
- [x] #6 Audit log entry created
- [x] #7 Optional cascade revocation to certificates
- [x] #8 Validation prevents re-revoking revoked CA
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Analyze requirements for CA revocation
2. Implement ca.revoke tRPC endpoint with input validation
3. Validate CA exists and is not already revoked
4. Update CA status to revoked in database
5. Store revocation date and reason
6. Generate CRL including revoked CA
7. Create audit log entry
8. Implement optional cascade revocation to certificates
9. Add validation to prevent re-revoking
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the CA revocation endpoint with comprehensive features:

- Created tRPC mutation endpoint with Zod input validation for revocation reason
- Validates CA exists before attempting revocation
- Prevents re-revoking already revoked CAs with appropriate error message
- Updates CA status to "revoked" in database
- Stores revocation date and reason in database
- Implements cascade revocation to all active certificates issued by the CA
- Generates CRL record including all revoked certificates
- Maintains CRL versioning with incrementing CRL numbers
- Creates comprehensive audit log entries for both success and failure cases
- Returns detailed revocation information including cascade count and CRL details
- Proper error handling with TRPC errors and logging

Note: CRL PEM generation with KMS signing will be enhanced in a future update. Currently creates CRL records in database with metadata.

All acceptance criteria have been met.
<!-- SECTION:NOTES:END -->
