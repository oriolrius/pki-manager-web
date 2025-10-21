---
id: task-023
title: Implement CRL retrieval backend endpoints
status: To Do
assignee: []
created_date: '2025-10-21 15:50'
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
- [ ] #1 crl.getLatest endpoint implemented
- [ ] #2 crl.getHistory endpoint implemented
- [ ] #3 Latest CRL retrieved by CA ID
- [ ] #4 CRL history with pagination
- [ ] #5 PEM and DER format support
- [ ] #6 CRL validity status computed
- [ ] #7 Revoked certificate list included
- [ ] #8 CRL metadata (number, dates, count) included
<!-- AC:END -->
