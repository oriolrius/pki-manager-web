---
id: task-032
title: Implement CA detail page UI
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 12:30'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create CA detail route at /cas/$id
2. Fetch CA data using tRPC ca.getById
3. Create overview tab with certificate information cards (Subject, Issuer, Key Info, Extensions)
4. Create certificates tab with embedded certificate list filtered by CA
5. Create revocation tab with CRL information
6. Create audit log tab with filterable log
7. Implement action buttons: Download, Generate CRL, Revoke, Delete
8. Add download dropdown for PEM/DER/PKCS#7 formats
9. Display expiry warning if < 90 days
10. Make fingerprint copyable
11. Implement responsive tabs for mobile
<!-- SECTION:PLAN:END -->
