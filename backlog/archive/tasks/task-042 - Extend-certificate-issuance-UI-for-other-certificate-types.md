---
id: task-042
title: Extend certificate issuance UI for other certificate types
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
Extend the certificate issuance form to support client, code signing, and email protection certificate types with appropriate field adjustments.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Certificate type selector with all 4 types
- [ ] #2 Form fields dynamically adjust based on type
- [ ] #3 Client certificate: email/username CN validation, email SAN, UPN support
- [ ] #4 Client certificate: exportable key option with PKCS#12
- [ ] #5 Code signing: organization validation, stricter key requirements
- [ ] #6 Email protection: email required, multiple email SAN support
- [ ] #7 Key Usage and EKU fields adjusted per type
- [ ] #8 Validation rules adjusted per type
- [ ] #9 Default validity adjusted per type
- [ ] #10 Help text/tooltips for each type
<!-- AC:END -->
