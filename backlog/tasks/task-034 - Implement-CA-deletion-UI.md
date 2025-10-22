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
