---
id: task-077
title: Write integration tests for Certificate REST endpoints
status: To Do
assignee: []
created_date: '2025-11-27 15:35'
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
- [ ] #1 backend/src/tests/rest/certificate.test.ts created
- [ ] #2 Tests cover all 7 certificate endpoints
- [ ] #3 All 4 certificate types tested with type-specific validations
- [ ] #4 Download formats tested (at least PEM, DER, PKCS12, JKS)
- [ ] #5 Renewal chain logic tested
- [ ] #6 Tests use isolated test database
<!-- AC:END -->
