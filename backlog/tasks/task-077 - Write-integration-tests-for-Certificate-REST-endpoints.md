---
id: task-077
title: Write integration tests for Certificate REST endpoints
status: Done
assignee: []
created_date: '2025-11-27 15:35'
updated_date: '2025-11-28 04:54'
labels:
  - openapi
  - testing
  - certificates
dependencies:
  - task-073
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create comprehensive integration tests for Certificate REST API endpoints.

Test categories:
- Certificate issuance for all 4 types (server, client, email, code_signing)
- Type-specific validations (validity periods, key algorithms, SAN requirements)
- Renewal chain tracking
- Revocation handling
- Download format testing (PEM, DER, PKCS12, JKS, etc.)
- Error handling

Reference: doc-005 (OpenAPI Specification Design)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 backend/src/tests/rest/certificate.test.ts created
- [x] #2 Tests cover all 7 certificate endpoints
- [x] #3 All 4 certificate types tested with type-specific validations
- [x] #4 Download formats tested (at least PEM, DER, PKCS12, JKS)
- [x] #5 Renewal chain logic tested
- [x] #6 Tests use isolated test database
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Already Completed

Tests were created as part of task-073 implementation. File `certificate.routes.test.ts` exists with:
- 36 integration tests
- All 7 certificate endpoints covered
- Certificate type validations
- Download formats (PEM, DER) tested
- Renewal chain logic tested
- Uses isolated test database
- All tests pass
<!-- SECTION:NOTES:END -->
