---
id: task-032
title: Implement CA detail page UI
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 12:33'
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
- [x] #1 CA detail page created at /cas/:id route
- [x] #2 Overview tab with certificate information cards
- [x] #3 Subject and Issuer DN display
- [x] #4 Key Information card
- [x] #5 Extensions card (Key Usage, Basic Constraints, SKI)
- [x] #6 Certificates tab with embedded certificate list
- [x] #7 Revocation tab with CRL information
- [x] #8 Audit Log tab with filterable log
- [x] #9 Action buttons: Download, Generate CRL, Revoke, Delete
- [x] #10 Download dropdown for PEM/DER/PKCS#7 formats
- [x] #11 Expiry warning if < 90 days
- [x] #12 Copyable fingerprint
- [x] #13 Responsive tabs for mobile
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented comprehensive CA detail page with the following features:

- Created tabbed CA detail page at /cas/$id using TanStack Router
- Integrated with tRPC ca.getById, certificate.list, crl.list, and audit.list queries
- Implemented Overview tab with multiple information cards:
  - Status & Information card with status badge, serial number, SHA-256 fingerprint (copyable), and issued certificate count
  - Subject and Issuer cards displaying all DN components (CN, O, OU, C, ST, L)
  - Key Information card showing algorithm, validity dates
  - Extensions card displaying Basic Constraints, Key Usage, Subject/Authority Key Identifiers
  - Revocation information card (shown when CA is revoked)
- Implemented Certificates tab showing all certificates issued by the CA with clickable rows
- Implemented Revocation tab displaying CRL list with download capability
- Implemented Audit Log tab with expandable entries showing operation details
- Added action buttons:
  - Download dropdown menu with PEM/DER/PKCS#7 format options
  - Revoke CA button (disabled if already revoked)
  - Delete CA button (destructive variant)
- Added expiry warning alert when CA expires in < 90 days
- Implemented copyable fingerprint with visual feedback (check icon on copy)
- Used responsive Radix UI Tabs component for mobile-friendly navigation
- Created UI components: tabs.tsx and dropdown-menu.tsx

All acceptance criteria completed. Page is fully functional with comprehensive CA information display.
<!-- SECTION:NOTES:END -->
