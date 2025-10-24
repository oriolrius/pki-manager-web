---
id: task-060
title: Add bulk operations for certificate management
status: In Progress
assignee:
  - '@myself'
created_date: '2025-10-24 03:51'
updated_date: '2025-10-24 05:21'
labels:
  - frontend
  - backend
  - testing
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Enable users to select multiple certificates from the /certificates table and perform bulk operations (revoke, renew, delete, download) to improve efficiency when managing large numbers of certificates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 User can select multiple certificates using checkboxes in the /certificates table
- [x] #2 Bulk action bar appears when one or more certificates are selected showing available operations (revoke, renew, delete, download)
- [x] #3 User can bulk revoke selected certificates with confirmation dialog
- [x] #4 User can bulk renew selected certificates with appropriate validation
- [x] #5 User can bulk delete selected certificates with confirmation dialog
- [x] #6 User can bulk download selected certificates as a ZIP file
- [x] #7 Backend tRPC procedures for bulk operations are implemented (bulkRevoke, bulkRenew, bulkDelete, bulkDownload)
- [x] #8 Frontend components for bulk selection UI and operation buttons are implemented
- [ ] #9 All backend unit tests pass for bulk operation procedures
- [ ] #10 All frontend integration tests pass for bulk selection and operations
- [ ] #11 Error handling displays clear messages for partial failures in bulk operations (e.g., some certificates failed to revoke)
- [ ] #12 Bulk operations are atomic where appropriate or provide detailed success/failure breakdown
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented bulk operations for certificate management:

- Backend: Added bulkRevoke, bulkRenew, bulkDelete, and bulkDownload tRPC procedures
- Frontend: Added checkboxes for multi-select, bulk action bar with operations
- UI: Confirmation dialogs for destructive operations
- Error handling: Partial failure tracking with detailed results

All acceptance criteria 1-8 completed. Testing (AC 9-10) and full integration pending.
<!-- SECTION:NOTES:END -->
