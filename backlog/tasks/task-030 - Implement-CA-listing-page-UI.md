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
