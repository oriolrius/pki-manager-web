---
id: task-075
title: Implement Search and Utility REST endpoints
status: In Progress
assignee:
  - '@myself'
created_date: '2025-11-27 15:35'
updated_date: '2025-11-27 19:05'
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
- [ ] #1 GET /api/v1/search accepts query parameter (min 1 char) and returns grouped results
- [ ] #2 Global search returns results object with cas, certificates, and domains arrays
- [ ] #3 Each search result includes id, type, title, subtitle, status, and metadata fields
- [ ] #4 Global search accepts optional limit parameter (1-50, default 10)
- [ ] #5 GET /api/v1/domains returns paginated list with items array and pagination metadata

- [ ] #6 Domains endpoint supports optional search parameter for domain name filtering
- [ ] #7 Domains endpoint supports optional caId parameter to filter by issuing CA
- [ ] #8 Each domain result includes domain, isWildcard, baseDomain, certificateCount, caCount, and date fields
- [ ] #9 Domains endpoint returns statistics: activeCertificateCount and revokedCertificateCount per domain
- [ ] #10 GET /api/v1/dashboard/stats returns totalCAs, activeCAs, totalCertificates, activeCertificates counts
- [ ] #11 Dashboard stats returns real-time counts from database (not cached)
- [ ] #12 GET /api/v1/dashboard/expiring returns array of items expiring soonest
- [ ] #13 Expiring endpoint accepts optional limit parameter (1-20, default 5)
- [ ] #14 Each expiring item includes id, type, cn, san, notAfter, and daysRemaining fields
- [ ] #15 Expiring items are sorted by notAfter ascending (soonest first)
- [ ] #16 GET /api/v1/audit returns paginated audit log entries with items and totalCount
- [ ] #17 Audit endpoint supports filtering by operation parameter (e.g., ca.create, certificate.issue)
- [ ] #18 Audit endpoint supports filtering by entityType parameter (ca, certificate, audit, report)
- [ ] #19 Audit endpoint supports filtering by entityId parameter for specific entity lookup
- [ ] #20 Audit endpoint supports filtering by status parameter (success, failure)
- [ ] #21 Audit endpoint supports filtering by date range: startDate and endDate (Unix timestamps)
- [ ] #22 Audit entries are returned in descending timestamp order (most recent first)
- [ ] #23 Each audit entry includes id, timestamp, operation, entityType, entityId, ipAddress, status, and details
- [ ] #24 POST /api/v1/reports accepts reportType (certificate_inventory, revocation, ca_operations)
- [ ] #25 Reports endpoint accepts format parameter (csv supported, pdf returns 501)
- [ ] #26 Reports endpoint accepts optional caId to filter by CA
- [ ] #27 Reports endpoint accepts optional startDate and endDate (Unix timestamps)
- [ ] #28 Report response includes reportName, format, content, summary, generatedAt, hash, and recordCount
- [ ] #29 Certificate inventory report returns data with id, caId, serialNumber, subjectDn, type, status, dates
- [ ] #30 Revocation report returns data with id, serialNumber, subjectDn, revocationDate, revocationReason
- [ ] #31 CA operations report returns audit log data filtered by entityType=ca
- [ ] #32 All 6 utility endpoints return errors in standard format: {error: {code, message, details?}}
- [ ] #33 All 6 utility endpoints documented in OpenAPI spec at /api/v1/openapi.json
- [ ] #34 OpenAPI spec includes Search, Domains, Dashboard, and Audit tags
- [ ] #35 Integration tests in utility.routes.test.ts cover all 6 endpoints with success and error cases
- [ ] #36 Tests validate HTTP status codes: 200 success, 400 validation errors, 404 not found
- [ ] #37 Tests verify search returns grouped results for CAs, certificates, and domains
- [ ] #38 Tests verify dashboard stats match actual database counts
- [ ] #39 Tests verify audit log filtering works correctly for all filter parameters
- [ ] #40 Tests verify report generation returns valid CSV content with proper headers
<!-- AC:END -->
