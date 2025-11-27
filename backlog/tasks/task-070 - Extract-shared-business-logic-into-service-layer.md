---
id: task-070
title: Extract shared business logic into service layer
status: To Do
assignee: []
created_date: '2025-11-27 15:35'
updated_date: '2025-11-27 15:59'
labels:
  - openapi
  - backend
  - refactoring
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Refactor existing tRPC procedure logic into reusable service classes that can be shared between tRPC and REST endpoints.

Create services for:
- CAService - CA creation, retrieval, revocation, deletion
- CertificateService - Certificate issuing, renewal, revocation, download
- CRLService - CRL generation and retrieval

This ensures consistent behavior across both API layers.

Reference: doc-005 (OpenAPI Specification Design)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 backend/src/services/ca.service.ts created with all CA operations
- [ ] #2 backend/src/services/certificate.service.ts created with all certificate operations
- [ ] #3 backend/src/services/crl.service.ts created with all CRL operations
- [ ] #4 Existing tRPC procedures refactored to use new services
- [ ] #5 All existing tests pass after refactoring

- [ ] #6 Test results captured in implementation notes showing all tests pass
<!-- AC:END -->
