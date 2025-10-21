---
id: task-037
title: Implement certificate detail page UI
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
Create the comprehensive certificate detail page with tabs for details, raw certificate, revocation status, and audit history. Include all certificate fields and action buttons.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Certificate detail page created at /certificates/:id route
- [ ] #2 Header with CN, status badge, serial number, action buttons
- [ ] #3 Details tab with Certificate Information card
- [ ] #4 Subject and Issuer DN cards with copy buttons
- [ ] #5 Validity Period card with progress bar and remaining time
- [ ] #6 SAN card with copyable DNS names, IPs, emails
- [ ] #7 Key Information card
- [ ] #8 Extensions card with parsed extension details
- [ ] #9 Raw Certificate tab with PEM/DER/Text views
- [ ] #10 Revocation Status tab
- [ ] #11 Audit History tab with timeline view
- [ ] #12 Download dropdown for all formats
- [ ] #13 Renew, Revoke, Delete action buttons
- [ ] #14 Responsive layout with mobile accordion
<!-- AC:END -->
