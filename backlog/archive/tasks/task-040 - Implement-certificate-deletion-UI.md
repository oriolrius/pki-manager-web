---
id: task-040
title: Implement certificate deletion UI
status: To Do
assignee: []
created_date: '2025-10-21 15:50'
labels:
  - frontend
  - certificate
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the UI flow for permanently deleting certificates including prerequisite checks, danger dialog, and confirmation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Certificate deletion dialog created
- [ ] #2 Prerequisite checks: revoked or expired > 90 days
- [ ] #3 Error display if prerequisites not met
- [ ] #4 Danger-styled dialog with warnings
- [ ] #5 Impact assessment display
- [ ] #6 Checkbox for KMS key destruction
- [ ] #7 Checkbox for CRL removal
- [ ] #8 Text input requiring exact serial number match
- [ ] #9 Serial number display (copyable)
- [ ] #10 Success notification
- [ ] #11 Redirect to certificate list
- [ ] #12 Error handling and validation
<!-- AC:END -->
