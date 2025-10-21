---
id: task-013
title: Implement certificate listing backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 17:45'
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
- [ ] #1 certificate.list tRPC endpoint implemented
- [ ] #2 Filtering by status (active, expired, revoked, expiring soon)
- [ ] #3 Filtering by CA ID
- [ ] #4 Filtering by certificate type
- [ ] #5 Filtering by domain
- [ ] #6 Date range filtering (issued/expiry)
- [ ] #7 Search functionality for CN, subject, SAN, serial
- [ ] #8 Sorting by all major columns
- [ ] #9 Pagination with configurable page size
- [ ] #10 Expiry status computed dynamically
- [ ] #11 Total count returned for pagination
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
