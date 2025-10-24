---
id: task-060
title: Add bulk operations for certificate management
status: To Do
assignee: []
created_date: '2025-10-24 03:51'
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
- [ ] #1 User can select multiple certificates using checkboxes in the /certificates table
- [ ] #2 Bulk action bar appears when one or more certificates are selected showing available operations (revoke, renew, delete, download)
- [ ] #3 User can bulk revoke selected certificates with confirmation dialog
- [ ] #4 User can bulk renew selected certificates with appropriate validation
- [ ] #5 User can bulk delete selected certificates with confirmation dialog
- [ ] #6 User can bulk download selected certificates as a ZIP file
- [ ] #7 Backend tRPC procedures for bulk operations are implemented (bulkRevoke, bulkRenew, bulkDelete, bulkDownload)
- [ ] #8 Frontend components for bulk selection UI and operation buttons are implemented
- [ ] #9 All backend unit tests pass for bulk operation procedures
- [ ] #10 All frontend integration tests pass for bulk selection and operations
- [ ] #11 Error handling displays clear messages for partial failures in bulk operations (e.g., some certificates failed to revoke)
- [ ] #12 Bulk operations are atomic where appropriate or provide detailed success/failure breakdown
<!-- AC:END -->
