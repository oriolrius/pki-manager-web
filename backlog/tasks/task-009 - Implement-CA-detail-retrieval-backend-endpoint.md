---
id: task-009
title: Implement CA detail retrieval backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:49'
updated_date: '2025-10-21 17:19'
labels:
  - backend
  - ca
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for retrieving detailed information about a specific root CA including certificate details, extensions, and statistics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ca.getById tRPC endpoint implemented
- [x] #2 Complete CA information returned
- [x] #3 Certificate parsed and fields extracted
- [x] #4 Extensions parsed (Key Usage, Basic Constraints, SKI)
- [x] #5 Certificate fingerprints calculated (SHA-256, SHA-1)
- [x] #6 Validity status computed
- [x] #7 Issued certificate count included
- [x] #8 Error handling for CA not found
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Analyze requirements for CA detail retrieval
2. Implement ca.getById tRPC endpoint
3. Retrieve CA record from database by ID
4. Parse certificate to extract detailed fields
5. Parse and extract extensions (Key Usage, Basic Constraints, SKI)
6. Calculate certificate fingerprints (SHA-256, SHA-1)
7. Compute validity status based on current date
8. Count and include issued certificate count
9. Handle CA not found error case
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the CA detail retrieval endpoint with comprehensive information:

- Created tRPC query endpoint to retrieve CA by ID
- Returns complete CA information including all database fields
- Parses certificate using node-forge to extract detailed metadata
- Extracts and structures X.509 v3 extensions:
  - Basic Constraints (cA flag, pathLenConstraint)
  - Key Usage (digitalSignature, keyCertSign, cRLSign, etc.)
  - Subject Key Identifier (SKI)
  - Authority Key Identifier (AKI)
- Calculates certificate fingerprints using SHA-256 and SHA-1 hashes
- Formats fingerprints with colon-separated hex pairs
- Computes validity status (valid, expired, not_yet_valid) based on current date
- Computes overall CA status (active, revoked, expired)
- Includes count of certificates issued by this CA
- Comprehensive error handling for CA not found (404)
- Returns both structured subject/issuer objects and DN strings

All acceptance criteria have been met.
<!-- SECTION:NOTES:END -->
