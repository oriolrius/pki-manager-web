---
id: task-103
title: Add OIDC authentication to REST API endpoints
status: Done
assignee:
  - '@myself'
created_date: '2026-02-06 07:53'
updated_date: '2026-02-06 07:58'
labels:
  - backend
  - security
  - rest-api
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently, tRPC endpoints (`/trpc/*`) require OIDC authentication via JWT validation, but REST API endpoints (`/api/v1/*`) are completely public with no authentication.

**Current State:**
- `backend/src/rest/openapi.ts:34-36` explicitly states: "Currently, the API does not require authentication"
- REST routes in `backend/src/rest/index.ts` have no `preHandler` or auth middleware
- The M2M tests pass on REST endpoints because they accept any request, not because tokens are validated

**Goal:**
Apply the same OIDC JWT validation to REST API endpoints that is currently used for tRPC endpoints.

**Implementation Approach:**
1. Create a Fastify `preHandler` hook that validates JWT tokens using the existing `backend/src/lib/oidc.ts` module
2. Register this hook on the `/api/v1` route prefix (excluding public endpoints)
3. Keep these endpoints public (no auth required):
   - `GET /api/v1/openapi.json` - OpenAPI spec
   - `GET /api/docs` - Swagger UI
   - `GET /health` - Health check
   - `GET /cas/:caId.pem` - CA certificate download
   - `GET /crl/:caId.crl` - CRL download
4. Update OpenAPI spec description to reflect that authentication is now required
5. Add `securitySchemes` to OpenAPI spec for Bearer token auth

**Files to modify:**
- `backend/src/rest/index.ts` - Add auth preHandler hook
- `backend/src/rest/openapi.ts` - Update description and add securitySchemes
- `backend/src/rest/routes/*.ts` - May need to mark specific routes as public

**Reference:**
- tRPC auth middleware: `backend/src/trpc/middleware/auth.ts`
- OIDC config module: `backend/src/lib/oidc.ts`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 REST API endpoints under /api/v1/* require valid JWT Bearer token (same validation as tRPC)
- [x] #2 Requests without token return 401 with JSON error response
- [x] #3 Requests with invalid/expired token return 401 with descriptive error
- [x] #4 Public endpoints remain accessible without auth: /health, /api/docs, /api/v1/openapi.json, CA .pem downloads, CRL downloads
- [x] #5 OpenAPI spec includes securitySchemes for Bearer authentication
- [x] #6 OpenAPI spec description updated to reflect authentication requirement
- [x] #7 Existing M2M tests pass with valid pki-service tokens
- [x] #8 New test verifies REST endpoints reject unauthenticated requests
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

### Files Created
- `backend/src/lib/jwt.ts` - Shared JWT validation module used by both tRPC and REST API
- `backend/src/rest/middleware/auth.ts` - Fastify preHandler hook for REST API authentication

### Files Modified
- `backend/src/trpc/middleware/auth.ts` - Refactored to use shared JWT module
- `backend/src/rest/index.ts` - Added auth preHandler to REST routes
- `backend/src/rest/openapi.ts` - Added securitySchemes and updated documentation
- `tests/auth-m2m.spec.ts` - Added tests for REST API authentication

### Test Results
All 18 M2M authentication tests pass:
- Token acquisition and validation
- tRPC endpoint access with valid token
- REST API endpoint access with valid token
- Rejection of unauthenticated requests (both tRPC and REST)
- Rejection of invalid tokens
- Public endpoints remain accessible without auth
<!-- SECTION:NOTES:END -->
