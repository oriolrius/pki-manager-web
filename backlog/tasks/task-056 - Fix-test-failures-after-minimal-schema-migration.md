---
id: task-056
title: Fix test failures after minimal schema migration
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-23 14:12'
updated_date: '2025-10-23 14:51'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Review minimal schema changes (DONE)
2. Run tests to identify failing tests
3. Search for all test files that insert mock CA and certificate data
4. Add kmsCertificateId to all mock data insertions
5. Fix ca.test.ts
6. Fix certificate.test.ts
7. Fix crl.test.ts
8. Fix server.crl-endpoint.test.ts
9. Run tests and verify all 166 tests pass
10. Document changes in implementation notes
<!-- SECTION:PLAN:END -->
