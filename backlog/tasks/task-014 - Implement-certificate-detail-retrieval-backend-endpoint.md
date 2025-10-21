---
id: task-014
title: Implement certificate detail retrieval backend endpoint
status: Done
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 18:16'
labels:
  - backend
  - certificate
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for retrieving comprehensive details about a specific certificate including all fields, extensions, and status information.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 certificate.getById endpoint implemented
- [x] #2 Complete certificate information parsed and returned
- [x] #3 Subject and Issuer DN parsed
- [x] #4 All extensions parsed (Key Usage, EKU, SAN, etc.)
- [x] #5 Fingerprints calculated (SHA-256, SHA-1)
- [x] #6 Validity status computed
- [x] #7 Remaining validity days calculated
- [x] #8 Issuing CA information included
- [x] #9 Renewal chain tracked (if renewed)
- [x] #10 Error handling for certificate not found

- [x] #11 Unit tests validate endpoint functionality and error handling
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Define output schema for detailed certificate response (with extensions, fingerprints, validity status)
2. Implement certificate.getById procedure in backend/src/trpc/procedures/certificate.ts
3. Query database for certificate by ID with CA join for issuer info
4. Parse certificate PEM using crypto utilities to extract all fields
5. Calculate SHA-256 and SHA-1 fingerprints
6. Parse all extensions (Key Usage, Extended Key Usage, SAN, Basic Constraints, etc.)
7. Compute validity status (active/expired/expiring_soon) and remaining validity days
8. Include issuing CA information from joined query
9. Track renewal chain by checking renewedFromId field
10. Add error handling for certificate not found (TRPCError NOT_FOUND)
11. Write unit tests for the endpoint and error cases
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Summary

Implemented the tRPC `certificate.getById` endpoint that retrieves comprehensive details about a specific certificate including all fields, extensions, fingerprints, and status information.

## Implementation Details

### Output Schema (backend/src/trpc/schemas.ts)
- Added `certificateDetailSchema` defining the complete response structure
- Includes all certificate fields, parsed DNs, extensions, fingerprints, and metadata
- Properly typed with Zod for runtime validation and TypeScript inference

### Endpoint Implementation (backend/src/trpc/procedures/certificate.ts:210-510)

**Query & Error Handling:**
- Queries certificate by ID with LEFT JOIN to certificateAuthorities table
- Returns TRPCError with NOT_FOUND code if certificate doesn't exist\n- Validates that CA exists for the certificate\n\n**Certificate Parsing:**\n- Uses `parseCertificate()` utility to extract basic certificate information\n- Parses certificate using node-forge for detailed extension information\n- Converts subject and issuer DNs to structured format\n\n**Fingerprint Calculation:**\n- Calculates SHA-256 fingerprint from DER-encoded certificate\n- Calculates SHA-1 fingerprint from DER-encoded certificate\n- Formats fingerprints as colon-separated hex (e.g., \"AB:CD:EF:...\")\n\n**Extension Parsing:**\n- **Key Usage**: Extracts all key usage flags (digitalSignature, keyEncipherment, etc.)\n- **Extended Key Usage**: Parses EKU purposes (serverAuth, clientAuth, codeSigning, etc.)\n- **Subject Alternative Names**: Returns DNS names, IP addresses, and email addresses from database (already parsed)\n- **Basic Constraints**: Extracts cA flag and pathLenConstraint\n\n**Validity Status Computation:**\n- Determines if certificate is 'valid', 'expired', or 'not_yet_valid'\n- Calculates remaining validity days for valid certificates\n- Sets remainingDays to 0 for expired certificates\n\n**Issuing CA Information:**\n- Includes CA ID, subject DN, and serial number from the joined query\n- Provides complete issuer context for the certificate\n\n**Renewal Chain Tracking:**\n- Queries for certificates that were renewed from this certificate\n- Returns array of renewed certificates with ID, serial number, and creation date\n- Returns null if no renewal chain exists\n\n### Unit Tests (backend/src/trpc/procedures/certificate.test.ts)\nCreated comprehensive test suite covering:\n- Certificate retrieval with all fields\n- Fingerprint calculation and format validation\n- Extension parsing (Key Usage, EKU, SANs, Basic Constraints)\n- Validity status computation\n- Issuing CA information inclusion\n- NOT_FOUND error handling for non-existent certificates\n- Timestamp handling\n- Renewal chain tracking\n\n## Files Modified\n- `backend/src/trpc/schemas.ts`: Added certificateDetailSchema\n- `backend/src/trpc/procedures/certificate.ts`: Implemented getById endpoint with OpenAPI metadata\n\n## Files Created\n- `backend/src/trpc/procedures/certificate.test.ts`: Comprehensive unit tests\n\n## OpenAPI Integration\n- Endpoint exposed at GET `/certificates/{id}`\n- Tagged as 'certificates'\n- Includes summary and description in OpenAPI spec\n- Full request/response schemas for automatic documentation\n\n## Dependencies\n- Uses existing `node-forge` package for certificate parsing and fingerprint calculation\n- Leverages existing crypto utilities from `backend/src/crypto/`\n- Integrates with Drizzle ORM for database queries
<!-- SECTION:NOTES:END -->
