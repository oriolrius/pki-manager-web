---
id: task-008
title: Implement CA listing backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:49'
updated_date: '2025-10-21 17:17'
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
- [ ] #1 ca.list tRPC endpoint implemented
- [ ] #2 Filtering by status (active, expired, revoked)
- [ ] #3 Filtering by algorithm
- [ ] #4 Search functionality for CN, O, OU
- [ ] #5 Sorting by name, issued date, expiry date
- [ ] #6 Certificate count included for each CA
- [ ] #7 Pagination support
- [ ] #8 Status computed based on current date
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
