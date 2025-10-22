---
id: task-030
title: Implement CA listing page UI
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 10:42'
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
- [x] #1 CA list page created at /cas route
- [x] #2 Data table component with CA columns (CN, O, status, dates, cert count)
- [x] #3 Status badges (Active=green, Expired=orange, Revoked=red)
- [x] #4 Filtering by status and algorithm
- [x] #5 Search input for CN, O, OU
- [x] #6 Sorting by name, issued date, expiry date
- [x] #7 Click on row navigates to CA detail page
- [x] #8 Loading and error states handled
- [x] #9 Pagination controls
- [x] #10 Responsive design for mobile
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented comprehensive CA listing page with all required features:

- Added shadcn/ui components (Table, Badge, Input, Select) using CLI
- Created /cas route at frontend/src/routes/cas.tsx with full feature set
- Implemented data table with columns: CN, O, Status, Algorithm, Issued Date, Expiry Date, Certificate Count
- Added color-coded status badges (Active=green, Expired=orange, Revoked=red)
- Implemented search functionality for CN, O, OU fields
- Added filtering dropdowns for status and algorithm
- Implemented sortable columns (name, issuedDate, expiryDate) with visual indicators
- Added pagination controls with Previous/Next buttons
- Implemented row click navigation to CA detail page (/cas/:id)
- Added comprehensive loading and error states
- Applied responsive design with Tailwind breakpoints (sm, md, lg, xl) for mobile support
- Updated root layout navigation to include CA link
- Fixed TypeScript configuration (tsconfig.node.json composite setting)
- Installed missing dependency @radix-ui/react-icons

All acceptance criteria verified and checked.
<!-- SECTION:NOTES:END -->
