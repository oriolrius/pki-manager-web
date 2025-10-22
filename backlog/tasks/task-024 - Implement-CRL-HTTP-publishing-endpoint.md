---
id: task-024
title: Implement CRL HTTP publishing endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 12:03'
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
- [ ] #1 Public HTTP endpoint created at /crl/{ca-id}.crl
- [ ] #2 CRLs served without authentication
- [ ] #3 Content-Type: application/pkix-crl header set
- [ ] #4 Cache-Control headers set based on Next Update
- [ ] #5 Last-Modified header set to This Update
- [ ] #6 Expires header set to Next Update
- [ ] #7 Support for both PEM (.crl) and DER (.der) formats
- [ ] #8 404 handling for non-existent CAs

- [ ] #9 Unit tests implemented and passing
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
