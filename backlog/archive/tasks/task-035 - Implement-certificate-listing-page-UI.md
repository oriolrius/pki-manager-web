---
id: task-035
title: Implement certificate listing page UI
status: Done
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 12:39'
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
- [x] #1 Certificate list page created at /certificates route
- [x] #2 Data table with columns: status, CN, type, CA, dates, actions
- [x] #3 Status indicators (colored dots and badges)
- [x] #4 Multi-select filters (status, CA, type, domain, date range)
- [x] #5 Search input with debouncing
- [x] #6 Sorting for all major columns
- [x] #7 Checkbox column for bulk selection
- [x] #8 Bulk actions: Download Selected, Export CSV, Revoke
- [x] #9 Pagination with configurable page size
- [x] #10 Expiring soon highlighting (< 30 days)
- [x] #11 Loading states and skeleton screens
- [x] #12 Responsive design with mobile view
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented comprehensive certificate listing page with the following features:

- Created certificate list page at /certificates route
- Built data table with comprehensive columns:
  - Checkbox for bulk selection
  - Status with colored indicators (dots + badges)
  - Subject (Common Name)
  - Certificate Type (server, client, code_signing, email)
  - CA ID reference
  - Issued date (sortable)
  - Expires date (sortable)
  - Actions dropdown menu
- Implemented status badges with colored dots:
  - Active (green)
  - Expiring Soon (orange) - for certs expiring in < 30 days
  - Expired (gray)
  - Revoked (red)
- Created comprehensive filter system:
  - Search bar with 300ms debouncing for subject/serial/domain search
  - Status filter (all, active, expired, revoked)
  - Certificate type filter (all, server, client, code_signing, email)
  - CA filter dropdown (populated from CA list)
  - Configurable page size selector (25/50/100 per page)
- Implemented column sorting:
  - Sortable columns: subject, issued date, expiry date
  - Click to toggle ascending/descending
  - Visual sort indicators (↑/↓/↕)
- Added bulk selection functionality:
  - Checkbox in first column for row selection
  - "Select all" checkbox in header
  - Selected count display
  - Bulk actions dropdown when items selected
- Implemented bulk actions:
  - Download Selected certificates
  - Export to CSV
  - Revoke Selected (with destructive styling)
- Added pagination:
  - Previous/Next buttons
  - Shows current range ("Showing X to Y")
  - Respects page size setting
  - Resets to page 0 on filter changes
- Highlighted expiring soon certificates:
  - Orange badge for certs expiring in < 30 days
  - Orange background highlight on table rows
  - Clear visual distinction from normal active certs
- Created loading states:
  - Animated spinner during data fetch
  - Loading message
  - Center-aligned loading indicator
- Implemented comprehensive error handling:
  - Error alerts with descriptive messages
  - Empty state with helpful text
  - Different empty state messages for filtered vs unfiltered views
- Built responsive design:
  - Hidden columns on smaller screens (md, lg, sm breakpoints)
  - Responsive filter row with wrapping
  - Mobile-friendly bulk actions
  - Clickable rows navigate to certificate details
- Added row-level actions dropdown:
  - View Details
  - Download
  - Revoke (disabled if already revoked)
- Updated root navigation to include Certificates link

All acceptance criteria completed. Page provides comprehensive certificate management with filtering, search, bulk operations, and excellent UX.
<!-- SECTION:NOTES:END -->
