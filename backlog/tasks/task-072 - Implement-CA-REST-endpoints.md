---
id: task-072
title: Implement CA REST endpoints
status: In Progress
assignee:
  - '@myself'
created_date: '2025-11-27 15:35'
updated_date: '2025-11-27 16:40'
labels:
  - openapi
  - backend
  - ca
dependencies:
  - task-069
  - task-070
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create REST endpoints for Certificate Authority management:

- GET /api/v1/cas - List CAs with filtering and pagination
- POST /api/v1/cas - Create new CA
- GET /api/v1/cas/{id} - Get CA details
- POST /api/v1/cas/{id}/revoke - Revoke CA
- DELETE /api/v1/cas/{id} - Delete CA
- GET /api/v1/cas/{id}/certificates - List certificates issued by CA
- GET /api/v1/cas/{id}/crls - List CRLs for CA
- POST /api/v1/cas/{id}/crls - Generate new CRL

Reference: doc-005 (OpenAPI Specification Design)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 8 CA endpoints implemented in backend/src/rest/routes/ca.routes.ts
- [ ] #2 OpenAPI schemas documented for all endpoints
- [ ] #3 Proper HTTP status codes returned (200, 201, 400, 404, 409)
- [ ] #4 Pagination implemented for list endpoints
- [ ] #5 Query parameter filtering matches tRPC implementation
<!-- AC:END -->
