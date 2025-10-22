---
id: task-035
title: Implement certificate listing page UI
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 12:37'
labels:
  - frontend
  - certificate
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the frontend page for viewing all certificates with comprehensive table view, multi-select filtering, sorting, search, bulk actions, and pagination.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Certificate list page created at /certificates route
- [ ] #2 Data table with columns: status, CN, type, CA, dates, actions
- [ ] #3 Status indicators (colored dots and badges)
- [ ] #4 Multi-select filters (status, CA, type, domain, date range)
- [ ] #5 Search input with debouncing
- [ ] #6 Sorting for all major columns
- [ ] #7 Checkbox column for bulk selection
- [ ] #8 Bulk actions: Download Selected, Export CSV, Revoke
- [ ] #9 Pagination with configurable page size
- [ ] #10 Expiring soon highlighting (< 30 days)
- [ ] #11 Loading states and skeleton screens
- [ ] #12 Responsive design with mobile view
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create certificate listing route at /certificates
2. Create data table with columns: status, CN, type, CA, dates, actions
3. Add status indicators with colored dots and badges
4. Implement multi-select filters (status, CA, type, domain, date range)
5. Add search input with debouncing
6. Implement column sorting
7. Add checkbox column for bulk selection
8. Implement bulk actions dropdown (Download Selected, Export CSV, Revoke)
9. Add pagination with configurable page size
10. Highlight expiring soon certificates (< 30 days)
11. Add loading states and skeleton screens
12. Implement responsive design for mobile
<!-- SECTION:PLAN:END -->
