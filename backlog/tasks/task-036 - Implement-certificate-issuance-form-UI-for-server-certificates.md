---
id: task-036
title: Implement certificate issuance form UI for server certificates
status: To Do
assignee: []
created_date: '2025-10-21 15:50'
labels:
  - frontend
  - certificate
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the frontend form for issuing server certificates with multi-step wizard or single-page form, validation, preview, and success handling.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Certificate issuance page created at /certificates/issue
- [ ] #2 CA selection dropdown (active CAs only)
- [ ] #3 Certificate type selection: Server Authentication
- [ ] #4 Subject DN fields with validation
- [ ] #5 SAN DNS names multi-input (with wildcard support)
- [ ] #6 SAN IP addresses multi-input (IPv4/IPv6)
- [ ] #7 Key algorithm selection
- [ ] #8 Validity period configuration (max 825 days)
- [ ] #9 Warning for validity > 398 days
- [ ] #10 Tags/labels optional input
- [ ] #11 Review/preview step with certificate summary
- [ ] #12 Client-side validation
- [ ] #13 Success page with download buttons
- [ ] #14 Error handling and display
<!-- AC:END -->
