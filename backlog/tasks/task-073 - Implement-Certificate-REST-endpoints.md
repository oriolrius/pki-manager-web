---
id: task-073
title: Implement Certificate REST endpoints
status: To Do
assignee: []
created_date: '2025-11-27 15:35'
labels:
  - openapi
  - backend
  - certificates
dependencies:
  - task-069
  - task-070
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create REST endpoints for Certificate management:

- GET /api/v1/certificates - List certificates with filtering
- POST /api/v1/certificates - Issue new certificate
- GET /api/v1/certificates/{id} - Get certificate details
- POST /api/v1/certificates/{id}/renew - Renew certificate
- POST /api/v1/certificates/{id}/revoke - Revoke certificate
- DELETE /api/v1/certificates/{id} - Delete certificate
- GET /api/v1/certificates/{id}/download - Download certificate

Reference: doc-005 (OpenAPI Specification Design)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 7 certificate endpoints implemented in backend/src/rest/routes/certificate.routes.ts
- [ ] #2 Download endpoint supports all 14+ formats via query parameter
- [ ] #3 Type-specific validations enforced (server, client, email, code_signing)
- [ ] #4 OpenAPI schemas documented with all request/response types
- [ ] #5 Proper error responses for validation failures
<!-- AC:END -->
