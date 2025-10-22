---
id: task-024
title: Implement CRL HTTP publishing endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 12:06'
labels:
  - backend
  - crl
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create public HTTP endpoint for serving CRLs. Make CRLs accessible at predictable URLs without authentication. Set proper MIME types and cache headers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Public HTTP endpoint created at /crl/{ca-id}.crl
- [x] #2 CRLs served without authentication
- [x] #3 Content-Type: application/pkix-crl header set
- [x] #4 Cache-Control headers set based on Next Update
- [x] #5 Last-Modified header set to This Update
- [x] #6 Expires header set to Next Update
- [x] #7 Support for both PEM (.crl) and DER (.der) formats
- [x] #8 404 handling for non-existent CAs

- [x] #9 Unit tests implemented and passing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Analyze existing CRL code and server structure
2. Add GET /crl/:caId.crl endpoint in server.ts for PEM format
3. Add GET /crl/:caId.der endpoint in server.ts for DER format
4. Set proper HTTP headers (Content-Type, Cache-Control, Last-Modified, Expires)
5. Add 404 handling for non-existent CAs/CRLs
6. Ensure no authentication required
7. Write unit tests for the endpoint
8. Test all acceptance criteria
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented public CRL HTTP endpoint in server.ts:

- Added GET /crl/:caId.crl endpoint for PEM format
- Added GET /crl/:caId.der endpoint for DER format
- Set proper HTTP headers:
  - Content-Type: application/pkix-crl
  - Cache-Control: public, max-age calculated from nextUpdate
  - Last-Modified: set to CRL thisUpdate
  - Expires: set to CRL nextUpdate
- Added comprehensive error handling:
  - 404 for non-existent CAs
  - 404 for CAs without CRLs
  - 400 for invalid format
  - 503 for unsigned CRLs
- Implemented conversion from PEM to DER format
- No authentication required (public endpoint)
- Created comprehensive test suite with 13 passing tests

Files modified:
- backend/src/server.ts (added endpoint and imports)

Files created:
- backend/src/server.crl-endpoint.test.ts (test suite)
<!-- SECTION:NOTES:END -->
