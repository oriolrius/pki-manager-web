---
id: task-059
title: Add Bulk Certificate Creation Section
status: To Do
assignee: []
created_date: '2025-10-23 17:22'
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
- [ ] #1 User can access 'Bulk' section from top navigation menu
- [ ] #2 User can select a Certificate Authority from dropdown
- [ ] #3 User can set a default expiration time using a time input field
- [ ] #4 User can paste CSV data into a text area with format: cert type, CN, SAN, expiration time
- [ ] #5 System validates CSV format and shows clear error messages for invalid entries
- [ ] #6 System creates certificates in bulk using provided CSV data and selected CA
- [ ] #7 User receives feedback showing successful creations and any errors per row
- [ ] #8 Default expiration time is used when CSV row doesn't specify expiration
<!-- AC:END -->
