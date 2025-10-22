---
id: task-022
title: Implement CRL generation backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 04:11'
labels:
  - backend
  - crl
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for generating Certificate Revocation Lists. Collect revoked certificates, generate CRL in X.509 format, sign with CA key, store in database.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 crl.generate endpoint implemented
- [x] #2 All revoked certificates collected for CA
- [ ] #3 CRL generated in X.509 v2 format
- [x] #4 CRL number auto-incremented
- [x] #5 This Update and Next Update dates set
- [ ] #6 CRL extensions included (CRL Number, Authority Key Identifier)
- [ ] #7 CRL signed with CA private key via KMS
- [x] #8 CRL stored in database
- [x] #9 Revoked certificate count tracked
- [x] #10 Audit log entry created

- [x] #11 Unit tests implemented and passing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Review X.509 CRL v2 format and node-forge CRL generation capabilities
2. Create CRL generation utility function in crypto module
3. Implement crl.generate endpoint in procedures/crl.ts
4. Collect revoked certificates for the given CA
5. Generate CRL with proper extensions (CRL Number, Authority Key Identifier)
6. Sign CRL using CA private key via KMS (or node-forge if KMS doesn't support CRL signing)
7. Store generated CRL in database with auto-incremented CRL number
8. Add audit logging for CRL generation
9. Write unit tests for CRL generation
10. Test the complete flow
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Implemented CRL generation backend endpoint with metadata tracking and audit logging.

### What Was Implemented

1. **CRL Generation Endpoint** (`backend/src/trpc/procedures/crl.ts`)
   - Implemented `crl.generate` mutation endpoint
   - Collects all revoked certificates for the specified CA
   - Auto-increments CRL number for each CA
   - Sets This Update and Next Update dates based on `nextUpdateDays` parameter
   - Tracks revoked certificate count
   - Stores CRL metadata in database
   - Creates comprehensive audit log entries

2. **Test Coverage** (`backend/src/trpc/procedures/crl.test.ts`)
   - 5 integration tests covering:
     - CRL generation with revoked certificates
     - CRL number auto-increment
     - Validity period configuration
     - Error handling for non-existent CA
     - Revoked certificate counting
   - All tests passing

### Important Limitation: KMS Signing

The current implementation creates CRL metadata records but does not generate signed CRL PEM data. This is because:

1. **Security Design**: The KMS correctly does not expose private keys for export
2. **Missing KMS Feature**: The KMS does not currently support CRL signing operations

**Full CRL signing requires one of:**
- KMS enhancement to add CRL signing capability
- Alternative architecture where CAs use locally-stored keys (less secure)
- Hybrid approach with dedicated CRL signing service

The infrastructure and data model are complete and ready for CRL signing once the KMS limitation is addressed.

### Files Modified/Created

- Modified: `backend/src/trpc/procedures/crl.ts`
- Created: `backend/src/trpc/procedures/crl.test.ts`
- Existing: `backend/src/crypto/crl.ts` (CRL generation utility already existed)

### Acceptance Criteria Status

- ✅ crl.generate endpoint implemented
- ✅ All revoked certificates collected for CA
- ⏳ CRL generated in X.509 v2 format (infrastructure ready, KMS signing needed)
- ✅ CRL number auto-incremented
- ✅ This Update and Next Update dates set
- ⏳ CRL extensions (ready in utility, pending KMS signing)
- ⏳ CRL signed with CA private key via KMS (requires KMS enhancement)
- ✅ CRL stored in database
- ✅ Revoked certificate count tracked
- ✅ Audit log entry created
- ✅ Unit tests implemented and passing (5 tests)

### Testing

All 5 tests passing for CRL generation endpoint.
<!-- SECTION:NOTES:END -->
