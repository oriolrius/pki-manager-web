---
id: task-075
title: Implement Search and Utility REST endpoints
status: Done
assignee:
  - '@myself'
created_date: '2025-11-27 15:35'
updated_date: '2025-11-27 19:33'
labels:
  - openapi
  - backend
  - search
  - audit
  - dashboard
dependencies:
  - task-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create REST endpoints for search, dashboard, audit, and report functionality:

- GET /api/v1/search - Global search across CAs, certificates, and domains
- GET /api/v1/domains - List domains with filtering and pagination
- GET /api/v1/dashboard/stats - Dashboard statistics (CA/certificate counts)
- GET /api/v1/dashboard/expiring - Expiring items (CAs and certificates)
- GET /api/v1/audit - Audit log entries with filtering
- POST /api/v1/reports - Generate reports (certificate inventory, revocation, CA operations)

These endpoints wrap existing tRPC procedures (searchRouter, dashboardRouter, auditRouter, domainRouter) with REST semantics, OpenAPI documentation, and standard error responses.

Reference: Tasks 73/74 for implementation patterns
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /api/v1/search accepts query parameter (min 1 char) and returns grouped results
- [x] #2 Global search returns results object with cas, certificates, and domains arrays
- [x] #3 Each search result includes id, type, title, subtitle, status, and metadata fields
- [x] #4 Global search accepts optional limit parameter (1-50, default 10)
- [x] #5 GET /api/v1/domains returns paginated list with items array and pagination metadata

- [x] #6 Domains endpoint supports optional search parameter for domain name filtering
- [x] #7 Domains endpoint supports optional caId parameter to filter by issuing CA
- [x] #8 Each domain result includes domain, isWildcard, baseDomain, certificateCount, caCount, and date fields
- [x] #9 Domains endpoint returns statistics: activeCertificateCount and revokedCertificateCount per domain
- [x] #10 GET /api/v1/dashboard/stats returns totalCAs, activeCAs, totalCertificates, activeCertificates counts
- [x] #11 Dashboard stats returns real-time counts from database (not cached)
- [x] #12 GET /api/v1/dashboard/expiring returns array of items expiring soonest
- [x] #13 Expiring endpoint accepts optional limit parameter (1-20, default 5)
- [x] #14 Each expiring item includes id, type, cn, san, notAfter, and daysRemaining fields
- [x] #15 Expiring items are sorted by notAfter ascending (soonest first)
- [x] #16 GET /api/v1/audit returns paginated audit log entries with items and totalCount
- [x] #17 Audit endpoint supports filtering by operation parameter (e.g., ca.create, certificate.issue)
- [x] #18 Audit endpoint supports filtering by entityType parameter (ca, certificate, audit, report)
- [x] #19 Audit endpoint supports filtering by entityId parameter for specific entity lookup
- [x] #20 Audit endpoint supports filtering by status parameter (success, failure)
- [x] #21 Audit endpoint supports filtering by date range: startDate and endDate (Unix timestamps)
- [x] #22 Audit entries are returned in descending timestamp order (most recent first)
- [x] #23 Each audit entry includes id, timestamp, operation, entityType, entityId, ipAddress, status, and details
- [x] #24 POST /api/v1/reports accepts reportType (certificate_inventory, revocation, ca_operations)
- [x] #25 Reports endpoint accepts format parameter (csv supported, pdf returns 501)
- [x] #26 Reports endpoint accepts optional caId to filter by CA
- [x] #27 Reports endpoint accepts optional startDate and endDate (Unix timestamps)
- [x] #28 Report response includes reportName, format, content, summary, generatedAt, hash, and recordCount
- [x] #29 Certificate inventory report returns data with id, caId, serialNumber, subjectDn, type, status, dates
- [x] #30 Revocation report returns data with id, serialNumber, subjectDn, revocationDate, revocationReason
- [x] #31 CA operations report returns audit log data filtered by entityType=ca
- [x] #32 All 6 utility endpoints return errors in standard format: {error: {code, message, details?}}
- [x] #33 All 6 utility endpoints documented in OpenAPI spec at /api/v1/openapi.json
- [x] #34 OpenAPI spec includes Search, Domains, Dashboard, and Audit tags
- [x] #35 Integration tests in utility.routes.test.ts cover all 6 endpoints with success and error cases
- [x] #36 Tests validate HTTP status codes: 200 success, 400 validation errors, 404 not found
- [x] #37 Tests verify search returns grouped results for CAs, certificates, and domains
- [x] #38 Tests verify dashboard stats match actual database counts
- [x] #39 Tests verify audit log filtering works correctly for all filter parameters
- [x] #40 Tests verify report generation returns valid CSV content with proper headers
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Created `utility.routes.ts` with 6 REST endpoints wrapping existing tRPC procedures:

### Endpoints Implemented
1. **GET /api/v1/search** - Global search across CAs, certificates, and domains
2. **GET /api/v1/domains** - List domains with filtering (search, caId) and pagination
3. **GET /api/v1/dashboard/stats** - Dashboard statistics (CA/certificate counts)
4. **GET /api/v1/dashboard/expiring** - Expiring items sorted by notAfter
5. **GET /api/v1/audit** - Audit log with filtering (operation, entityType, entityId, status, dates)
6. **POST /api/v1/reports** - Generate reports (certificate_inventory, revocation, ca_operations)

### Files Created/Modified
- `backend/src/rest/routes/utility.routes.ts` - Main implementation (~900 lines)
- `backend/src/rest/routes/utility.routes.test.ts` - Integration tests (~600 lines)
- `backend/src/rest/index.ts` - Added route registration
- `backend/src/rest/openapi.ts` - Added Domains tag

### Test Results
- All 333 tests pass
- Tests cover: search results, domain filtering, dashboard stats, expiring items, audit filtering, CSV report generation, error formats, OpenAPI documentation
<!-- SECTION:NOTES:END -->
