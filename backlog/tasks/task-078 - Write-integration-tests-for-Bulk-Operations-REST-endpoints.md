---
id: task-078
title: Write integration tests for Bulk Operations REST endpoints
status: To Do
assignee: []
created_date: '2025-11-27 15:35'
labels:
  - openapi
  - testing
  - bulk
dependencies:
  - task-074
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create integration tests for bulk certificate operations.

Test categories:
- Bulk issue from CSV (valid and invalid rows)
- Partial success handling
- Bulk revoke with cascade
- Bulk renew with key regeneration
- Bulk delete validation
- Bulk download ZIP generation
- Error handling for malformed input

Reference: doc-005 (OpenAPI Specification Design)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 backend/src/tests/rest/bulk.test.ts created
- [ ] #2 Tests cover all 5 bulk endpoints
- [ ] #3 CSV parsing edge cases tested
- [ ] #4 Partial success results verified
- [ ] #5 Bulk download ZIP content validated
- [ ] #6 Large batch handling tested (100 items)
<!-- AC:END -->
