---
id: task-069
title: Set up OpenAPI infrastructure with Fastify Swagger
status: Done
assignee:
  - '@myself'
created_date: '2025-11-27 15:34'
updated_date: '2025-11-27 16:22'
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

### Test Results
```
$ pnpm test

> @pki-manager/backend@1.1.2 test /home/oriol/miimetiq3/pki-manager/backend
> vitest run

 RUN  v2.1.9 /home/oriol/miimetiq3/pki-manager/backend

 ✓ src/lib/audit.test.ts (8 tests) 5ms
 ✓ src/trpc/openapi.test.ts (17 tests) 10ms
 ✓ src/trpc/procedures/audit.test.ts (10 tests) 25ms
 ✓ src/server.test.ts (17 tests) 34ms
 ✓ src/trpc/procedures/certificate-bulk.test.ts (8 tests) 269ms
 ✓ src/crypto/crypto.test.ts (30 tests | 1 skipped) 658ms
 ✓ src/trpc/procedures/ca-create.test.ts (1 test) 496ms
 ✓ src/server.crl-endpoint.test.ts (13 tests) 567ms
 ✓ src/trpc/procedures/ca.test.ts (21 tests) 4889ms
 ✓ src/trpc/procedures/certificate.test.ts (20 tests) 9940ms

 Test Files  10 passed (10)
      Tests  144 passed | 1 skipped (145)
   Start at  16:58:10
   Duration  10.75s (transform 864ms, setup 0ms, collect 5.05s, tests 16.89s, environment 2ms, prepare 945ms)
```

## Latest Test Run (2025-11-27 17:21 UTC)

```
$ pnpm test

> @pki-manager/backend@1.1.2 test /home/oriol/miimetiq3/pki-manager/backend
> vitest run

 RUN  v2.1.9 /home/oriol/miimetiq3/pki-manager/backend

 ✓ src/lib/audit.test.ts (8 tests) 6ms
 ✓ src/trpc/openapi.test.ts (17 tests) 5ms
 ✓ src/trpc/procedures/audit.test.ts (10 tests) 25ms
 ✓ src/server.test.ts (17 tests) 44ms
 ✓ src/trpc/procedures/ca-create.test.ts (1 test) 315ms
 ✓ src/server.crl-endpoint.test.ts (13 tests) 318ms
 ✓ src/crypto/crypto.test.ts (30 tests | 1 skipped) 759ms
 ✓ src/trpc/procedures/certificate-bulk.test.ts (8 tests) 476ms
 ✓ src/trpc/procedures/ca.test.ts (21 tests) 4583ms
 ✓ src/trpc/procedures/certificate.test.ts (20 tests) 9667ms

 Test Files  10 passed (10)
      Tests  144 passed | 1 skipped (145)
   Start at  17:21:36
   Duration  10.46s
```

All tests pass confirming OpenAPI infrastructure is working correctly.
<!-- SECTION:NOTES:END -->
