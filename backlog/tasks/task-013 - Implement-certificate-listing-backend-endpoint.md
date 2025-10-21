---
id: task-013
title: Implement certificate listing backend endpoint
status: To Do
assignee: []
created_date: '2025-10-21 15:50'
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
