---
id: task-056
title: Fix test failures after minimal schema migration
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-23 14:12'
updated_date: '2025-10-23 14:50'
labels:
  - backend
  - testing
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update test files to work with minimal schema where kmsCertificateId is now required. Tests are failing because mock data insertion bypasses KMS and doesn't include required fields.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Update test helper functions to include kmsCertificateId when creating mock CA data
- [ ] #2 Update test helper functions to include kmsCertificateId when creating mock certificate data
- [ ] #3 Fix ca.test.ts to work with minimal schema
- [ ] #4 Fix certificate.test.ts to work with minimal schema
- [ ] #5 Fix crl.test.ts to work with minimal schema
- [ ] #6 Fix server.crl-endpoint.test.ts to work with minimal schema
- [ ] #7 Verify all 166 tests pass
<!-- AC:END -->
