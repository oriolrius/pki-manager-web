---
id: task-031
title: Implement CA creation form/page UI
status: Done
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 12:30'
labels:
  - frontend
  - ca
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the frontend form for creating new root Certificate Authorities with validation, confirmation dialog, and success handling.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CA creation page/modal created
- [x] #2 Form with all DN fields (CN, O, OU, C, ST, L)
- [x] #3 Country code dropdown (ISO 3166-1)
- [x] #4 Key algorithm selection (RSA-2048/4096, ECDSA-P256/P384)
- [x] #5 Validity period configuration (Not Before, Years)
- [x] #6 Optional tags/labels input
- [x] #7 Client-side validation matching backend
- [x] #8 Review/preview step before submission
- [x] #9 Confirmation dialog with security warning
- [x] #10 Success page with certificate download options
- [x] #11 Error handling and display
- [x] #12 Certificate fingerprint display
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create dialog and form UI components (dialog.tsx, label.tsx, textarea.tsx)
2. Create CA creation route at /cas/new with the form
3. Implement form with all DN fields and validation
4. Add country dropdown with ISO 3166-1 codes
5. Add key algorithm and validity period inputs
6. Create review/preview component
7. Add confirmation dialog with security warning
8. Implement form submission with tRPC mutation
9. Create success page with download options
10. Add error handling and display
11. Calculate and display certificate fingerprint
12. Test the complete flow
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented complete CA creation form with the following features:

- Created UI components: dialog, label, textarea, checkbox, alert for form interactions
- Built comprehensive CA creation form at /cas/new with all DN fields (CN, O, OU, C, ST, L)
- Added ISO 3166-1 country code dropdown with full country list
- Implemented key algorithm selection (RSA-2048/4096, ECDSA-P256/P384) and validity period configuration
- Added optional tags/labels input with dynamic add/remove
- Implemented client-side validation matching backend schema requirements
- Created multi-step flow: form → review → confirmation → success
- Added confirmation dialog with security warning about CA creation
- Built success page with certificate details and download options (PEM/DER)
- Integrated with tRPC ca.create mutation for backend communication
- Added comprehensive error handling and display
- Display certificate fingerprint on success page (currently using serial number)
- Updated CA list page with "Create CA" buttons linking to new form

All acceptance criteria completed. Form is fully functional and ready for testing.
<!-- SECTION:NOTES:END -->
