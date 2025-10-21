---
id: task-018
title: Implement certificate download backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 19:59'
labels:
  - backend
  - certificate
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for downloading certificates in multiple formats: PEM, DER, PKCS#7 chain, and PKCS#12 with private key (if exportable).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 certificate.download endpoint implemented
- [x] #2 PEM format generation (single certificate)
- [x] #3 DER format generation (binary)
- [x] #4 PEM chain format (certificate + CA)
- [x] #5 PKCS#7 format (certificate + CA)
- [x] #6 PKCS#12 format with password protection (if key exportable)
- [x] #7 Correct MIME types returned
- [x] #8 Filename generation with CN and serial
- [x] #9 Audit log entry for downloads
- [x] #10 Password validation for PKCS#12

- [x] #11 Tests written to validate download functionality for all formats
- [x] #12 All tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Review task requirements and download formats
2. Create input schema for download with format parameter
3. Implement PEM format (single certificate)
4. Implement DER format (binary)
5. Implement PEM chain format (cert + CA)
6. Implement PKCS#7 format (cert + CA)
7. Implement PKCS#12 format with password
8. Add MIME types and filename generation
9. Add audit logging for downloads
10. Write comprehensive tests
11. Run all tests to ensure they pass
<!-- SECTION:PLAN:END -->
