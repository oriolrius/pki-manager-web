---
id: task-031
title: Implement CA creation form/page UI
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 12:26'
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
- [ ] #1 CA creation page/modal created
- [ ] #2 Form with all DN fields (CN, O, OU, C, ST, L)
- [ ] #3 Country code dropdown (ISO 3166-1)
- [ ] #4 Key algorithm selection (RSA-2048/4096, ECDSA-P256/P384)
- [ ] #5 Validity period configuration (Not Before, Years)
- [ ] #6 Optional tags/labels input
- [ ] #7 Client-side validation matching backend
- [ ] #8 Review/preview step before submission
- [ ] #9 Confirmation dialog with security warning
- [ ] #10 Success page with certificate download options
- [ ] #11 Error handling and display
- [ ] #12 Certificate fingerprint display
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
