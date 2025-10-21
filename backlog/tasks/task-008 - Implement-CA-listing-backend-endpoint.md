---
id: task-008
title: Implement CA listing backend endpoint
status: Done
assignee:
  - '@claude'
created_date: '2025-10-21 15:49'
updated_date: '2025-10-21 17:18'
labels:
  - backend
  - ca
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for listing all root CAs with filtering, sorting, and search capabilities. Include certificate count per CA.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ca.list tRPC endpoint implemented
- [x] #2 Filtering by status (active, expired, revoked)
- [x] #3 Filtering by algorithm
- [x] #4 Search functionality for CN, O, OU
- [x] #5 Sorting by name, issued date, expiry date
- [x] #6 Certificate count included for each CA
- [x] #7 Pagination support
- [x] #8 Status computed based on current date
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Analyze requirements for filtering, sorting, and search
2. Implement database query with Drizzle ORM
3. Add filtering by status (active, expired, revoked)
4. Add filtering by algorithm
5. Implement search functionality for CN, O, OU
6. Add sorting by name, issued date, expiry date
7. Include certificate count for each CA
8. Implement pagination support
9. Compute status based on current date
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the CA listing endpoint with comprehensive features:

- Created tRPC query endpoint with Zod input validation
- Implemented filtering by status (active, expired, revoked) with dynamic date-based expiration checking
- Added filtering by key algorithm (RSA-2048, RSA-4096, ECDSA-P256, ECDSA-P384)
- Implemented search functionality that searches within subject DN for CN, O, and OU
- Added flexible sorting by name (subject DN), issued date, or expiry date
- Configurable sort order (ascending or descending)
- Included certificate count for each CA using database aggregation
- Full pagination support with configurable limit and offset
- Status is computed dynamically based on current date (expired if notAfter < now)
- Extended database schema to include keyAlgorithm field with index
- Extended API schema to support all filtering and sorting parameters

All acceptance criteria have been met.
<!-- SECTION:NOTES:END -->
