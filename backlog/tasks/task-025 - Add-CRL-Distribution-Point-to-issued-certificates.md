---
id: task-025
title: Add CRL Distribution Point to issued certificates
status: To Do
assignee: []
created_date: '2025-10-21 15:50'
labels:
  - backend
  - certificate
  - crl
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Automatically add CRL Distribution Point extension to all issued certificates pointing to the CRL HTTP endpoint.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CDP extension (OID 2.5.29.31) added to all certificates
- [ ] #2 CDP URL format: http://crl.example.com/ca/{ca-id}.crl
- [ ] #3 CDP URL configurable via settings
- [ ] #4 HTTP and HTTPS URLs supported
- [ ] #5 CDP URL accessible and returns valid CRL
- [ ] #6 CDP extension visible in certificate details
<!-- AC:END -->
