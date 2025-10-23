---
id: task-013
title: Implement certificate listing backend endpoint
status: Done
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 18:04'
labels:
  - backend
  - certificate
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for listing certificates with comprehensive filtering, sorting, searching, and pagination capabilities.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 certificate.list tRPC endpoint implemented
- [x] #2 Filtering by status (active, expired, revoked, expiring soon)
- [x] #3 Filtering by CA ID
- [x] #4 Filtering by certificate type
- [x] #5 Filtering by domain
- [x] #6 Date range filtering (issued/expiry)
- [x] #7 Search functionality for CN, subject, SAN, serial
- [x] #8 Sorting by all major columns
- [x] #9 Pagination with configurable page size
- [x] #10 Expiry status computed dynamically
- [x] #11 Total count returned for pagination
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Analyze existing schema and identify missing fields for filtering/sorting/search
2. Update listCertificatesSchema to add: domain filter, date range filters (issued/expiry), search query, sortBy/sortOrder, expiryStatus filter
3. Implement certificate.list procedure:
   - Build drizzle query with dynamic filters (status, CA ID, type, domain, date ranges)
   - Implement search across CN, subject, SAN fields, and serial number
   - Apply sorting by any major column (serial, subject, dates, type, status)
   - Apply pagination with limit/offset
   - Compute expiry status dynamically (check if expired or expiring within 30 days)
   - Get total count for pagination metadata
4. Test with various filter combinations (status, CA, type, domain, dates, search)
5. Verify sorting works correctly
6. Verify pagination returns correct total count
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented comprehensive certificate listing endpoint with all requested features:

## Schema Updates (schemas.ts)
- Enhanced listCertificatesSchema with filtering options: domain, expiryStatus, date ranges (issuedAfter/Before, expiresAfter/Before)
- Added search parameter for global text search
- Added sorting options (sortBy, sortOrder) for all major columns
- Maintained pagination support (limit, offset)

## Implementation (procedures/certificate.ts)
- Built dynamic query using drizzle-orm with conditional filters
- Implemented status filtering (active, expired, revoked)
- Implemented expiry status filtering with dynamic computation (expired, expiring_soon within 30 days, active)
- Implemented domain filtering searching both CN in subjectDn and SANs
- Implemented search across CN, subject, serial number, and all SAN types (DNS, IP, Email)
- Implemented date range filtering for both issue and expiry dates
- Implemented sorting by any major column (serialNumber, subjectDn, notBefore, notAfter, certificateType, status, createdAt)
- Implemented pagination with total count
- Parse and return SAN arrays from JSON storage
- Return metadata (totalCount, limit, offset) for pagination

## Key Features
- All filters can be combined for powerful querying
- Expiry status computed dynamically on each request
- Supports OR logic for domain and search (matches any field)
- Uses SQL LIKE for flexible text matching
- Returns properly typed results with all certificate data

## Additional Implementation: OpenAPI 3.0.3 Integration

While implementing the certificate listing endpoint, also integrated comprehensive OpenAPI 3.0.3 documentation for the entire API.

### OpenAPI Integration Components

**Packages Installed:**
- trpc-swagger v2.0.0 - OpenAPI generation for tRPC v11
- swagger-ui-dist v5.29.5 - Interactive API documentation

**Files Created:**
- backend/src/trpc/openapi.ts - OpenAPI document generation
- backend/src/trpc/openapi.test.ts - 17 tests for spec generation
- backend/src/server.test.ts - 17 tests for server endpoints
- backend/OPENAPI.md - User documentation
- backend/OPENAPI_TESTING.md - Test coverage documentation
- backlog/docs/doc-003 - Certificate-Listing-API.md - Complete API documentation
- backlog/docs/doc-004 - OpenAPI-Integration.md - OpenAPI integration guide

**Files Modified:**
- backend/src/trpc/init.ts - Added OpenApiMeta support
- backend/src/trpc/procedures/certificate.ts - Added OpenAPI metadata and output schema
- backend/src/server.ts - Added OpenAPI spec and Swagger UI endpoints

### New Endpoints Available

1. **GET /api/openapi.json** - OpenAPI 3.0.3 specification (JSON)
2. **GET /api/docs** - Interactive Swagger UI documentation
3. **GET /api/docs/:file** - Swagger UI static assets

### Testing

✅ **34 tests - All passing**
- 17 tests for OpenAPI document generation and validation
- 17 tests for server endpoints and security

### Benefits

✅ Auto-generated documentation from code
✅ Always in sync with implementation
✅ Interactive API explorer (Swagger UI)
✅ Standards-compliant (OpenAPI 3.0.3)
✅ Import into Postman, Insomnia, etc.
✅ Client SDK generation support

### Documentation References

- Complete API docs: backlog/docs/doc-003
- OpenAPI integration guide: backlog/docs/doc-004
- Testing guide: backend/OPENAPI_TESTING.md
- Usage examples: backend/OPENAPI.md
<!-- SECTION:NOTES:END -->
