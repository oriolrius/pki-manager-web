---
id: task-018
title: Implement certificate download backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 19:57'
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
- [ ] #1 certificate.download endpoint implemented
- [ ] #2 PEM format generation (single certificate)
- [ ] #3 DER format generation (binary)
- [ ] #4 PEM chain format (certificate + CA)
- [ ] #5 PKCS#7 format (certificate + CA)
- [ ] #6 PKCS#12 format with password protection (if key exportable)
- [ ] #7 Correct MIME types returned
- [ ] #8 Filename generation with CN and serial
- [ ] #9 Audit log entry for downloads
- [ ] #10 Password validation for PKCS#12

- [ ] #11 Tests written to validate download functionality for all formats
- [ ] #12 All tests pass
<!-- AC:END -->
