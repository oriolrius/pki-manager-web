---
id: task-022
title: Implement CRL generation backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-22 04:11'
labels:
  - backend
  - crl
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for generating Certificate Revocation Lists. Collect revoked certificates, generate CRL in X.509 format, sign with CA key, store in database.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 crl.generate endpoint implemented
- [x] #2 All revoked certificates collected for CA
- [ ] #3 CRL generated in X.509 v2 format
- [x] #4 CRL number auto-incremented
- [x] #5 This Update and Next Update dates set
- [ ] #6 CRL extensions included (CRL Number, Authority Key Identifier)
- [ ] #7 CRL signed with CA private key via KMS
- [x] #8 CRL stored in database
- [x] #9 Revoked certificate count tracked
- [x] #10 Audit log entry created

- [x] #11 Unit tests implemented and passing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Review X.509 CRL v2 format and node-forge CRL generation capabilities
2. Create CRL generation utility function in crypto module
3. Implement crl.generate endpoint in procedures/crl.ts
4. Collect revoked certificates for the given CA
5. Generate CRL with proper extensions (CRL Number, Authority Key Identifier)
6. Sign CRL using CA private key via KMS (or node-forge if KMS doesn't support CRL signing)
7. Store generated CRL in database with auto-incremented CRL number
8. Add audit logging for CRL generation
9. Write unit tests for CRL generation
10. Test the complete flow
<!-- SECTION:PLAN:END -->
