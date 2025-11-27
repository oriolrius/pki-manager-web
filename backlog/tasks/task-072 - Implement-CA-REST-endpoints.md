---
id: task-072
title: Implement CA REST endpoints
status: Done
assignee:
  - '@myself'
created_date: '2025-11-27 15:35'
updated_date: '2025-11-27 16:43'
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
- [x] #1 All 8 CA endpoints implemented in backend/src/rest/routes/ca.routes.ts
- [x] #2 OpenAPI schemas documented for all endpoints
- [x] #3 Proper HTTP status codes returned (200, 201, 400, 404, 409)
- [x] #4 Pagination implemented for list endpoints
- [x] #5 Query parameter filtering matches tRPC implementation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

### Files Created
- `backend/src/rest/routes/ca.routes.ts` - All 8 CA REST endpoints

### Files Modified
- `backend/src/rest/index.ts` - Registered CA routes with `/cas` prefix

### Endpoints Implemented

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/cas` | List CAs with filtering and pagination |
| POST | `/api/v1/cas` | Create new CA |
| GET | `/api/v1/cas/:id` | Get CA details |
| POST | `/api/v1/cas/:id/revoke` | Revoke CA |
| DELETE | `/api/v1/cas/:id` | Delete CA |
| GET | `/api/v1/cas/:id/certificates` | List certificates issued by CA |
| GET | `/api/v1/cas/:id/crls` | List CRLs for CA |
| POST | `/api/v1/cas/:id/crls` | Generate new CRL |

### HTTP Status Codes
- 200: Success
- 201: Created (POST /cas, POST /cas/:id/crls)
- 400: Bad Request (validation errors)
- 404: Not Found (CA/CRL not found)
- 409: Conflict (already revoked, not deletable, has active certs)
- 500: Internal Error

### Features
- Full OpenAPI 3.1 schema documentation for all endpoints
- Pagination support with `limit`, `offset`, and `hasMore`
- Query parameter filtering (status, search, sortBy, sortOrder)
- Service layer integration using existing CAService, CRLService, CertificateService
- Proper error mapping from service-specific errors to HTTP responses

### Test Results
```
Test Files  11 passed (11)
     Tests  174 passed | 1 skipped (175)
  Duration  11.12s
```

All tests pass confirming backward compatibility and proper integration.
<!-- SECTION:NOTES:END -->
