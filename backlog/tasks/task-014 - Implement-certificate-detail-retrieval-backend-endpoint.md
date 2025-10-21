---
id: task-014
title: Implement certificate detail retrieval backend endpoint
status: In Progress
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
