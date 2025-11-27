---
id: task-069
title: Set up OpenAPI infrastructure with Fastify Swagger
status: Done
assignee:
  - '@myself'
created_date: '2025-11-27 15:34'
updated_date: '2025-11-27 15:50'
labels:
  - openapi
  - backend
  - infrastructure
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Install and configure @fastify/swagger and @fastify/swagger-ui plugins to enable OpenAPI 3.1 specification generation and interactive documentation.

This is the foundational task for implementing the REST API layer alongside the existing tRPC implementation.

Reference: doc-005 (OpenAPI Specification Design)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 @fastify/swagger and @fastify/swagger-ui packages installed
- [x] #2 OpenAPI 3.1 configuration created in backend/src/rest/openapi.ts
- [x] #3 Swagger UI accessible at /api/docs
- [x] #4 REST routes registered under /api/v1 prefix
- [x] #5 OpenAPI JSON spec available at /api/v1/openapi.json
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

### Files Created
- `backend/src/rest/openapi.ts` - OpenAPI 3.1 configuration with @fastify/swagger
- `backend/src/rest/index.ts` - REST plugin registration
- `backend/src/rest/routes/health.ts` - Health check endpoint

### Files Modified
- `backend/src/server.ts` - Integrated REST API plugin, removed manual Swagger implementation

### Packages Installed
- `@fastify/swagger@9.6.1`
- `@fastify/swagger-ui@5.2.3`

### Endpoints Available
- `GET /api/docs` - Swagger UI
- `GET /api/v1/openapi.json` - OpenAPI JSON specification
- `GET /api/v1/health` - REST API health check

### OpenAPI Features
- OpenAPI 3.1.0 specification
- Reusable schemas: Error, Pagination, SubjectDN, CertificateStatus, CertificateType, KeyAlgorithm, RevocationReason, DownloadFormat
- Reusable responses: BadRequest, NotFound, Conflict, InternalError
- Tags for all resource categories (CAs, Certificates, Bulk, CRLs, Search, Dashboard, Audit)

### Verification
- All 144 tests pass
- Swagger UI accessible at /api/docs (HTTP 200)
- OpenAPI JSON available at /api/v1/openapi.json
- Health endpoint returns expected response
<!-- SECTION:NOTES:END -->
