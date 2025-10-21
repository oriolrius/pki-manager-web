---
id: task-008
title: Implement CA listing backend endpoint
status: To Do
assignee: []
created_date: '2025-10-21 15:49'
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
