---
id: task-024
title: Implement CRL HTTP publishing endpoint
status: To Do
assignee: []
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 03:59'
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
