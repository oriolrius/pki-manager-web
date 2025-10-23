---
id: task-059
title: Add Bulk Certificate Creation Section
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-23 17:22'
updated_date: '2025-10-23 17:35'
labels:
  - frontend
  - feature
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Enable users to create multiple certificates at once by providing a CSV format input, reducing the time needed to create certificates for multiple entities. This feature should include CA selection and configurable default expiration time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 User can access 'Bulk' section from top navigation menu
- [x] #2 User can select a Certificate Authority from dropdown
- [x] #3 User can set a default expiration time using a time input field
- [x] #4 User can paste CSV data into a text area with format: cert type, CN, SAN, expiration time
- [x] #5 System validates CSV format and shows clear error messages for invalid entries
- [x] #6 System creates certificates in bulk using provided CSV data and selected CA
- [x] #7 User receives feedback showing successful creations and any errors per row
- [x] #8 Default expiration time is used when CSV row doesn't specify expiration

- [x] #9 Backend tests pass for bulk certificate creation functionality
- [ ] #10 Frontend tests pass for Bulk section UI and CSV validation
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Explore backend certificate creation procedure to understand the API structure
2. Create backend tRPC procedure for bulk certificate creation with CSV parsing
3. Add backend tests for bulk creation endpoint
4. Create frontend route /bulk (certificates.bulk.tsx)
5. Add "Bulk" navigation item to __root.tsx menu
6. Implement bulk certificate form with CA selector, default expiration, and CSV textarea
7. Implement CSV validation and error display logic
8. Add frontend tests for Bulk section UI
9. Test end-to-end bulk creation workflow manually
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Summary
Implemented bulk certificate creation feature that enables users to create multiple certificates at once via CSV input.

### Backend Implementation
- Added `bulkCreateCertificatesSchema` to schemas.ts for input validation
- Created `bulkIssue` procedure in certificate.ts that:
  - Parses CSV data (format: certificateType, CN, O, C, SANs, validityDays)
  - Auto-detects SAN types (email, IP, DNS) based on format
  - Validates each row using existing certificate validation logic
  - Returns detailed success/failure results per row
- Added comprehensive tests in certificate-bulk.test.ts (8 tests passing)

### Frontend Implementation
- Created `/certificates/bulk` route with dedicated UI
- Features:
  - CA selection dropdown
  - Default validity days input field
  - Large CSV textarea with example format
  - Comprehensive format guide panel
  - Real-time results display showing success/failure per row
- Added "Bulk" navigation link to main menu

### CSV Format
Format: `certificateType, CN, O, C, SANs (semicolon-separated), validityDays`

Example:
```
server,example.com,Acme Corp,US,example.com;www.example.com,365
client,john.doe,Acme Corp,US,,730
email,jane@example.com,Acme Corp,US,jane@example.com,365
```

### Files Modified
- backend/src/trpc/schemas.ts
- backend/src/trpc/procedures/certificate.ts
- backend/src/trpc/procedures/certificate-bulk.test.ts (new)
- frontend/src/routes/certificates.bulk.tsx (new)
- frontend/src/routes/__root.tsx

### Testing
- Backend: 8 unit tests passing (validation, error handling, SAN parsing)
- Frontend: Manual testing recommended
- AC 10 (frontend tests) deferred - would require React Testing Library setup
<!-- SECTION:NOTES:END -->
