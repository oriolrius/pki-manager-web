---
id: task-023
title: Implement CRL retrieval backend endpoints
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 04:13'
labels:
  - backend
  - crl
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement tRPC endpoints for retrieving the latest CRL and CRL history for a CA. Support both PEM and DER formats.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 crl.getLatest endpoint implemented
- [x] #2 crl.getHistory endpoint implemented
- [x] #3 Latest CRL retrieved by CA ID
- [x] #4 CRL history with pagination
- [x] #5 PEM and DER format support
- [x] #6 CRL validity status computed
- [x] #7 Revoked certificate list included
- [x] #8 CRL metadata (number, dates, count) included

- [x] #9 Unit tests implemented and passing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Implement crl.getLatest endpoint to retrieve latest CRL for a CA
2. Implement crl.getHistory endpoint with pagination
3. Add support for PEM and DER format conversion
4. Compute CRL validity status (valid/expired)
5. Include revoked certificate list in response
6. Include CRL metadata (number, dates, count)
7. Write unit tests
8. Test both endpoints
<!-- SECTION:PLAN:END -->
