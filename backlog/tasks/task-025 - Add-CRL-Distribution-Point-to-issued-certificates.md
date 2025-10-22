---
id: task-025
title: Add CRL Distribution Point to issued certificates
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 12:06'
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

- [ ] #7 Unit tests implemented and passing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Review existing certificate generation code in crypto/x509.ts
2. Add CDP extension support to certificate generation
3. Add environment variable for CRL distribution URL
4. Update certificate generation to include CDP extension
5. Update certificate issuance endpoints to use CDP
6. Verify CDP extension appears in certificate details
7. Write unit tests
8. Test all acceptance criteria
<!-- SECTION:PLAN:END -->
