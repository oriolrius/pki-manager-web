---
id: TASK-115
title: 'Tests: CRL signing, serving, and revocation end-to-end'
status: To Do
assignee: []
created_date: '2026-06-29 14:03'
updated_date: '2026-06-29 14:04'
labels:
  - crl
  - testing
milestone: CRL Signing & Distribution
dependencies:
  - TASK-112
  - TASK-113
  - TASK-114
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cover the CRL feature with unit + integration tests (KMS integration auto-skips when KMS is unavailable, per existing pattern).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Unit tests cover CRL building and signature verification
- [ ] #2 Integration test: revoke a cert, then assert it appears in the served CRL and the CRL signature verifies against the issuing CA
<!-- AC:END -->
