---
id: task-034
title: Implement CA deletion UI
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 12:34'
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
- [ ] #1 CA deletion dialog component created
- [ ] #2 Prerequisite checks: CA revoked, no active certificates
- [ ] #3 Error display if prerequisites not met
- [ ] #4 Danger-styled dialog with warnings
- [ ] #5 Checkbox for KMS key destruction option
- [ ] #6 Text input requiring exact CN match
- [ ] #7 Audit log preservation notice
- [ ] #8 Success notification
- [ ] #9 Redirect to CA list after deletion
- [ ] #10 Error handling and display
<!-- AC:END -->
