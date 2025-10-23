---
id: task-058
title: Review and verify certificate creation TRPC endpoint
status: Done
assignee:
  - '@claude'
created_date: '2025-10-23 16:02'
updated_date: '2025-10-23 18:44'
labels:
  - backend
  - trpc
  - certificate
  - review
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review the certificate.issue TRPC endpoint implementation to ensure it follows the same patterns and best practices as the CA creation endpoint, with proper KMS integration, validation, and minimal schema compliance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Certificate creation endpoint uses KMS for key generation and certificate signing
- [x] #2 All certificate types (server, client, code_signing, email) have proper validation
- [x] #3 Minimal schema is correctly implemented (fetches from KMS, stores only metadata)
- [x] #4 Audit logging is present for success and failure cases
- [x] #5 Error handling follows the same pattern as CA creation
- [x] #6 Certificate metadata (SANs, extensions) is properly stored and retrieved
- [x] #7 Tests exist and pass for certificate creation endpoint
- [x] #8 KMS integration works correctly with issuer CA keys
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Locate and review certificate.issue TRPC endpoint implementation
2. Review CA creation endpoint as reference for best practices
3. Verify KMS integration for key generation and certificate signing
4. Check validation logic for all certificate types (server, client, code_signing, email)
5. Verify minimal schema implementation (KMS fetch, metadata storage)
6. Audit logging verification for success/failure cases
7. Error handling pattern comparison with CA creation
8. Certificate metadata (SANs, extensions) storage and retrieval check
9. Review existing tests and run test suite
10. Document findings and fix any issues identified
<!-- SECTION:PLAN:END -->

## Implementation Notes

### Review Summary

Completed comprehensive review of certificate.issue TRPC endpoint (src/trpc/procedures/certificate.ts) against CA creation endpoint patterns. All acceptance criteria verified and passing.

### Findings

**AC #1: KMS Integration ✅**
- Lines 718-725: Key pair generation via kmsService.createKeyPair()
- Lines 748-757: Certificate signing via kmsService.signCertificate() with issuer CA keys
- Properly uses caRecord.kmsKeyId and caRecord.kmsCertificateId for signing

**AC #2: Certificate Type Validation ✅**
- Lines 538-566: Server certificate validation (validity max 825 days, domain name, SANs)
- Lines 568-600: Client certificate validation (validity max 730 days, email/username CN, email SANs)
- Lines 602-627: Code signing validation (organization required, validity max 1095 days, minimum RSA-3072)
- Lines 629-657: Email certificate validation (email addresses required, same-domain enforcement, validity max 730 days)

**AC #3: Minimal Schema ✅**
- Lines 769-785: Database stores only metadata (no certificate PEM column)
- Lines 362-365 (getById): Certificate PEM fetched from KMS on-demand
- Lines 780-782: SANs stored as JSON strings (metadata only)
- Fixed bug at line 509: certificatePem now correctly references variable from KMS fetch

**AC #4: Audit Logging ✅**
- Lines 788-807: Successful certificate creation audit log
- Lines 824-844: Failed certificate creation audit log
- All operations (renew, revoke, delete, download) have matching success/failure audit logs

**AC #5: Error Handling ✅**
- Lines 820-850: Identical pattern to CA creation (try-catch, logger.error, audit log, TRPCError)
- Consistent across all certificate operations

**AC #6: Certificate Metadata ✅**
- Lines 780-782 (issue): SANs stored as JSON strings
- Lines 496-498 (getById): SANs parsed and returned
- Lines 394-432 (getById): Extensions (keyUsage, extendedKeyUsage, basicConstraints) extracted from certificate

**AC #7: Tests ✅**
- src/trpc/procedures/certificate.test.ts contains 20 tests covering:
  - certificate.renew (validation, key reuse policy, error cases)
  - certificate.revoke (success, double-revocation prevention, date validation)
  - certificate.delete (revoked/expired deletion, active certificate prevention)
  - certificate.issue validation for all 4 types (client, code_signing, email, plus server)
- All tests pass: 20 passed (20) in 10.58s

**AC #8: KMS Integration with Issuer CA Keys ✅**
- Lines 750-752: Correctly uses issuerPrivateKeyId, issuerCertificateId, and issuerName from CA record
- Proper validation of CA status and expiry before certificate issuance

### Bugs Fixed During Review
1. Line 509: Fixed certificatePem reference bug (was certificate.certificatePem, now certificatePem)
2. Frontend CA dropdown: Added filter to only show active CAs
3. Database: Removed mock test data with invalid KMS IDs

### Conclusion
Certificate creation endpoint fully compliant with CA creation patterns and minimal schema architecture. All 8 acceptance criteria verified and passing.
