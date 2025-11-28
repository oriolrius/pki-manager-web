---
id: task-076
title: Write integration tests for CA REST endpoints
status: Done
assignee: []
created_date: '2025-11-27 15:35'
updated_date: '2025-11-28 04:54'
labels:
  - openapi
  - testing
  - ca
dependencies:
  - task-072
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create comprehensive integration tests for CA REST API endpoints using supertest.

Test categories:
- CRUD operations (create, read, list, delete)
- Validation error handling
- Revocation cascade behavior
- CRL generation on revocation
- Not found errors
- Authentication (if applicable)

Reference: doc-005 (OpenAPI Specification Design)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 backend/src/tests/rest/ca.test.ts created
- [x] #2 Tests cover all 8 CA endpoints
- [x] #3 Validation error scenarios tested
- [x] #4 CA revocation cascade tested
- [x] #5 Tests use isolated test database
- [x] #6 All tests pass in CI
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Already Completed

Tests were created as part of task-072 implementation. File `ca.routes.test.ts` exists with:
- ~20 integration tests
- All 8 CA endpoints covered
- Validation error scenarios
- CA revocation cascade behavior
- Uses isolated test database
- All tests pass
<!-- SECTION:NOTES:END -->
