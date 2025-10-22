---
id: task-034
title: Implement CA deletion UI
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 12:37'
labels:
  - frontend
  - ca
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the UI flow for permanently deleting a Certificate Authority including prerequisite checks, danger dialog, and confirmation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CA deletion dialog component created
- [x] #2 Prerequisite checks: CA revoked, no active certificates
- [x] #3 Error display if prerequisites not met
- [x] #4 Danger-styled dialog with warnings
- [x] #5 Checkbox for KMS key destruction option
- [x] #6 Text input requiring exact CN match
- [x] #7 Audit log preservation notice
- [x] #8 Success notification
- [x] #9 Redirect to CA list after deletion
- [x] #10 Error handling and display
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create CA deletion page at /cas/$id/delete
2. Check prerequisite requirements (CA must be revoked, no active certificates)
3. Display error if prerequisites not met
4. Create danger-styled dialog with clear warnings
5. Add checkbox for KMS key destruction option
6. Implement text input requiring exact CN match for confirmation
7. Add audit log preservation notice
8. Integrate with tRPC ca.delete mutation
9. Show success notification
10. Redirect to CA list after deletion
11. Add comprehensive error handling
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented CA deletion UI with the following features:

- Created dedicated deletion page at /cas/$id/delete with danger styling
- Implemented comprehensive prerequisite checking system:
  - Visual checklist with green checkmarks or red X icons
  - CA must be revoked or expired (validates status and expiry date)
  - No active certificates check (queries certificate list)
  - Real-time validation feedback
- Added prominent error displays when prerequisites not met:
  - Shows which requirements are failing
  - Provides action button to revoke CA if needed
  - Clear explanation of why deletion is blocked
- Created danger-styled UI with red theme:
  - Destructive color scheme throughout
  - Critical warning alerts
  - Clear "Permanent Deletion" messaging
- Added "What will be deleted" section showing:
  - CA certificate and metadata
  - All CRLs
  - All certificate records with count
  - Private key in KMS (if option checked)
- Added "What will be preserved" section:
  - Audit log entries (compliance requirement)
  - Historical operation records
- Implemented KMS key destruction checkbox:
  - Optional destruction of private key
  - Clear warning about permanence
  - Visual warning icon
  - Explanation of consequences
- Added CN confirmation input:
  - Requires exact match of Common Name
  - Real-time validation feedback
  - Shows error if mismatch
- Integrated with tRPC ca.delete mutation
- Automatic cache invalidation and navigation to CA list on success
- Comprehensive error handling with descriptive messages
- Form validation ensures all requirements met before allowing deletion

All acceptance criteria completed. UI provides multiple safety checks for this critical destructive operation.
<!-- SECTION:NOTES:END -->
