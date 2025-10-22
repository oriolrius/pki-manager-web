---
id: task-030
title: Implement CA listing page UI
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 10:38'
labels:
  - frontend
  - ca
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the frontend page for viewing all root Certificate Authorities with table view, filtering, sorting, and search capabilities.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CA list page created at /cas route
- [ ] #2 Data table component with CA columns (CN, O, status, dates, cert count)
- [ ] #3 Status badges (Active=green, Expired=orange, Revoked=red)
- [ ] #4 Filtering by status and algorithm
- [ ] #5 Search input for CN, O, OU
- [ ] #6 Sorting by name, issued date, expiry date
- [ ] #7 Click on row navigates to CA detail page
- [ ] #8 Loading and error states handled
- [ ] #9 Pagination controls
- [ ] #10 Responsive design for mobile
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add missing shadcn/ui components (Table, Badge, Input, Select)
2. Create CA listing page at /cas route
3. Implement data fetching with tRPC ca.list query
4. Build table with CA columns and status badges
5. Add search and filter controls
6. Implement sorting functionality
7. Add pagination controls
8. Implement row click navigation to detail page
9. Add loading and error states
10. Test responsive design
11. Update navigation in root layout
<!-- SECTION:PLAN:END -->
