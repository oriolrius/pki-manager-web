---
id: task-074
title: Implement Bulk Operations REST endpoints
status: To Do
assignee: []
created_date: '2025-11-27 15:35'
labels:
  - openapi
  - backend
  - bulk
dependencies:
  - task-073
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create REST endpoints for bulk certificate operations:

- POST /api/v1/certificates/bulk/issue - Bulk issue from CSV
- POST /api/v1/certificates/bulk/revoke - Bulk revoke certificates
- POST /api/v1/certificates/bulk/renew - Bulk renew certificates
- DELETE /api/v1/certificates/bulk - Bulk delete certificates
- POST /api/v1/certificates/bulk/download - Bulk download certificates

Reference: doc-005 (OpenAPI Specification Design)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 5 bulk endpoints implemented in backend/src/rest/routes/bulk.routes.ts
- [ ] #2 CSV parsing matches existing tRPC implementation
- [ ] #3 Partial success handling with detailed results
- [ ] #4 Bulk download returns ZIP file
- [ ] #5 Request body limits configured appropriately
<!-- AC:END -->
