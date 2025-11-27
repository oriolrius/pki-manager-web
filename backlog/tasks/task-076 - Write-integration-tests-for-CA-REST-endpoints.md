---
id: task-076
title: Write integration tests for CA REST endpoints
status: To Do
assignee: []
created_date: '2025-11-27 15:35'
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
- [ ] #1 backend/src/tests/rest/ca.test.ts created
- [ ] #2 Tests cover all 8 CA endpoints
- [ ] #3 Validation error scenarios tested
- [ ] #4 CA revocation cascade tested
- [ ] #5 Tests use isolated test database
- [ ] #6 All tests pass in CI
<!-- AC:END -->
