---
id: task-032
title: Implement CA detail page UI
status: To Do
assignee: []
created_date: '2025-10-21 15:50'
labels:
  - frontend
  - ca
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the comprehensive CA detail page with tabs for overview, certificates, revocation, and audit log. Include action buttons for download, revoke, and delete.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CA detail page created at /cas/:id route
- [ ] #2 Overview tab with certificate information cards
- [ ] #3 Subject and Issuer DN display
- [ ] #4 Key Information card
- [ ] #5 Extensions card (Key Usage, Basic Constraints, SKI)
- [ ] #6 Certificates tab with embedded certificate list
- [ ] #7 Revocation tab with CRL information
- [ ] #8 Audit Log tab with filterable log
- [ ] #9 Action buttons: Download, Generate CRL, Revoke, Delete
- [ ] #10 Download dropdown for PEM/DER/PKCS#7 formats
- [ ] #11 Expiry warning if < 90 days
- [ ] #12 Copyable fingerprint
- [ ] #13 Responsive tabs for mobile
<!-- AC:END -->
